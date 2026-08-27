const { createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { randomUUID } = require('node:crypto');
const { config } = require('../config');
const { pool } = require('../db');
const { resolveStoragePath } = require('../storage');

const extensoesPermitidas = new Set(['.mp4', '.mov', '.mkv', '.avi']);

function relativeToStorage(...segments) {
  return path.posix.join(...segments);
}

async function ocorrenciasRoutes(fastify) {
  fastify.post('/ocorrencias/upload', {
    config: {
      roles: ['operador', 'gestor', 'admin'],
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
