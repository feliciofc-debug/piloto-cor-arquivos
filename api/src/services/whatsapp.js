const { config } = require('../config');
const { pool } = require('../db');

function logInfo(log, payload, message) {
  if (log && typeof log.info === 'function') {
    log.info(payload, message);
    return;
  }

  console.log(message, payload);
}

function logError(log, payload, message) {
  if (log && typeof log.error === 'function') {
    log.error(payload, message);
    return;
  }

  console.error(message, payload);
}

function mascararDestino(destino) {
  const digitos = String(destino || '').replace(/\D/g, '');
  const ultimos = digitos.slice(-4);
  return `********${ultimos || '0000'}`;
}

function sanitizarErro(error) {
  const mensagem = error?.message || String(error);
  if (!config.whatsappToken) {
    return mensagem;
  }

  return mensagem.split(config.whatsappToken).join('[token-redigido]');
}

function prioridadeNumerica(protocolo) {
  const prioridade = Number(protocolo?.prioridade);
  return Number.isFinite(prioridade) ? prioridade : Number.MAX_SAFE_INTEGER;
}

function acionamentosDoProtocolo(protocolo) {
  if (!protocolo || protocolo.acionamentos_suprimidos) {
    return [];
  }

  if (Array.isArray(protocolo.acionamentos_sugeridos)) {
    return protocolo.acionamentos_sugeridos;
  }

  return Array.isArray(protocolo.acionamentos) ? protocolo.acionamentos : [];
}

function acionamentosPrioridadeUm(protocolo) {
  return acionamentosDoProtocolo(protocolo).filter((acionamento) => (
    Number(acionamento?.prioridade) === 1 && acionamento.orgao
  ));
}

function selecionarProtocoloCasado(protocolosCasados) {
  if (!Array.isArray(protocolosCasados)) {
    return null;
  }

  return [...protocolosCasados]
    .filter(Boolean)
    .sort((a, b) => {
      const prioridadeDiff = prioridadeNumerica(a) - prioridadeNumerica(b);
      if (prioridadeDiff !== 0) {
        return prioridadeDiff;
      }

      return String(a.codigo || '').localeCompare(String(b.codigo || ''));
    })[0] || null;
}

function selecionarProtocoloAplicado(ocorrencia) {
  if (ocorrencia.decisao === 'aprovada' || ocorrencia.decisao === 'ajustada') {
    return selecionarProtocoloCasado(ocorrencia.protocolos_casados);
  }

  return null;
}

