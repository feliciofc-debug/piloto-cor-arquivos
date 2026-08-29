const { pool } = require('../db');

function normalizarAcionamentos(acionamentos) {
  return Array.isArray(acionamentos) ? acionamentos : [];
}

function montarProtocoloCasado(row, confiancaBaixa) {
  const acionamentos = normalizarAcionamentos(row.acionamentos);

  return {
    protocolo_id: row.id,
    codigo: row.codigo,
    nome: row.nome,
    prioridade: row.prioridade,
    criterios: row.criterios,
    acionamentos,
    acionamentos_sugeridos: confiancaBaixa ? [] : acionamentos,
    acionamentos_suprimidos: confiancaBaixa,
    ...(confiancaBaixa ? { motivo_supressao: 'confianca_baixa' } : {}),
  };
}

async function casarProtocolos(fatos, client = pool) {
  if (!fatos) {
    return {
      protocolos: [],
      acionamentos_suprimidos: false,
    };
  }

  const confiancaBaixa = fatos.confianca === 'baixa';
  const result = await client.query(
    `select id, codigo, nome, prioridade, criterios, acionamentos
     from protocolos
     where ativo = true
       and protocol_criteria_matches($1::jsonb, criterios)
     order by prioridade asc, codigo asc`,
    [JSON.stringify(fatos)],
  );

  return {
    protocolos: result.rows.map((row) => montarProtocoloCasado(row, confiancaBaixa)),
    acionamentos_suprimidos: confiancaBaixa && result.rowCount > 0,
  };
}

module.exports = {
  casarProtocolos,
};
