const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('../config');
const { resolveStoragePath } = require('../storage');

const visionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'veiculos',
    'pessoa_na_pista',
    'pessoa_ao_solo',
    'fogo',
    'fumaca',
    'carga_derramada',
    'agua_na_pista',
    'veiculo_parado',
    'bloqueio_via',
    'confianca',
    'observacao',
    'frame_evidencia',
  ],
  properties: {
    veiculos: {
      type: 'object',
      additionalProperties: false,
      required: ['carro', 'moto', 'caminhao', 'onibus'],
      properties: {
        carro: { type: 'integer', minimum: 0 },
        moto: { type: 'integer', minimum: 0 },
        caminhao: { type: 'integer', minimum: 0 },
        onibus: { type: 'integer', minimum: 0 },
      },
    },
    pessoa_na_pista: { type: 'boolean' },
    pessoa_ao_solo: { type: 'boolean' },
    fogo: { type: 'boolean' },
    fumaca: { type: 'boolean' },
    carga_derramada: { type: 'boolean' },
    agua_na_pista: { type: 'boolean' },
    veiculo_parado: { type: 'boolean' },
    bloqueio_via: { type: 'string', enum: ['nenhum', 'parcial', 'total'] },
    confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
    observacao: { type: 'string' },
    frame_evidencia: {
      type: 'object',
      additionalProperties: false,
      properties: {
        pessoa_na_pista: { type: 'integer', minimum: 0 },
        pessoa_ao_solo: { type: 'integer', minimum: 0 },
        fogo: { type: 'integer', minimum: 0 },
        fumaca: { type: 'integer', minimum: 0 },
        carga_derramada: { type: 'integer', minimum: 0 },
        agua_na_pista: { type: 'integer', minimum: 0 },
        veiculo_parado: { type: 'integer', minimum: 0 },
      },
    },
  },
};

const prompt = [
  'Analise as imagens de uma cena de tunel.',
  'Preencha somente os campos do schema com fatos visuais observaveis.',
  'Use contagens aproximadas quando necessario.',
  'A observacao deve ser curta e descritiva.',
  'Para frame_evidencia, use indice base 0 da lista de imagens enviada.',
  'Inclua evidencias somente para fatos booleanos marcados como true.',
].join(' ');

function selecionarAmostraComIndices(frames, limite) {
  if (frames.length <= limite) {
    return frames.map((frame, indiceOriginal) => ({ frame, indiceOriginal }));
  }

  const selecionados = [];
  const ultimo = frames.length - 1;

  for (let index = 0; index < limite; index += 1) {
    const posicao = Math.round((index * ultimo) / (limite - 1));
    selecionados.push({
      frame: frames[posicao],
      indiceOriginal: posicao,
    });
  }

  return selecionados;
}