function formatarDataMensagem(value) {
  if (!value) {
    return 'não informado';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function montarMensagem({ ocorrencia, protocolo, acionamentos }) {
  const local = ocorrencia.tunel || ocorrencia.origem || 'Upload';
  const linhasAcionamentos = acionamentos.map((acionamento) => (
    `- ${acionamento.orgao}, prioridade ${acionamento.prioridade}`
  ));

  const mensagem = [
    'Piloto COR - ocorrência aprovada por operador',
    '',
    `Local: ${local}`,
    `Detecção: ${formatarDataMensagem(ocorrencia.detectada_em || ocorrencia.created_at)}`,
    `Protocolo aplicável segundo a regra: ${protocolo.codigo} - ${protocolo.nome}`,
    'Órgãos a acionar:',
    ...linhasAcionamentos,
  ];

  if (ocorrencia.orientacao_campo) {
    mensagem.push('', `Orientação para a equipe em campo: ${ocorrencia.orientacao_campo}`);
  }

  return mensagem.join('\n');
}

async function enviarMensagemTexto({ texto, log }) {
  const destinoMascarado = mascararDestino(config.whatsappDestino);

  if (!config.whatsappAtivo) {
    logInfo(log, { destino: destinoMascarado }, 'whatsapp inativo; notificacao nao enviada');
    return {
      enviado: false,
      motivo: 'whatsapp_inativo',
      destino: destinoMascarado,
      message_id: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.whatsappTimeoutMs);

  try {
    const response = await fetch(
      `https://graph.facebook.com/v20.0/${config.whatsappPhoneNumberId}/messages`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${config.whatsappToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: config.whatsappDestino,
          type: 'text',
          text: {
            preview_url: false,
            body: texto,
          },
        }),
      },
    );

    const payloadText = await response.text();
    let payload = {};
    try {
      payload = JSON.parse(payloadText);
    } catch {
      payload = {};
    }

    if (!response.ok) {
      throw new Error(`Meta Graph respondeu ${response.status}: ${payloadText.slice(0, 1000)}`);
    }

    return {
      enviado: true,
      destino: destinoMascarado,
      message_id: payload.messages?.[0]?.id || null,
    };
  } catch (error) {
    throw new Error(sanitizarErro(error));
  } finally {
    clearTimeout(timeout);
  }
}

async function registrarAuditoriaNotificacao({ ocorrenciaId, evento, detalhe }) {
  await pool.query(
    `insert into auditoria (ocorrencia_id, evento, ator, detalhe)
     values ($1, $2, 'sistema', $3::jsonb)`,
    [ocorrenciaId, evento, JSON.stringify(detalhe)],
  );
}

async function notificarOcorrenciaDecidida(ocorrenciaId, log = console) {
  const result = await pool.query(
    `select
       o.id,
       o.origem,
       o.detectada_em,
       o.created_at,
       o.decisao,
       o.protocolos_casados,
       o.acionamentos_definidos,
       o.orientacao_campo,
       c.tunel,
       null as protocolo_escolhido_id
     from ocorrencias o
     left join cameras c on c.id = o.camera_id
     where o.id = $1
     limit 1`,
    [ocorrenciaId],
  );

  const ocorrencia = result.rows[0];
  if (!ocorrencia || !['aprovada', 'ajustada'].includes(ocorrencia.decisao)) {
    return;
  }

  const protocolo = selecionarProtocoloAplicado(ocorrencia);
  const acionamentos = (Array.isArray(ocorrencia.acionamentos_definidos)
    ? ocorrencia.acionamentos_definidos
    : []).filter((acionamento) => (
    Number(acionamento?.prioridade) === 1 && acionamento.orgao
  ));

  if (!protocolo || protocolo.acionamentos_suprimidos || acionamentos.length === 0) {
    logInfo(
      log,
      { ocorrencia_id: ocorrenciaId, decisao: ocorrencia.decisao },
      'ocorrencia decidida sem acionamento whatsapp aplicavel',
    );
    return;
  }

  const texto = montarMensagem({ ocorrencia, protocolo, acionamentos });
  const destinoMascarado = mascararDestino(config.whatsappDestino);

  try {
    const envio = await enviarMensagemTexto({ texto, log });

    if (!envio.enviado) {
      return;
    }

    await registrarAuditoriaNotificacao({
      ocorrenciaId,
      evento: 'notificacao_enviada',
      detalhe: {
        destino: envio.destino,
        message_id: envio.message_id,
        protocolo_codigo: protocolo.codigo,
        protocolo_nome: protocolo.nome,
      },
    });
  } catch (error) {
    const erro = sanitizarErro(error);
    logError(log, { err: erro, ocorrencia_id: ocorrenciaId }, 'falha ao enviar notificacao whatsapp');

    await registrarAuditoriaNotificacao({
      ocorrenciaId,
      evento: 'notificacao_falhou',
      detalhe: {
        destino: destinoMascarado,
        erro,
        protocolo_codigo: protocolo.codigo,
        protocolo_nome: protocolo.nome,
      },
    }).catch((auditError) => {
      logError(log, { err: auditError, ocorrencia_id: ocorrenciaId }, 'falha ao auditar notificacao whatsapp');
    });
  }
}

module.exports = {
  acionamentosPrioridadeUm,
  enviarMensagemTexto,
  mascararDestino,
  montarMensagem,
  notificarOcorrenciaDecidida,
  selecionarProtocoloAplicado,
  selecionarProtocoloCasado,
};
