const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('../config');
const { pool } = require('../db');
const { resolveStoragePath } = require('../storage');

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

function camposDoProtocolo(protocolo) {
  const criterios = protocolo?.criterios;
  if (!criterios || typeof criterios !== 'object') {
    return [];
  }

  const campos = [];
  for (const grupo of ['todos', 'algum', 'nenhum']) {
    if (!Array.isArray(criterios[grupo])) {
      continue;
    }

    for (const condicao of criterios[grupo]) {
      if (typeof condicao?.campo === 'string') {
        campos.push(condicao.campo);
      }
    }
  }

  return campos;
}

const camposPorTipoEvidencia = {
  veiculo: [
    'veiculo_parado',
    'veiculos.carro',
    'veiculos.moto',
    'veiculos.caminhao',
    'veiculos.onibus',
    'veiculos_estacionados',
    'veiculos_parados_na_pista',
    'veiculos_em_movimento',
  ],
  pessoa: ['pessoa_na_pista', 'pessoa_ao_solo'],
  fogo: ['fogo'],
  fumaca: ['fumaca'],
  agua: ['agua_na_pista'],
  carga: ['carga_derramada'],
};

function selecionarFrameEvidencia(ocorrencia, protocolo) {
  const frames = Array.isArray(ocorrencia.frames) ? ocorrencia.frames : [];
  const evidencias = ocorrencia.fatos?.frame_evidencia;

  const campos = camposDoProtocolo(protocolo);

  if (Array.isArray(evidencias)) {
    const tiposRelacionados = new Set();
    for (const [tipo, camposTipo] of Object.entries(camposPorTipoEvidencia)) {
      if (campos.some((campo) => camposTipo.includes(campo))) {
        tiposRelacionados.add(tipo);
      }
    }

    const evidenciaRelacionada = evidencias.find((item) => (
      tiposRelacionados.has(item.tipo) && Number.isInteger(item.frame) && frames[item.frame]
    ));

    if (evidenciaRelacionada) {
      return frames[evidenciaRelacionada.frame];
    }

    const primeiraEvidencia = evidencias.find((item) => Number.isInteger(item.frame) && frames[item.frame]);
    if (primeiraEvidencia) {
      return frames[primeiraEvidencia.frame];
    }
  }

  if (evidencias && typeof evidencias === 'object' && !Array.isArray(evidencias)) {
    for (const campo of campos) {
      const indice = evidencias[campo];
      if (Number.isInteger(indice) && frames[indice]) {
        return frames[indice];
      }
    }

    for (const indice of Object.values(evidencias)) {
      if (Number.isInteger(indice) && frames[indice]) {
        return frames[indice];
      }
    }
  }

  return ocorrencia.frame_principal || frames[0] || null;
}

function mimeTypeFor(framePath) {
  const ext = path.extname(framePath).toLowerCase();
  if (ext === '.png') {
    return 'image/png';
  }
  if (ext === '.webp') {
    return 'image/webp';
  }
  return 'image/jpeg';
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
    if (ocorrencia.protocolo_escolhido_id && Array.isArray(ocorrencia.protocolos_casados)) {
      const escolhido = ocorrencia.protocolos_casados.find((protocolo) => (
        protocolo.protocolo_id === ocorrencia.protocolo_escolhido_id
      ));

      if (escolhido) {
        return escolhido;
      }
    }

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

async function uploadMediaImagem(framePath) {
  const absolutePath = resolveStoragePath(framePath);
  const bytes = await fs.readFile(absolutePath);
  const formData = new FormData();

  formData.append('messaging_product', 'whatsapp');
  formData.append('file', new Blob([bytes], { type: mimeTypeFor(framePath) }), path.basename(framePath));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.whatsappTimeoutMs);

  try {
    const response = await fetch(
      `https://graph.facebook.com/v20.0/${config.whatsappPhoneNumberId}/media`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${config.whatsappToken}`,
        },
        body: formData,
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
      throw new Error(`Meta media respondeu ${response.status}: ${payloadText.slice(0, 1000)}`);
    }

    if (!payload.id) {
      throw new Error('Meta media nao retornou id');
    }

    return payload.id;
  } catch (error) {
    throw new Error(sanitizarErro(error));
  } finally {
    clearTimeout(timeout);
  }
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

async function enviarMensagemImagem({ texto, framePath }) {
  const destinoMascarado = mascararDestino(config.whatsappDestino);
  const mediaId = await uploadMediaImagem(framePath);

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
          type: 'image',
          image: {
            id: mediaId,
            caption: texto,
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
      media_id: mediaId,
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
       o.fatos,
       o.protocolos_casados,
       o.protocolo_escolhido_id,
       o.acionamentos_definidos,
       o.orientacao_campo,
       o.frame_principal,
       o.frame_escolhido,
       o.frames,
       c.tunel
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
  const frameEvidencia = ocorrencia.frame_escolhido || selecionarFrameEvidencia(ocorrencia, protocolo);

  try {
    let envio;
    let imagemIncluida = false;
    let mediaId = null;

    if (config.whatsappAtivo && frameEvidencia) {
      try {
        envio = await enviarMensagemImagem({ texto, framePath: frameEvidencia });
        imagemIncluida = true;
        mediaId = envio.media_id;
      } catch (imageError) {
        logError(
          log,
          { err: sanitizarErro(imageError), ocorrencia_id: ocorrenciaId, frame: frameEvidencia },
          'falha ao enviar imagem whatsapp; tentando texto',
        );
      }
    }

    if (!envio) {
      envio = await enviarMensagemTexto({ texto, log });
    }

    if (!envio.enviado) {
      return;
    }

    await registrarAuditoriaNotificacao({
      ocorrenciaId,
      evento: 'notificacao_enviada',
      detalhe: {
        destino: envio.destino,
        message_id: envio.message_id,
        imagem_incluida: imagemIncluida,
        frame: imagemIncluida ? frameEvidencia : null,
        media_id: mediaId,
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
        imagem_incluida: false,
        frame: frameEvidencia,
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
  selecionarFrameEvidencia,
  selecionarProtocoloAplicado,
  selecionarProtocoloCasado,
};
