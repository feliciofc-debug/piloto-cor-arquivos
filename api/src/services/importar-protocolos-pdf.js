const { config } = require('../config');
const { authHeadersPorProvedor } = require('./visao');

const camposFatoPermitidos = new Set([
  'veiculos.carro',
  'veiculos.moto',
  'veiculos.caminhao',
  'veiculos.onibus',
  'veiculos_estacionados',
  'veiculos_parados_na_pista',
  'veiculos_em_movimento',
  'pessoa_na_pista',
  'pessoa_ao_solo',
  'fogo',
  'fumaca',
  'carga_derramada',
  'agua_na_pista',
  'veiculo_parado',
  'bloqueio_via',
]);

const camposNumericos = new Set([
  'veiculos.carro',
  'veiculos.moto',
  'veiculos.caminhao',
  'veiculos.onibus',
  'veiculos_estacionados',
  'veiculos_parados_na_pista',
  'veiculos_em_movimento',
]);

const camposBooleanos = new Set([
  'pessoa_na_pista',
  'pessoa_ao_solo',
  'fogo',
  'fumaca',
  'carga_derramada',
  'agua_na_pista',
  'veiculo_parado',
]);

const valoresBloqueioVia = new Set(['nenhum', 'parcial', 'total']);
const operadores = ['igual', 'maior_que', 'menor_que'];

const protocoloImportSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['protocolos'],
  properties: {
    protocolos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['codigo', 'nome', 'descricao', 'prioridade', 'criterios', 'acionamentos'],
        properties: {
          codigo: { type: 'string' },
          nome: { type: 'string' },
          descricao: { type: 'string' },
          prioridade: { type: 'integer', minimum: 1 },
          criterios: {
            type: 'object',
            additionalProperties: false,
            required: ['todos', 'algum', 'nenhum'],
            properties: {
              todos: { type: 'array', items: { $ref: '#/$defs/condicao' } },
              algum: { type: 'array', items: { $ref: '#/$defs/condicao' } },
              nenhum: { type: 'array', items: { $ref: '#/$defs/condicao' } },
            },
          },
          acionamentos: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['orgao', 'prioridade'],
              properties: {
                orgao: { type: 'string' },
                prioridade: { type: 'integer', minimum: 1 },
              },
            },
          },
        },
      },
    },
  },
  $defs: {
    condicao: {
      type: 'object',
      additionalProperties: false,
      required: ['campo'],
      properties: {
        campo: { type: 'string' },
        igual: {
          anyOf: [
            { type: 'boolean' },
            { type: 'number' },
            { type: 'string' },
          ],
        },
        maior_que: { type: 'number' },
        menor_que: { type: 'number' },
      },
    },
  },
};

const promptImportacao = [
  'Extraia protocolos operacionais do PDF fornecido.',
  'Responda somente no schema informado.',
  'Cada criterio deve usar apenas estes campos de fatos observaveis:',
  Array.from(camposFatoPermitidos).join(', '),
  'Nao use confianca nem observacao como criterio.',
  'Use todos, algum e nenhum para representar as condicoes.',
  'Acionamentos devem conter orgao e prioridade numerica.',
].join(' ');

