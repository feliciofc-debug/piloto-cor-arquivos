const path = require('node:path');
const { config } = require('../config');
const { pool } = require('../db');
const { extrairProtocolosDoPdf } = require('../services/importar-protocolos-pdf');

const papeisLeitura = ['operador', 'gestor', 'admin'];
const papeisGestao = ['gestor', 'admin'];
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function streamToBuffer(stream) {
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function nomeArquivoSeguro(filename) {
  const basename = path.basename(filename || 'protocolos.pdf');
  return basename || 'protocolos.pdf';
}

async function protocolosRoutes(fastify) {
  fastify.get('/protocolos', {
    config: {
      roles: papeisLeitura,
    },
  }, async () => {
    const result = await pool.query(
      `select
         id,
         codigo,
         nome,
         descricao,
         criterios,
         acionamentos,
         prioridade,
         ativo,
         origem,
         origem_arquivo,
         importado_em,
         created_at,
         (
           case when jsonb_typeof(criterios -> 'todos') = 'array'
             then jsonb_array_length(criterios -> 'todos') else 0 end
           + case when jsonb_typeof(criterios -> 'algum') = 'array'
             then jsonb_array_length(criterios -> 'algum') else 0 end
           + case when jsonb_typeof(criterios -> 'nenhum') = 'array'
             then jsonb_array_length(criterios -> 'nenhum') else 0 end
         ) as quantidade_criterios
       from protocolos
       order by ativo desc, prioridade asc, codigo asc`,
    );

    return { protocolos: result.rows };
  });

  fastify.post('/protocolos/importar', {
    config: {
      roles: papeisGestao,
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
      return reply.code(400).send({ error: 'PDF obrigatorio.' });
    }

    const filename = nomeArquivoSeguro(arquivo.filename);
    const extensao = path.extname(filename).toLowerCase();
    if (extensao !== '.pdf' && arquivo.mimetype !== 'application/pdf') {
      arquivo.file.resume();
      return reply.code(400).send({ error: 'Envie um arquivo PDF.' });
    }

    const pdfBuffer = await streamToBuffer(arquivo.file);
    if (arquivo.file.truncated) {
      return reply.code(413).send({
        error: 'Arquivo excede o tamanho maximo permitido.',
        max_bytes: config.uploadMaxBytes,
      });
    }

    const { aceitos, recusados } = await extrairProtocolosDoPdf({
      pdfBuffer,
      filename,
    });

    const client = await pool.connect();
    const codigosImportados = [];

    try {
      await client.query('begin');

      for (const protocolo of aceitos) {
        const result = await client.query(
          `insert into protocolos (
             codigo,
             nome,
             descricao,
             criterios,
             acionamentos,
             prioridade,
             ativo,
             origem,
             origem_arquivo,
             importado_em
           )
           values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, true, 'pdf', $7, now())
           on conflict (codigo) do update
           set
             nome = excluded.nome,
             descricao = excluded.descricao,
             criterios = excluded.criterios,
             acionamentos = excluded.acionamentos,
             prioridade = excluded.prioridade,
             ativo = true,
             origem = 'pdf',
             origem_arquivo = excluded.origem_arquivo,
             importado_em = excluded.importado_em
           returning codigo`,
          [
            protocolo.codigo,
            protocolo.nome,
            protocolo.descricao,
            JSON.stringify(protocolo.criterios),
            JSON.stringify(protocolo.acionamentos),
            protocolo.prioridade,
            filename,
          ],
        );

        codigosImportados.push(result.rows[0].codigo);
      }

      await client.query(
        `insert into auditoria (ocorrencia_id, evento, ator, detalhe)
         values (null, 'protocolos_importados', $1, $2::jsonb)`,
        [
          request.usuario.id,
          JSON.stringify({
            arquivo: filename,
            quantidade: codigosImportados.length,
            codigos: codigosImportados,
            recusados,
          }),
        ],
      );

      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    return {
      importados: codigosImportados.length,
      codigos_importados: codigosImportados,
      recusados,
    };
  });

  fastify.patch('/protocolos/:id/ativo', {
    config: {
      roles: papeisGestao,
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { ativo } = request.body || {};

    if (!uuidRegex.test(id)) {
      return reply.code(400).send({ error: 'Id de protocolo invalido.' });
    }

    if (typeof ativo !== 'boolean') {
      return reply.code(400).send({ error: 'Campo ativo precisa ser booleano.' });
    }

    const result = await pool.query(
      `update protocolos
       set ativo = $2
       where id = $1
       returning
         id,
         codigo,
         nome,
         prioridade,
         ativo,
         origem,
         origem_arquivo,
         importado_em`,
      [id, ativo],
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: 'Protocolo nao encontrado.' });
    }

    return { protocolo: result.rows[0] };
  });
}

module.exports = protocolosRoutes;
