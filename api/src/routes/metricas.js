const { pool } = require('../db');

const papeisPainel = ['gestor', 'admin'];
const umDiaMs = 24 * 60 * 60 * 1000;

function parseData(value, campo, fimDoDia = false) {
  if (!value) {
    return null;
  }

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const data = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);

  if (Number.isNaN(data.getTime())) {
    const error = new Error(`Parametro ${campo} invalido.`);
    error.statusCode = 400;
    throw error;
  }

  if (dateOnly && fimDoDia) {
    return new Date(data.getTime() + umDiaMs);
  }

  return data;
}

function taxa(parte, total) {
  if (!total) {
    return null;
  }

  return Number(parte) / Number(total);
}

async function metricasRoutes(fastify) {
  fastify.get('/metricas', {
    config: {
      roles: papeisPainel,
    },
  }, async (request, reply) => {
    const agora = new Date();
    const de = parseData(request.query.de, 'de') || new Date(agora.getTime() - 30 * umDiaMs);
    const ate = parseData(request.query.ate, 'ate', true) || agora;

    if (de >= ate) {
      return reply.code(400).send({ error: 'Periodo invalido: de precisa ser anterior a ate.' });
    }

    const params = [de.toISOString(), ate.toISOString()];

    const [
      tempoResult,
      ocorrenciasResult,
      decisoesResult,
      acionadosResult,
      ajustadosResult,
    ] = await Promise.all([
      pool.query(
        `with base as (
           select extract(epoch from (decidida_em - detectada_em)) as segundos
           from ocorrencias
           where coalesce(detectada_em, created_at) >= $1
             and coalesce(detectada_em, created_at) < $2
             and decidida_em is not null
             and detectada_em is not null
             and status <> 'sem_ocorrencia'
         )
         select
           avg(segundos) as media_segundos,
           percentile_cont(0.5) within group (order by segundos) as mediana_segundos,
           count(*)::integer as total_decididas
         from base`,
        params,
      ),
      pool.query(
        `select
           count(*)::integer as total,
           count(*) filter (where status = 'aguardando_operador')::integer as aguardando_decisao,
           count(*) filter (where status = 'aprovada')::integer as aprovadas,
           count(*) filter (where status = 'descartada')::integer as descartadas
         from ocorrencias
         where coalesce(detectada_em, created_at) >= $1
           and coalesce(detectada_em, created_at) < $2
           and status <> 'sem_ocorrencia'`,
        params,
      ),
      pool.query(
        `select
           count(*) filter (where decisao = 'descartada')::integer as descartadas,
           count(*) filter (where decisao in ('aprovada', 'ajustada', 'descartada'))::integer as total_decididas,
           count(*) filter (where decisao = 'aprovada')::integer as aprovadas_sem_ajuste,
           count(*) filter (where decisao = 'ajustada')::integer as ajustadas,
           count(*) filter (where decisao in ('aprovada', 'ajustada'))::integer as total_avaliadas_motor
         from ocorrencias
         where coalesce(detectada_em, created_at) >= $1
           and coalesce(detectada_em, created_at) < $2
           and status <> 'sem_ocorrencia'`,
        params,
      ),
      pool.query(
        `select
           protocolo.item ->> 'codigo' as codigo,
           protocolo.item ->> 'nome' as nome,
           count(*)::integer as quantidade
         from ocorrencias o
         cross join lateral jsonb_array_elements(o.protocolos_casados) as protocolo(item)
         where coalesce(o.detectada_em, o.created_at) >= $1
           and coalesce(o.detectada_em, o.created_at) < $2
           and o.status <> 'sem_ocorrencia'
         group by codigo, nome
         order by quantidade desc, codigo asc
         limit 20`,
        params,
      ),
      pool.query(
        `select
           coalesce(sugerido.codigo, 'sem_sugestao') as sugerido_codigo,
           coalesce(sugerido.nome, 'Sem sugestao') as sugerido_nome,
           escolhido.codigo as escolhido_codigo,
           escolhido.nome as escolhido_nome,
           count(*)::integer as quantidade,
           count(*) filter (
             where o.protocolo_escolhido_id is not null
               and not exists (
                 select 1
                 from jsonb_array_elements(o.protocolos_casados) casado(item)
                 where casado.item ->> 'protocolo_id' = o.protocolo_escolhido_id::text
               )
           )::integer as escolhido_fora_dos_casados
         from ocorrencias o
         left join lateral (
           select
             protocolo.item ->> 'codigo' as codigo,
             protocolo.item ->> 'nome' as nome
           from jsonb_array_elements(o.protocolos_casados) as protocolo(item)
           order by
             case
               when protocolo.item ->> 'prioridade' ~ '^[0-9]+$'
                 then (protocolo.item ->> 'prioridade')::integer
               else 2147483647
             end asc,
             protocolo.item ->> 'codigo' asc
           limit 1
         ) sugerido on true
         left join protocolos escolhido on escolhido.id = o.protocolo_escolhido_id
         where coalesce(o.detectada_em, o.created_at) >= $1
           and coalesce(o.detectada_em, o.created_at) < $2
           and o.status <> 'sem_ocorrencia'
           and o.decisao = 'ajustada'
         group by
           sugerido.codigo,
           sugerido.nome,
           escolhido.codigo,
           escolhido.nome
         order by quantidade desc, escolhido_fora_dos_casados desc, sugerido_codigo asc
         limit 20`,
        params,
      ),
    ]);

    const tempo = tempoResult.rows[0];
    const ocorrencias = ocorrenciasResult.rows[0];
    const decisoes = decisoesResult.rows[0];

    return {
      periodo: {
        de: de.toISOString(),
        ate: ate.toISOString(),
      },
      tempo_decisao: {
        media_segundos: tempo.media_segundos === null ? null : Number(tempo.media_segundos),
        mediana_segundos: tempo.mediana_segundos === null ? null : Number(tempo.mediana_segundos),
        total_decididas: tempo.total_decididas,
      },
      ocorrencias_detectadas: {
        total: ocorrencias.total,
        por_status: {
          aguardando_decisao: ocorrencias.aguardando_decisao,
          aprovadas: ocorrencias.aprovadas,
          descartadas: ocorrencias.descartadas,
        },
      },
      taxa_descarte: {
        valor: taxa(decisoes.descartadas, decisoes.total_decididas),
        descartadas: decisoes.descartadas,
        total_decididas: decisoes.total_decididas,
      },
      acerto_motor_protocolos: {
        valor: taxa(decisoes.aprovadas_sem_ajuste, decisoes.total_avaliadas_motor),
        aprovadas_sem_ajuste: decisoes.aprovadas_sem_ajuste,
        ajustadas: decisoes.ajustadas,
        total_avaliadas: decisoes.total_avaliadas_motor,
      },
      protocolos_mais_acionados: acionadosResult.rows,
      protocolos_mais_ajustados: ajustadosResult.rows,
    };
  });
}

module.exports = metricasRoutes;
