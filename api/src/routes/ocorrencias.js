const { createReadStream, createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { randomUUID } = require('node:crypto');
const { config } = require('../config');
const { pool } = require('../db');
const { resolveStoragePath } = require('../storage');
const { notificarOcorrenciaDecidida } = require('../services/whatsapp');

const extensoesPermitidas = new Set(['.mp4', '.mov', '.mkv', '.avi']);
const extensoesImagemPermitidas = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const papeisOperacao = ['operador', 'gestor', 'admin'];
const statusPermitidos = new Set([
  'analisando',
  'aguardando_operador',
  'aprovada',
  'descartada',
  'expirada',
]);
const decisoesPermitidas = new Set(['aprovada', 'descartada', 'ajustada']);
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function relativeToStorage(...segments) {
  return path.posix.join(...segments);
}

function textoOuNulo(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const texto = value.trim();
  return texto || null;
}

function inteiroLimitado(value, fallback, max) {
  if (value === undefined) {
    return fallback;
  }

  const numero = Number(value);
  if (!Number.isInteger(numero) || numero <= 0) {
    return fallback;
  }

  return Math.min(numero, max);
}

function inteiroNaoNegativo(value) {
  if (value === undefined) {
    return 0;
  }

  const numero = Number(value);
  if (!Number.isInteger(numero) || numero < 0) {
    return 0;
  }

  return numero;
}

function contentTypeImagem(relativePath) {
  const extensao = path.extname(relativePath).toLowerCase();

  switch (extensao) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

async function ocorrenciasRoutes(fastify) {
  fastify.get('/ocorrencias', {
    config: {
      roles: papeisOperacao,
    },
  }, async (request, reply) => {
    const status = textoOuNulo(request.query.status);
    const tunel = textoOuNulo(request.query.tunel);
    const limit = inteiroLimitado(request.query.limit, 50, 200);
    const offset = inteiroNaoNegativo(request.query.offset);

    if (status && !statusPermitidos.has(status)) {
      return reply.code(400).send({ error: 'Status invalido.' });
    }

    const result = await pool.query(
      `with ocorrencias_priorizadas as (
         select
           o.id,
           o.status,
           c.tunel,
           coalesce(o.detectada_em, o.created_at) as horario,
           o.confianca,
           o.protocolos_casados,
           o.frame_principal,
           coalesce((
             select min((protocolo.item ->> 'prioridade')::integer)
             from jsonb_array_elements(o.protocolos_casados) as protocolo(item)
             where (protocolo.item ->> 'prioridade') ~ '^[0-9]+$'
           ), 2147483647) as prioridade_minima
         from ocorrencias o
         left join cameras c on c.id = o.camera_id
         where ($1::text is null or o.status = $1)
           and ($2::text is null or c.tunel = $2)
       )
       select
         id,
         status,
         tunel,
         horario,
         confianca,
         protocolos_casados,
         frame_principal
       from ocorrencias_priorizadas
       order by
         case when status = 'aguardando_operador' then 0 else 1 end,
         prioridade_minima asc,
         horario asc nulls last
       limit $3
       offset $4`,
      [status, tunel, limit, offset],
    );

    return {
      ocorrencias: result.rows,
      paginacao: {
        limit,
        offset,
      },
    };
  });

  fastify.get('/ocorrencias/:id', {
    config: {
      roles: papeisOperacao,
    },
  }, async (request, reply) => {
    const { id } = request.params;

    if (!uuidRegex.test(id)) {
      return reply.code(400).send({ error: 'Id de ocorrencia invalido.' });
    }

    const ocorrenciaResult = await pool.query(
      `select
         o.id,
         o.camera_id,
         o.origem,
         o.status,
         o.fatos,
         o.confianca,
         o.protocolos_casados,
         o.protocolo_escolhido_id,
         o.frame_principal,
         o.frames,
         o.operador_id,
         o.decisao,
         o.decisao_obs,
         o.detectada_em,
         o.decidida_em,
         o.created_at,
         case
           when c.id is null then null
           else jsonb_build_object(
             'id', c.id,
             'nome', c.nome,
             'tunel', c.tunel,
             'sentido', c.sentido,
             'endereco', c.endereco
           )
         end as camera
       from ocorrencias o
       left join cameras c on c.id = o.camera_id
       where o.id = $1
       limit 1`,
      [id],
    );

    const ocorrencia = ocorrenciaResult.rows[0];
    if (!ocorrencia) {
      return reply.code(404).send({ error: 'Ocorrencia nao encontrada.' });
    }

    const [auditoriaResult, protocolosResult] = await Promise.all([
      pool.query(
        `select id, evento, detalhe, ator, created_at
         from auditoria
         where ocorrencia_id = $1
         order by created_at asc, id asc`,
        [id],
      ),
      pool.query(
        `select id, codigo, nome, descricao, criterios, acionamentos, prioridade
         from protocolos
         where ativo = true
         order by prioridade asc, codigo asc`,
      ),
    ]);

    return {
      ocorrencia,
      auditoria: auditoriaResult.rows,
      protocolos_ativos: protocolosResult.rows,
    };
  });

  fastify.post('/ocorrencias/:id/decidir', {
    config: {
      roles: papeisOperacao,
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body || {};
    const decisao = textoOuNulo(body.decisao);
    const decisaoObs = textoOuNulo(body.decisao_obs);
    const protocoloEscolhidoId = textoOuNulo(body.protocolo_escolhido_id);

    if (!uuidRegex.test(id)) {
      return reply.code(400).send({ error: 'Id de ocorrencia invalido.' });
    }

    if (!decisao || !decisoesPermitidas.has(decisao)) {
      return reply.code(400).send({ error: 'Decisao invalida.' });
    }

    if (decisao === 'descartada' && !decisaoObs) {
      return reply.code(400).send({ error: 'Motivo obrigatorio para descarte.' });
    }

    if (decisao === 'ajustada' && !protocoloEscolhidoId) {
      return reply.code(400).send({ error: 'Protocolo obrigatorio para ajuste.' });
    }

    if (protocoloEscolhidoId && !uuidRegex.test(protocoloEscolhidoId)) {
      return reply.code(400).send({ error: 'Id de protocolo invalido.' });
    }

    const client = await pool.connect();

    try {
      await client.query('begin');

      if (decisao === 'ajustada') {
        const protocoloResult = await client.query(
          `select id
           from protocolos
           where id = $1
             and ativo = true
           limit 1`,
          [protocoloEscolhidoId],
        );

        if (protocoloResult.rowCount === 0) {
          await client.query('rollback');
          return reply.code(400).send({ error: 'Protocolo ativo nao encontrado para ajuste.' });
        }
      }

      // O status nao tem valor "ajustada"; a metrica de acerto do motor usa
      // ocorrencias.decisao. Nao simplificar ajuste para decisao = 'aprovada'.
      const statusFinal = decisao === 'descartada' ? 'descartada' : 'aprovada';

      const updateResult = await client.query(
        `update ocorrencias
         set
           status = $2,
           operador_id = $3,
           decisao = $4,
           decisao_obs = $5,
           protocolo_escolhido_id = $6,
           decidida_em = now()
         where id = $1
           and status = 'aguardando_operador'
         returning
           id,
           status,
           decisao,
           decisao_obs,
           protocolo_escolhido_id,
           operador_id,
           decidida_em`,
        [
          id,
          statusFinal,
          request.usuario.id,
          decisao,
          decisaoObs,
          decisao === 'ajustada' ? protocoloEscolhidoId : null,
        ],
      );

      if (updateResult.rowCount === 0) {
        const ocorrenciaResult = await client.query(
          `select status
           from ocorrencias
           where id = $1
           limit 1`,
          [id],
        );

        await client.query('rollback');

        if (ocorrenciaResult.rowCount === 0) {
          return reply.code(404).send({ error: 'Ocorrencia nao encontrada.' });
        }

        return reply.code(409).send({
          error: 'Ocorrencia nao esta aguardando decisao do operador.',
          status: ocorrenciaResult.rows[0].status,
        });
      }

      await client.query('commit');

      if (decisao === 'aprovada' || decisao === 'ajustada') {
        setImmediate(() => {
          notificarOcorrenciaDecidida(id, fastify.log).catch((error) => {
            fastify.log.error({ err: error, ocorrencia_id: id }, 'falha inesperada no fluxo de notificacao');
          });
        });
      }

      return {
        ocorrencia: updateResult.rows[0],
      };
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });

  fastify.get('/midia/*', {
    config: {
      roles: papeisOperacao,
    },
  }, async (request, reply) => {
    const relativePath = textoOuNulo(request.params['*']);

    if (!relativePath) {
      return reply.code(400).send({ error: 'Caminho de midia obrigatorio.' });
    }

    const extensao = path.extname(relativePath).toLowerCase();
    if (!extensoesImagemPermitidas.has(extensao)) {
      return reply.code(400).send({ error: 'Formato de imagem nao permitido.' });
    }

    let absolutePath;
    try {
      absolutePath = resolveStoragePath(relativePath);
    } catch {
      return reply.code(400).send({ error: 'Caminho de midia invalido.' });
    }

    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return reply.code(404).send({ error: 'Midia nao encontrada.' });
      }

      throw error;
    }

    if (!stat.isFile()) {
      return reply.code(404).send({ error: 'Midia nao encontrada.' });
    }

    return reply
      .type(contentTypeImagem(relativePath))
      .header('Content-Length', stat.size)
      .send(createReadStream(absolutePath));
  });

  fastify.post('/ocorrencias/upload', {
    config: {
      roles: papeisOperacao,
    },
  }, async (request, reply) => {
    let arquivo;

    try {
      arquivo = await request.file({
        limits: {
          fileSize: config.uploadMaxBytes,
        },
      });
    } catch (error) {
      if (error.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({
          error: 'Arquivo excede o tamanho maximo permitido.',
          max_bytes: config.uploadMaxBytes,
        });
      }

      throw error;
    }

    if (!arquivo) {
      return reply.code(400).send({ error: 'Arquivo de video obrigatorio.' });
    }

    const extensao = path.extname(arquivo.filename || '').toLowerCase();
    if (!extensoesPermitidas.has(extensao)) {
      arquivo.file.resume();
      return reply.code(400).send({
        error: 'Formato de arquivo nao permitido.',
        permitidos: Array.from(extensoesPermitidas).map((item) => item.slice(1)),
      });
    }

    const ocorrenciaId = randomUUID();
    const uploadRelativo = relativeToStorage('uploads', ocorrenciaId, `original${extensao}`);
    const destinoRelativo = relativeToStorage('frames', ocorrenciaId);
    const uploadAbsoluto = resolveStoragePath(uploadRelativo);

    await fs.mkdir(path.dirname(uploadAbsoluto), { recursive: true });
    await fs.mkdir(resolveStoragePath(destinoRelativo), { recursive: true });

    try {
      await pipeline(arquivo.file, createWriteStream(uploadAbsoluto));
    } catch (error) {
      await fs.rm(path.dirname(uploadAbsoluto), { recursive: true, force: true }).catch(() => {});

      if (error.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({
          error: 'Arquivo excede o tamanho maximo permitido.',
          max_bytes: config.uploadMaxBytes,
        });
      }

      throw error;
    }

    if (arquivo.file.truncated) {
      await fs.rm(path.dirname(uploadAbsoluto), { recursive: true, force: true }).catch(() => {});
      return reply.code(413).send({
        error: 'Arquivo excede o tamanho maximo permitido.',
        max_bytes: config.uploadMaxBytes,
      });
    }

    const client = await pool.connect();

    try {
      await client.query('begin');

      await client.query(
        `insert into ocorrencias (
           id,
           origem,
           status,
           protocolos_casados,
           frames,
           detectada_em
         )
         values ($1, 'upload', 'analisando', '[]'::jsonb, '[]'::jsonb, now())`,
        [ocorrenciaId],
      );

      const jobResult = await client.query(
        `insert into frame_jobs (
           ocorrencia_id,
           tipo,
           origem,
           destino_dir,
           parametros,
           status
         )
         values ($1, 'extrair_frames', $2, $3, $4::jsonb, 'pendente')
         returning id`,
        [
          ocorrenciaId,
          uploadRelativo,
          destinoRelativo,
          JSON.stringify({
            fps: 1,
            max_frames: 30,
            largura: 768,
          }),
        ],
      );

      await client.query(
        `insert into auditoria (ocorrencia_id, evento, ator, detalhe)
         values ($1, 'criada', $2, $3::jsonb)`,
        [
          ocorrenciaId,
          request.usuario.id,
          JSON.stringify({
            origem: 'upload',
            arquivo: uploadRelativo,
            nome_original: arquivo.filename || null,
          }),
        ],
      );

      await client.query('commit');

      return reply.code(201).send({
        ocorrencia_id: ocorrenciaId,
        job_id: jobResult.rows[0].id,
      });
    } catch (error) {
      await client.query('rollback').catch(() => {});
      await fs.rm(path.dirname(uploadAbsoluto), { recursive: true, force: true }).catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });
}

module.exports = ocorrenciasRoutes;
