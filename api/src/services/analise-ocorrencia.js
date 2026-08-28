const { pool } = require('../db');
const { config } = require('../config');
const { analisarFrames } = require('./visao');

async function atualizarFalhaAnalise(client, ocorrenciaId, error, detalheExtra = {}) {
  await client.query(
    `update ocorrencias
     set status = 'aguardando_operador',
         fatos = null,
         confianca = null
     where id = $1`,
    [ocorrenciaId],
  );

  await client.query(
    `insert into auditoria (ocorrencia_id, evento, ator, detalhe)
     values ($1, 'analise_falhou', 'sistema', $2::jsonb)`,
    [
      ocorrenciaId,
      JSON.stringify({
        erro: error.message || String(error),
        provider: config.visionProvider,
        model: config.visionModel,
        duracao_ms: error.duracao_ms || null,
        frames_enviados: error.frames_enviados || 0,
        ...detalheExtra,
      }),
    ],
  );
}

async function analisarOcorrencia(ocorrenciaId, log = console) {
  const inicio = Date.now();

  try {
    const ocorrenciaResult = await pool.query(
      `select id, frames
       from ocorrencias
       where id = $1
       limit 1`,
      [ocorrenciaId],
    );

    const ocorrencia = ocorrenciaResult.rows[0];
    if (!ocorrencia) {
      throw new Error(`ocorrencia nao encontrada: ${ocorrenciaId}`);
    }

    const resultado = await analisarFrames({
      frames: ocorrencia.frames || [],
    });

    const client = await pool.connect();

    try {
      await client.query('begin');

      await client.query(
        `update ocorrencias
         set status = 'aguardando_operador',
             fatos = $2::jsonb,
             confianca = $3
         where id = $1`,
        [
          ocorrenciaId,
          JSON.stringify(resultado.fatos),
          resultado.fatos.confianca,
        ],
      );

      await client.query(
        `insert into auditoria (ocorrencia_id, evento, ator, detalhe)
         values ($1, 'analisada', 'sistema', $2::jsonb)`,
        [
          ocorrenciaId,
          JSON.stringify({
            fatos: resultado.fatos,
            provider: resultado.provider,
            model: resultado.model,
            duracao_ms: resultado.duracao_ms,
            frames_enviados: resultado.frames_enviados,
          }),
        ],
      );

      await client.query('commit');
      log.info({ ocorrencia_id: ocorrenciaId }, 'analise de visao concluida');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const client = await pool.connect();

    try {
      await client.query('begin');
      await atualizarFalhaAnalise(client, ocorrenciaId, error, {
        duracao_total_ms: Date.now() - inicio,
      });
      await client.query('commit');
      log.error({ err: error, ocorrencia_id: ocorrenciaId }, 'analise de visao falhou');
    } catch (auditError) {
      await client.query('rollback').catch(() => {});
      log.error({ err: auditError, ocorrencia_id: ocorrenciaId }, 'falha ao registrar erro da analise');
    } finally {
      client.release();
    }
  }
}

module.exports = {
  analisarOcorrencia,
  atualizarFalhaAnalise,
};
