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
    'veiculos_em_contato',
    'dano_visivel_em_veiculo',
    'destrocos_na_pista',
    'veiculo_fora_de_posicao',
    'veiculos_estacionados',
    'veiculos_parados_na_pista',
    'veiculos_em_movimento',
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
    veiculos_em_contato: { type: 'integer', minimum: 0 },
    dano_visivel_em_veiculo: { type: 'boolean' },
    destrocos_na_pista: { type: 'boolean' },
    veiculo_fora_de_posicao: { type: 'boolean' },
    veiculos_estacionados: { type: 'integer', minimum: 0 },
    veiculos_parados_na_pista: { type: 'integer', minimum: 0 },
    veiculos_em_movimento: { type: 'integer', minimum: 0 },
    bloqueio_via: { type: 'string', enum: ['nenhum', 'parcial', 'total'] },
    confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
    observacao: { type: 'string' },
    frame_evidencia: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['frame', 'tipo', 'descricao', 'estado', 'subtipo'],
        properties: {
          frame: { type: 'integer', minimum: 0 },
          tipo: {
            type: 'string',
            enum: ['veiculo', 'pessoa', 'fogo', 'fumaca', 'agua', 'carga', 'outro'],
          },
          descricao: { type: 'string' },
          subtipo: {
            anyOf: [
              {
                type: 'string',
                enum: ['carro', 'taxi', 'van', 'caminhao', 'onibus', 'motocicleta', 'autopropelido', 'bicicleta', 'outro'],
              },
              { type: 'null' },
            ],
          },
          estado: {
            anyOf: [
              { type: 'string', enum: ['estacionado', 'parado_na_pista', 'em_movimento', 'indeterminado'] },
              { type: 'null' },
            ],
          },
        },
      },
    },
  },
};