function selecionarAmostra(frames, limite) {
  return selecionarAmostraComIndices(frames, limite).map((item) => item.frame);
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

async function frameToImageContent(framePath) {
  const absolutePath = resolveStoragePath(framePath);
  const bytes = await fs.readFile(absolutePath);
  const base64 = bytes.toString('base64');

  return {
    type: 'image_url',
    image_url: {
      url: `data:${mimeTypeFor(framePath)};base64,${base64}`,
    },
  };
}

async function frameToContentParts(amostra, indiceEnviado) {
  return [
    {
      type: 'text',
      text: `Frame enviado indice ${indiceEnviado}`,
    },
    await frameToImageContent(amostra.frame),
  ];
}

function validarFrameEvidencia(fatos, amostras) {
  const camposComEvidencia = [
    'pessoa_na_pista',
    'pessoa_ao_solo',
    'fogo',
    'fumaca',
    'carga_derramada',
    'agua_na_pista',
    'veiculo_parado',
  ];

  if (!fatos.frame_evidencia || typeof fatos.frame_evidencia !== 'object' || Array.isArray(fatos.frame_evidencia)) {
    throw new Error('resposta de visao invalida: frame_evidencia obrigatorio');
  }

  const camposPermitidos = new Set(camposComEvidencia);
  const convertido = {};

  for (const campo of Object.keys(fatos.frame_evidencia)) {
    if (!camposPermitidos.has(campo)) {
      throw new Error(`resposta de visao invalida: frame_evidencia.${campo}`);
    }

    if (fatos[campo] !== true) {
      throw new Error(`resposta de visao invalida: evidencia para fato falso ${campo}`);
    }

    const indiceEnviado = fatos.frame_evidencia[campo];
    if (!Number.isInteger(indiceEnviado) || indiceEnviado < 0 || indiceEnviado >= amostras.length) {
      throw new Error(`resposta de visao invalida: indice de evidencia ${campo}`);
    }

    convertido[campo] = amostras[indiceEnviado].indiceOriginal;
  }

  for (const campo of camposComEvidencia) {
    if (fatos[campo] === true && !Object.hasOwn(convertido, campo)) {
      throw new Error(`resposta de visao invalida: evidencia ausente para ${campo}`);
    }
  }

  fatos.frame_evidencia = convertido;
}

function validarFatos(fatos, amostras = []) {
  const camposBooleanos = [
    'pessoa_na_pista',
    'pessoa_ao_solo',
    'fogo',
    'fumaca',
    'carga_derramada',
    'agua_na_pista',
    'veiculo_parado',
  ];

  if (!fatos || typeof fatos !== 'object' || Array.isArray(fatos)) {
    throw new Error('resposta de visao invalida: objeto esperado');
  }

  const camposPermitidos = new Set(Object.keys(visionSchema.properties));
  for (const campo of Object.keys(fatos)) {
    if (!camposPermitidos.has(campo)) {
      throw new Error(`resposta de visao invalida: campo extra ${campo}`);
    }
  }

  if (!fatos.veiculos || typeof fatos.veiculos !== 'object' || Array.isArray(fatos.veiculos)) {
    throw new Error('resposta de visao invalida: veiculos obrigatorio');
  }

  for (const campo of ['carro', 'moto', 'caminhao', 'onibus']) {
    if (!Number.isInteger(fatos.veiculos[campo]) || fatos.veiculos[campo] < 0) {
      throw new Error(`resposta de visao invalida: veiculos.${campo}`);
    }
  }

  for (const campo of camposBooleanos) {
    if (typeof fatos[campo] !== 'boolean') {
      throw new Error(`resposta de visao invalida: ${campo}`);
    }
  }

  if (!['nenhum', 'parcial', 'total'].includes(fatos.bloqueio_via)) {
    throw new Error('resposta de visao invalida: bloqueio_via');
  }

  if (!['alta', 'media', 'baixa'].includes(fatos.confianca)) {
    throw new Error('resposta de visao invalida: confianca');
  }

  if (typeof fatos.observacao !== 'string') {
    throw new Error('resposta de visao invalida: observacao');
  }

  validarFrameEvidencia(fatos, amostras);

  return fatos;
}

function authHeadersPorProvedor() {
  if (config.visionProvider === 'lovable') {
    return {
      'Lovable-API-Key': config.visionApiKey,
    };
  }

  return {
    authorization: `Bearer ${config.visionApiKey}`,
  };
}

async function chamarChatCompletions({ imagens, signal }) {
  const visionPath = config.visionApiPath.startsWith('/')
    ? config.visionApiPath
    : `/${config.visionApiPath}`;

  const response = await fetch(`${config.visionApiBaseUrl}${visionPath}`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      ...authHeadersPorProvedor(),
    },
    body: JSON.stringify({
      model: config.visionModel,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'analise_tunel',
          strict: true,
          schema: visionSchema,
        },
      },
      messages: [
        {
          role: 'system',
          content: prompt,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Preencha os campos do schema a partir destas imagens.',
            },
            ...imagens,
          ],
        },
      ],
    }),
  });

  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after') || 'nao informado';
    throw new Error(`limite de taxa do provedor de visao atingido; Retry-After: ${retryAfter}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`provedor de visao respondeu ${response.status}: ${body.slice(0, 1000)}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('provedor de visao nao retornou conteudo');
  }

  return JSON.parse(content);
}

async function analisarFrames({ frames }) {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new Error('nenhum frame disponivel para analise');
  }

  if (!config.visionApiKey) {
    throw new Error('VISION_API_KEY nao configurada');
  }

  const inicio = Date.now();
  const selecionados = selecionarAmostraComIndices(frames, config.visionMaxFrames);
  const partesPorFrame = await Promise.all(selecionados.map(frameToContentParts));
  const imagens = partesPorFrame.flat();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.visionTimeoutMs);

  try {
    let fatos;

    if (['openai', 'openai-compatible', 'lovable'].includes(config.visionProvider)) {
      fatos = await chamarChatCompletions({
        imagens,
        signal: controller.signal,
      });
    } else {
      throw new Error(`VISION_PROVIDER nao suportado: ${config.visionProvider}`);
    }

    return {
      fatos: validarFatos(fatos, selecionados),
      provider: config.visionProvider,
      model: config.visionModel,
      duracao_ms: Date.now() - inicio,
      frames_enviados: selecionados.length,
    };
  } catch (error) {
    error.frames_enviados = selecionados.length;
    error.duracao_ms = Date.now() - inicio;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  analisarFrames,
  authHeadersPorProvedor,
  selecionarAmostra,
  selecionarAmostraComIndices,
  visionSchema,
};
