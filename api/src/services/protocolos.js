const { pool } = require('../db');

function normalizarAcionamentos(acionamentos) {
  return Array.isArray(acionamentos) ? acionamentos : [];
}

function valorEmCampo(fatos, campo) {
  return campo.split('.').reduce((valor, parte) => (
    valor && typeof valor === 'object' ? valor[parte] : undefined
  ), fatos);
}

function condicaoBate(fatos, condicao) {
  const valor = valorEmCampo(fatos, condicao.campo || '');

  if (Object.hasOwn(condicao, 'igual')) {
    return valor === condicao.igual;
  }

  if (Object.hasOwn(condicao, 'maior_que')) {
    return Number(valor) > Number(condicao.maior_que);
  }

  if (Object.hasOwn(condicao, 'menor_que')) {
    return Number(valor) < Number(condicao.menor_que);
  }

  return false;
}

function operadorDaCondicao(condicao) {
  return ['igual', 'maior_que', 'menor_que'].find((operador) => Object.hasOwn(condicao, operador));
}

function evidenciaRelacionaComCampo(evidencia, campo) {
  if (!evidencia) {
    return false;
  }

  if (campo === 'veiculos.moto') {
    return evidencia.tipo === 'veiculo' && evidencia.subtipo === 'motocicleta';
  }

  if (campo === 'veiculos.caminhao') {
    return evidencia.tipo === 'veiculo' && evidencia.subtipo === 'caminhao';
  }

  if (campo === 'veiculos.onibus') {
    return evidencia.tipo === 'veiculo' && evidencia.subtipo === 'onibus';
  }

  if (campo === 'veiculos.carro') {
    return evidencia.tipo === 'veiculo' && ['carro', 'taxi', 'van'].includes(evidencia.subtipo);
  }

  if (campo === 'veiculos_estacionados') {
    return evidencia.tipo === 'veiculo' && evidencia.estado === 'estacionado';
  }

  if (campo === 'veiculos_parados_na_pista' || campo === 'veiculo_parado') {
    return evidencia.tipo === 'veiculo' && evidencia.estado === 'parado_na_pista';
  }

  if (campo === 'veiculos_em_movimento') {
    return evidencia.tipo === 'veiculo' && evidencia.estado === 'em_movimento';
  }

  if (campo === 'veiculos_em_contato' || campo === 'dano_visivel_em_veiculo' || campo === 'veiculo_fora_de_posicao') {
    return evidencia.tipo === 'veiculo';
  }

  if (campo === 'destrocos_na_pista') {
    return evidencia.tipo === 'outro';
  }

  if (campo === 'pessoa_na_pista' || campo === 'pessoa_ao_solo') {
    return evidencia.tipo === 'pessoa';
  }

  if (campo === 'fogo') {
    return evidencia.tipo === 'fogo';
  }

  if (campo === 'fumaca') {
    return evidencia.tipo === 'fumaca';
  }

  if (campo === 'agua_na_pista') {
    return evidencia.tipo === 'agua';
  }

  if (campo === 'carga_derramada') {
    return evidencia.tipo === 'carga';
  }

  return false;
}

function evidenciasDoCampo(fatos, campo) {
  const evidencias = Array.isArray(fatos.frame_evidencia) ? fatos.frame_evidencia : [];
  return evidencias.filter((evidencia) => evidenciaRelacionaComCampo(evidencia, campo));
}

function explicarCasamento(row, fatos) {
  const criterios = row.criterios || {};
  const camposResponsaveis = [];
  const evidencias = [];
  const evidenciasVistas = new Set();

  // O SQL e quem decide o casamento. Esta explicacao em JS nunca remove um
  // protocolo casado; se divergir do SQL, a explicacao fica incompleta.
  for (const grupo of ['todos', 'algum', 'nenhum']) {
    const condicoes = Array.isArray(criterios[grupo]) ? criterios[grupo] : [];

    for (const condicao of condicoes) {
      const operador = operadorDaCondicao(condicao);
      const bate = grupo === 'nenhum' ? !condicaoBate(fatos, condicao) : condicaoBate(fatos, condicao);

      if (!bate || !operador) {
        continue;
      }

      camposResponsaveis.push({
        campo: condicao.campo,
        grupo,
        operador,
        valor: condicao[operador],
      });

      for (const evidencia of evidenciasDoCampo(fatos, condicao.campo)) {
        const chave = `${condicao.campo}|${evidencia.frame}|${evidencia.tipo}|${evidencia.descricao}`;
        if (evidenciasVistas.has(chave)) {
          continue;
        }

        evidenciasVistas.add(chave);
        evidencias.push({
          campo: condicao.campo,
          frame: evidencia.frame,
          tipo: evidencia.tipo,
          subtipo: evidencia.subtipo ?? null,
          descricao: evidencia.descricao,
          estado: evidencia.estado ?? null,
        });
      }
    }
  }

  return {
    campos_responsaveis: camposResponsaveis,
    evidencias,
  };
}

function montarProtocoloCasado(row, confiancaBaixa, fatos) {
  const acionamentos = normalizarAcionamentos(row.acionamentos);
  const explicacao = explicarCasamento(row, fatos);

  return {
    protocolo_id: row.id,
    codigo: row.codigo,
    nome: row.nome,
    prioridade: row.prioridade,
    criterios: row.criterios,
    acionamentos,
    acionamentos_sugeridos: confiancaBaixa ? [] : acionamentos,
    acionamentos_suprimidos: confiancaBaixa,
    campos_responsaveis: explicacao.campos_responsaveis,
    evidencias: explicacao.evidencias,
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
    protocolos: result.rows.map((row) => montarProtocoloCasado(row, confiancaBaixa, fatos)),
    acionamentos_suprimidos: confiancaBaixa && result.rowCount > 0,
  };
}

module.exports = {
  casarProtocolos,
};
