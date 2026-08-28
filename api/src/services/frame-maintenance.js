const { config } = require('../config');
const { pool } = require('../db');

async function marcarErroFinal(client, job) {
  const erro = 'job expirou apos multiplas tentativas';

  await client.query(
    `update frame_jobs
     set status = 'erro',
         erro_mensagem = $2,
         concluido_em = now()
     where id = $1`,
    [job.id, erro],
  );

  await client.query(
    `update ocorrencias
     set status = 'aguardando_operador'
     where id = $1`,
    [job.ocorrencia_id],
  );

  await client.query(
    `insert into auditoria (ocorrencia_id, evento, ator, detalhe)
     values ($1, 'frame_job_erro', 'sistema', $2::jsonb)`,
    [
      job.ocorrencia_id,
      JSON.stringify({
        job_id: job.id,
        erro,
        tentativas: job.tentativas,
        claimed_by: job.claimed_by,
        claimed_at: job.claimed_at,
      }),
    ],
  );
}

async function reabrirJob(client, job) {
  await client.query(
    `update frame_jobs
     set status = 'pendente',
         claimed_by = null,
         claimed_at = null,
         erro_mensagem = 'job processando expirou e voltou para a fila'
     where id = $1`,
    [job.id],
  );
}

async function recuperarAnalisesExpiradas(client) {
  const result = await client.query(
    `select id, frames, created_at
     from ocorrencias
     where status = 'analisando'
       and jsonb_typeof(frames) = 'array'
       and jsonb_array_length(frames) > 0
       and created_at < now() - ($1::int * interval '1 minute')
     order by created_at asc
     for update skip locked`,
    [config.analiseTimeoutMinutes],
  );

  for (const ocorrencia of result.rows) {
    await client.query(
      `update ocorrencias
       set status = 'aguardando_operador',
           fatos = null,
           confianca = null
       where id = $1`,
      [ocorrencia.id],
    );

    await client.query(
      `insert into auditoria (ocorrencia_id, evento, ator, detalhe)
       values ($1, 'analise_falhou', 'sistema', $2::jsonb)`,
      [
        ocorrencia.id,
        JSON.stringify({
          erro: 'analise expirou',
          timeout_minutes: config.analiseTimeoutMinutes,
          frames: ocorrencia.frames,
        }),
      ],
    );
  }

  return result.rowCount;
}

async function runFrameMaintenance(log = console) {
  const client = await pool.connect();

  try {
    await client.query('begin');

    const result = await client.query(
      `select id, ocorrencia_id, tentativas, claimed_by, claimed_at
       from frame_jobs
       where status = 'processando'
         and claimed_at < now() - ($1::int * interval '1 minute')
       order by claimed_at asc
       for update skip locked`,
      [config.frameJobTimeoutMinutes],
    );

    for (const job of result.rows) {
      if (job.tentativas >= config.frameJobMaxAttempts) {
        await marcarErroFinal(client, job);
      } else {
        await reabrirJob(client, job);
      }
    }

    const analisesRecuperadas = await recuperarAnalisesExpiradas(client);

    await client.query('commit');

    if (result.rowCount > 0 || analisesRecuperadas > 0) {
      log.info(
        { jobs: result.rowCount, analises_recuperadas: analisesRecuperadas },
        'manutencao de frame_jobs executada',
      );
    }
  } catch (error) {
    await client.query('rollback').catch(() => {});
    log.error({ err: error }, 'falha na manutencao de frame_jobs');
  } finally {
    client.release();
  }
}

function startFrameMaintenance(fastify) {
  const interval = setInterval(() => {
    runFrameMaintenance(fastify.log);
  }, config.frameMaintenanceIntervalMs);

  interval.unref();

  fastify.addHook('onClose', async () => {
    clearInterval(interval);
  });

  return interval;
}

module.exports = {
  runFrameMaintenance,
  startFrameMaintenance,
};