const prompt = [
  'Analise o video de uma cena de tunel.',
  'Preencha somente os campos do schema com fatos visuais observaveis.',
  'Use a nocao temporal do video antes de responder.',
  'A contagem exata pode variar; priorize detectar presenca e estado dos elementos que geram ocorrencia.',
  'Os protocolos dependem principalmente de presenca e estado: pessoa na pista, veiculo parado na faixa, fogo, fumaca, agua e bloqueio.',
  'A sequencia mostra a mesma cena ao longo do tempo: conte elementos unicos, nao aparicoes.',
  'Uma pessoa ou veiculo que se desloca entre quadros continua sendo o mesmo elemento e deve gerar um unico item de evidencia.',
  'Elementos so sao distintos quando aparecem simultaneamente no mesmo quadro ou quando ha caracteristica visivel que os diferencie, como cor, tipo ou posicao incompativel com deslocamento.',
  'Em caso de duvida sobre dois elementos ou o mesmo elemento em momentos diferentes, conte como um e registre a duvida na observacao.',
  'E preferivel subcontar a inflar a cena.',
  'Conte cada veiculo unico visivel ao longo de toda a sequencia, incluindo os que aparecem em apenas alguns quadros.',
  'A lista frame_evidencia deve conter um item para cada veiculo contado; se veiculos.moto = 2, deve haver 2 evidencias de subtipo motocicleta.',
  'Se veiculos.carro = 8, deve haver 8 evidencias de carro, taxi ou van quando esses elementos forem classificados como carro.',
  'Para cada veiculo observado, determine se esta estacionado, parado na pista, em movimento ou indeterminado.',
  'Caminhao e veiculo de carga pesada; van, furgao e utilitario de entrega contam como carro, nao como caminhao.',
  'Veiculo estacionado fora da faixa de rolamento nao conta como veiculo_parado.',
  'Veiculo parado sobre faixa de rolamento conta como veiculo_parado.',
  'veiculo_parado deve ser true somente quando veiculos_parados_na_pista for maior que zero.',
  'Veiculo que muda de posicao ao longo do video esta em movimento.',
  'Se nao for possivel determinar o movimento, use estado indeterminado.',
  'Nao use parado nem em_movimento como padrao.',
  'Se um veiculo aparece em apenas um quadro, ele conta e seu estado deve ser indeterminado.',
  'Conte cada pessoa unica visivel, mesmo que apareca em poucos quadros.',
  'pessoa_na_pista refere-se exclusivamente a pessoa na faixa de rolamento.',
  'Pessoa em calcada, passeio, canteiro ou area de seguranca nao conta como pessoa_na_pista.',
  'Distingua calcada e pista por meio-fio ou guia, mudanca de textura ou cor do piso e alinhamento com a trajetoria dos veiculos em movimento.',
  'Para cada pessoa em frame_evidencia, a descricao deve declarar explicitamente se esta na faixa de rolamento ou fora da pista.',
  'Em duvida sobre o limite entre calcada e pista, classifique como fora da pista e registre a duvida na observacao.',
  'Na observacao, descreva a cena com detalhe: quantos veiculos, onde estao, quantas pessoas e o que fazem.',
  'Relate veiculos_em_contato apenas quando veiculos estiverem encostados de forma anormal.',
  'Relate dano_visivel_em_veiculo apenas para amassado, deformacao, vidro quebrado ou dano aparente.',
  'Relate destrocos_na_pista apenas para pecas, cacos ou fragmentos visiveis na pista.',
  'Relate veiculo_fora_de_posicao para veiculo atravessado, contra o fluxo, capotado ou fora da orientacao esperada.',
  'Nao conclua que houve acidente; registre apenas fatos observaveis para a regra SQL decidir.',
  'Para frame_evidencia, use indice base 0 da lista de frames de evidencia enviada junto do video.',
  'frame_evidencia deve ser uma lista com um item para cada elemento unico relevante observado, nao um item por aparicao e nao um item por fato.',
  'Se o mesmo elemento aparece em varios frames, escolha o frame em que ele esta mais nitido.',
  'A descricao deve localizar o elemento na cena para o operador reconhecer qual e.',
  'subtipo deve usar apenas: carro, taxi, van, caminhao, onibus, motocicleta, autopropelido, bicicleta, outro; use null se nao souber.',
  'Para item do tipo veiculo, estado e obrigatorio: estacionado, parado_na_pista, em_movimento ou indeterminado.',
  'Para itens que nao sejam veiculo, estado deve ser null.',
  'Para pessoa, a descricao deve dizer se esta na faixa de rolamento ou fora dela.',
  'Nao classifique gravidade, nao sugira acionamento, nao identifique pessoas, nao estime obito e nao leia placas.',
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

async function videoToContent(videoPath) {
  if (!videoPath) {
    throw new Error('nenhum video disponivel para analise');
  }

  const absolutePath = resolveStoragePath(videoPath);
  const bytes = await fs.readFile(absolutePath);
  const base64 = bytes.toString('base64');

  return {
    type: 'video_url',
    video_url: {
      url: `data:video/mp4;base64,${base64}`,
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
  const tiposPermitidos = new Set(['veiculo', 'pessoa', 'fogo', 'fumaca', 'agua', 'carga', 'outro']);
  const estadosVeiculo = new Set(['estacionado', 'parado_na_pista', 'em_movimento', 'indeterminado']);
  const subtiposPermitidos = new Set(['carro', 'taxi', 'van', 'caminhao', 'onibus', 'motocicleta', 'autopropelido', 'bicicleta', 'outro']);

  if (!Array.isArray(fatos.frame_evidencia)) {
    throw new Error('resposta de visao invalida: frame_evidencia deve ser lista');
  }

  const convertido = fatos.frame_evidencia.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`resposta de visao invalida: frame_evidencia[${index}]`);
    }

    if (!Number.isInteger(item.frame) || item.frame < 0 || item.frame >= amostras.length) {
      throw new Error(`resposta de visao invalida: frame_evidencia[${index}].frame`);
    }

    if (!tiposPermitidos.has(item.tipo)) {
      throw new Error(`resposta de visao invalida: frame_evidencia[${index}].tipo`);
    }

    if (typeof item.descricao !== 'string' || !item.descricao.trim()) {
      throw new Error(`resposta de visao invalida: frame_evidencia[${index}].descricao`);
    }

    if (item.subtipo !== null && !subtiposPermitidos.has(item.subtipo)) {
      throw new Error(`resposta de visao invalida: frame_evidencia[${index}].subtipo`);
    }

    if (item.tipo === 'veiculo') {
      if (!estadosVeiculo.has(item.estado)) {
        throw new Error(`resposta de visao invalida: frame_evidencia[${index}].estado`);
      }
    } else if (item.estado !== null) {
      throw new Error(`resposta de visao invalida: estado deve ser null para ${item.tipo}`);
    }

    return {
      frame: amostras[item.frame].indiceOriginal,
      tipo: item.tipo,
      descricao: item.descricao.trim(),
      subtipo: item.subtipo,
      estado: item.estado,
    };
  });

  if (fatos.veiculo_parado !== (fatos.veiculos_parados_na_pista > 0)) {
    throw new Error('resposta de visao invalida: veiculo_parado incoerente');
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
    'dano_visivel_em_veiculo',
    'destrocos_na_pista',
    'veiculo_fora_de_posicao',
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

  if (!Number.isInteger(fatos.veiculos_estacionados) || fatos.veiculos_estacionados < 0) {
    throw new Error('resposta de visao invalida: veiculos_estacionados');
  }

  if (!Number.isInteger(fatos.veiculos_parados_na_pista) || fatos.veiculos_parados_na_pista < 0) {
    throw new Error('resposta de visao invalida: veiculos_parados_na_pista');
  }

  if (!Number.isInteger(fatos.veiculos_em_movimento) || fatos.veiculos_em_movimento < 0) {
    throw new Error('resposta de visao invalida: veiculos_em_movimento');
  }

  if (!Number.isInteger(fatos.veiculos_em_contato) || fatos.veiculos_em_contato < 0) {
    throw new Error('resposta de visao invalida: veiculos_em_contato');
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
  fatos.veiculos_parados = fatos.veiculos_estacionados + fatos.veiculos_parados_na_pista;

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

async function chamarChatCompletions({ conteudo, signal }) {
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
              text: 'Preencha os campos do schema a partir deste video. Use os frames de evidencia apenas para escolher a imagem representativa exibida ao operador.',
            },
            ...conteudo,
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

async function analisarVideo({ video, frames = [], videoTruncado = false }) {
  if (!config.visionApiKey) {
    throw new Error('VISION_API_KEY nao configurada');
  }

  const inicio = Date.now();
  const selecionados = selecionarAmostraComIndices(frames, config.visionFramesEvidencia);
  const videoContent = await videoToContent(video);
  const partesPorFrame = await Promise.all(selecionados.map(frameToContentParts));
  const conteudo = [videoContent, ...partesPorFrame.flat()];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.visionTimeoutMs);

  try {
    let fatos;

    if (['openai', 'openai-compatible', 'lovable'].includes(config.visionProvider)) {
      fatos = await chamarChatCompletions({
        conteudo,
        signal: controller.signal,
      });
    } else {
      throw new Error(`VISION_PROVIDER nao suportado: ${config.visionProvider}`);
    }

    const fatosValidados = validarFatos(fatos, selecionados);
    if (videoTruncado) {
      fatosValidados.observacao = `${fatosValidados.observacao} Video truncado para analise.`;
    }

    return {
      fatos: fatosValidados,
      provider: config.visionProvider,
      model: config.visionModel,
      duracao_ms: Date.now() - inicio,
      frames_enviados: selecionados.length,
      video_enviado: video,
      video_truncado: videoTruncado,
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
  analisarVideo,
  authHeadersPorProvedor,
  selecionarAmostra,
  selecionarAmostraComIndices,
  visionSchema,
};
