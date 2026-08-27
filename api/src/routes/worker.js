const crypto = require('node:crypto');
const { config } = require('../config');
const { pool } = require('../db');

function hashToken(token) {
  return crypto.createHash('sha256').update(token || '').digest();
}

function tokenValido(recebido) {
  if (!config.workerToken || !recebido) {
    return false;
  }

  return crypto.timingSafeEqual(
    hashToken(recebido),
    hashToken(config.workerToken),
  );
}

function autenticarWorker(request, reply) {
  const token = request.headers['x-worker-token'];
  const tokenTexto = Array.isArray(token) ? token[0] : token;

  if (!tokenValido(tokenTexto)) {
    return reply.code(401).send({ error: 'Worker nao autorizado.' });
  }
}

function workerIdFrom(request) {
  const bodyWorkerId = request.body && request.body.worker_id;
  const headerWorkerId = request.headers['x-worker-id'];
  return String(bodyWorkerId || headerWorkerId || 'worker');
}

async function concluirComErro(client, job, erro, workerId) {
  const final = job.tentativas >= config.frameJobMaxAttempts;

  if (final) {
    await client.query(
      `update frame_jobs
       set status = 'erro',
           erro_mensagem = $2,
           claimed_by = $3,
           concluido_em = now()
       where id = $1`,
      [job.id, erro, workerId],
    );

    await client.query(
      `update ocorrencias
       set status = 'aguardando_operador'
       where id = $1`,
      [job.ocorrencia_id],
    );

    await client.query(
      `insert into auditoria (ocorrencia_id, evento, ator, detalhe)
       values ($1, 'frame_job_erro', $2, $3::jsonb)`,
      [
        job.ocorrencia_id,
        `worker:${workerId}`,
        JSON.stringify({
          job_id: job.id,
          erro,
          tentativas: job.tentativas,
        }),
      ],
    );

    return 'erro';
  }

  await client.query(
    `update frame_jobs
     set status = 'pendente',
         erro_mensagem = $2,
         claimed_by = null,
         claimed_at = null
     where id = $1`,
    [job.id, erro],
  );

  return 'pendente';
}

async function workerRoutes(fastify) {
  fastify.post('/worker/frame-claim', {
    config: {
      auth: false,
    },
    preHandler: autenticarWorker,
  }, async (request) => {
    const workerId = workerIdFrom(request);

    const result = await pool.query(
      `with next_job as (
         select id
         from frame_jobs
         where status = 'pendente'
         order by created_at asc
         for update skip locked
         limit 1
       )
       update frame_jobs fj
       set status = 'processando',
           claimed_by = $1,
           claimed_at = now(),
           tentativas = fj.tentativas + 1,
           erro_mensagem = null
       from next_job
       where fj.id = next_job.id
       returning
         fj.id,
         fj.ocorrencia_id,
         fj.origem,
         fj.destino_dir,
         fj.parametros,
         fj.tentativas`,
      [workerId],
    );

    const job = result.rows[0];
    if (!job) {
      return { job: null };
    }

    return { job };
  });

  fastify.post('/worker/frame-complete', {
    config: {
      auth: false,
    },
    preHandler: autenticarWorker,
  }, async (request, reply) => {
    const body = request.body || {};
    const jobId = body.job_id;
    const workerId = workerIdFrom(request);

    if (!jobId) {
      return reply.code(400).send({ error: 'job_id obrigatorio.' });
    }

    const client = await pool.connect();

    try {
      await client.query('begin');

      const jobResult = await client.query(
        `select id, ocorrencia_id, status, tentativas
         from frame_jobs
         where id = $1
         for update`,
        [jobId],
      );

      const job = jobResult.rows[0];
      if (!job) {
        await client.query('rollback');
        return reply.code(404).send({ error: 'Job nao encontrado.' });
      }

      if (job.status !== 'processando') {
        await client.query('rollback');
        return reply.code(409).send({ error: `Job esta em status ${job.status}.` });
      }

      if (body.success === true) {
        const frames = Array.isArray(body.frames)
          ? body.frames.filter((frame) => typeof frame === 'string' && frame.length > 0)
          : [];
        const framePrincipal = frames[0] || null;

        await client.query(
          `update frame_jobs
           set status = 'concluido',
               claimed_by = $2,
               concluido_em = now(),
               erro_mensagem = null
           where id = $1`,
          [job.id, workerId],
        );

        await client.query(
          `update ocorrencias
           set frames = $2::jsonb,
               frame_principal = $3,
               -- Passo 3: ainda nao ha analise de visao; liberamos para validacao humana.
               -- No passo 4, este encadeamento passa pela analise antes do operador.
               status = 'aguardando_operador'
           where id = $1`,
          [
            job.ocorrencia_id,
            JSON.stringify(frames),
            framePrincipal,
          ],
        );

        await client.query(
          `insert into auditoria (ocorrencia_id, evento, ator, detalhe)
           values ($1, 'frames_extraidos', $2, $3::jsonb)`,
          [
            job.ocorrencia_id,
            `worker:${workerId}`,
            JSON.stringify({
              job_id: job.id,
              frames,
              duracao_ms: body.duracao_ms || null,
            }),
          ],
        );

        await client.query('commit');

        return { ok: true };
      }

      const erro = typeof body.erro === 'string' && body.erro.trim()
        ? body.erro.trim()
        : 'erro desconhecido no worker';

      const status = await concluirComErro(client, job, erro, workerId);
      await client.query('commit');

      return { ok: true, status };
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });
}

module.exports = workerRoutes;
