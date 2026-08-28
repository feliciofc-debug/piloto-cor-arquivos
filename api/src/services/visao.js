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
  },
};

const prompt = [
  'Analise as imagens de uma cena de tunel.',
  'Preencha somente os campos do schema com fatos visuais observaveis.',
  'Use contagens aproximadas quando necessario.',
  'A observacao deve ser curta e descritiva.',
].join(' ');

function selecionarAmostra(frames, limite) {
  if (frames.length <= limite) {
    return frames;
  }

  const selecionados = [];
  const ultimo = frames.length - 1;

  for (let index = 0; index < limite; index += 1) {
    const posicao = Math.round((index * ultimo) / (limite - 1));
    selecionados.push(frames[posicao]);
  }

  return selecionados;
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

function validarFatos(fatos) {
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

  return fatos;
}

async function chamarOpenAICompativel({ imagens, signal }) {
  const response = await fetch(`${config.visionApiBaseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      authorization: `Bearer ${config.visionApiKey}`,
      'content-type': 'application/json',
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
  const selecionados = selecionarAmostra(frames, config.visionMaxFrames);
  const imagens = await Promise.all(selecionados.map(frameToImageContent));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.visionTimeoutMs);

  try {
    let fatos;

    if (['openai', 'openai-compatible'].includes(config.visionProvider)) {
      fatos = await chamarOpenAICompativel({
        imagens,
        signal: controller.signal,
      });
    } else {
      throw new Error(`VISION_PROVIDER nao suportado: ${config.visionProvider}`);
    }

    return {
      fatos: validarFatos(fatos),
      provider: config.visionProvider,
      model: config.visionModel,
      duracao_ms: Date.now() - inicio,
      frames_enviados: imagens.length,
    };
  } catch (error) {
    error.frames_enviados = imagens.length;
    error.duracao_ms = Date.now() - inicio;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  analisarFrames,
  selecionarAmostra,
  visionSchema,
};