function textoObrigatorio(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validarCondicao(condicao, contexto, erros) {
  if (!condicao || typeof condicao !== 'object' || Array.isArray(condicao)) {
    erros.push(`${contexto}: condicao invalida`);
    return;
  }

  const campo = textoObrigatorio(condicao.campo);
  if (!campo) {
    erros.push(`${contexto}: campo obrigatorio`);
    return;
  }

  if (!camposFatoPermitidos.has(campo)) {
    erros.push(`${contexto}: campo fora do schema: ${campo}`);
    return;
  }

  const operadoresPresentes = operadores.filter((operador) => (
    Object.hasOwn(condicao, operador) && condicao[operador] !== undefined
  ));

  if (operadoresPresentes.length !== 1) {
    erros.push(`${contexto}: informe exatamente um operador`);
    return;
  }

  const operador = operadoresPresentes[0];
  const valor = condicao[operador];

  if (camposNumericos.has(campo) && typeof valor !== 'number') {
    erros.push(`${contexto}: ${campo} exige valor numerico`);
  }

  if (camposBooleanos.has(campo) && (operador !== 'igual' || typeof valor !== 'boolean')) {
    erros.push(`${contexto}: ${campo} exige igual booleano`);
  }

  if (campo === 'bloqueio_via' && (operador !== 'igual' || !valoresBloqueioVia.has(valor))) {
    erros.push(`${contexto}: bloqueio_via exige igual a nenhum, parcial ou total`);
  }
}

function validarCriterios(criterios, erros) {
  if (!criterios || typeof criterios !== 'object' || Array.isArray(criterios)) {
    erros.push('criterios invalidos');
    return;
  }

  let totalCondicoes = 0;

  for (const chave of ['todos', 'algum', 'nenhum']) {
    const condicoes = criterios[chave];
    if (!Array.isArray(condicoes)) {
      erros.push(`criterios.${chave} precisa ser array`);
      continue;
    }

    totalCondicoes += condicoes.length;
    condicoes.forEach((condicao, index) => {
      validarCondicao(condicao, `criterios.${chave}[${index}]`, erros);
    });
  }

  if (totalCondicoes === 0) {
    erros.push('protocolo sem nenhuma condicao');
  }
}

function validarAcionamentos(acionamentos, erros) {
  if (!Array.isArray(acionamentos) || acionamentos.length === 0) {
    erros.push('acionamentos obrigatorios');
    return;
  }

  acionamentos.forEach((acionamento, index) => {
    if (!acionamento || typeof acionamento !== 'object' || Array.isArray(acionamento)) {
      erros.push(`acionamentos[${index}]: acionamento invalido`);
      return;
    }

    if (!textoObrigatorio(acionamento.orgao)) {
      erros.push(`acionamentos[${index}]: orgao obrigatorio`);
    }

    if (!Number.isInteger(acionamento.prioridade) || acionamento.prioridade <= 0) {
      erros.push(`acionamentos[${index}]: prioridade obrigatoria`);
    }
  });
}

function validarProtocolosExtraidos(protocolos) {
  const aceitos = [];
  const recusados = [];
  const codigosNoPdf = new Set();

  if (!Array.isArray(protocolos)) {
    return {
      aceitos,
      recusados: [{ codigo: null, motivo: 'resposta sem lista de protocolos' }],
    };
  }

  protocolos.forEach((protocolo, index) => {
    const erros = [];
    const codigo = textoObrigatorio(protocolo?.codigo);
    const nome = textoObrigatorio(protocolo?.nome);
    const descricao = textoObrigatorio(protocolo?.descricao) || '';

    if (!codigo) {
      erros.push('codigo obrigatorio');
    } else if (codigosNoPdf.has(codigo)) {
      erros.push('codigo repetido no PDF');
    }

    if (!nome) {
      erros.push('nome obrigatorio');
    }

    if (!Number.isInteger(protocolo?.prioridade) || protocolo.prioridade <= 0) {
      erros.push('prioridade precisa ser inteiro positivo');
    }

    validarCriterios(protocolo?.criterios, erros);
    validarAcionamentos(protocolo?.acionamentos, erros);

    if (erros.length > 0) {
      recusados.push({
        codigo: codigo || `item_${index + 1}`,
        motivo: erros.join('; '),
      });
      return;
    }

    codigosNoPdf.add(codigo);
    aceitos.push({
      codigo,
      nome,
      descricao,
      criterios: protocolo.criterios,
      acionamentos: protocolo.acionamentos.map((acionamento) => ({
        orgao: textoObrigatorio(acionamento.orgao),
        prioridade: acionamento.prioridade,
      })),
      prioridade: protocolo.prioridade,
    });
  });

  return { aceitos, recusados };
}

async function chamarModeloProtocolosPdf({ pdfBuffer, filename }) {
  if (!config.visionApiKey) {
    throw new Error('VISION_API_KEY nao configurada');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.visionTimeoutMs);
  const visionPath = config.visionApiPath.startsWith('/')
    ? config.visionApiPath
    : `/${config.visionApiPath}`;

  try {
    const response = await fetch(`${config.visionApiBaseUrl}${visionPath}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...authHeadersPorProvedor(),
      },
      body: JSON.stringify({
        model: config.visionModel,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'protocolos_pdf',
            strict: true,
            schema: protocoloImportSchema,
          },
        },
        messages: [
          {
            role: 'system',
            content: promptImportacao,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extraia a lista de protocolos operacionais deste PDF.',
              },
              {
                type: 'file',
                file: {
                  filename,
                  file_data: `data:application/pdf;base64,${pdfBuffer.toString('base64')}`,
                },
              },
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
  } finally {
    clearTimeout(timeout);
  }
}

async function extrairProtocolosDoPdf({ pdfBuffer, filename }) {
  const resultado = await chamarModeloProtocolosPdf({ pdfBuffer, filename });
  return validarProtocolosExtraidos(resultado.protocolos);
}

module.exports = {
  camposFatoPermitidos,
  extrairProtocolosDoPdf,
  protocoloImportSchema,
  validarProtocolosExtraidos,
};
