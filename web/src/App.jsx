import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import './App.css';

const SessionContext = createContext(null);
const statusOptions = [
  { value: '', label: 'Todos os status' },
  { value: 'aguardando_operador', label: 'Aguardando operador' },
  { value: 'analisando', label: 'Analisando' },
  { value: 'aprovada', label: 'Aprovada' },
  { value: 'descartada', label: 'Descartada' },
  { value: 'expirada', label: 'Expirada' },
];

const fatoLabels = {
  carro: 'Carros',
  moto: 'Motos',
  caminhao: 'Caminhões',
  onibus: 'Ônibus',
  pessoa_na_pista: 'Pessoa na pista',
  pessoa_ao_solo: 'Pessoa ao solo',
  fogo: 'Fogo',
  fumaca: 'Fumaça',
  carga_derramada: 'Carga derramada',
  agua_na_pista: 'Água na pista',
  veiculo_parado: 'Veículo parado',
  veiculos_parados: 'Veículos parados',
  veiculos_estacionados: 'Veículos estacionados',
  veiculos_parados_na_pista: 'Veículos parados na pista',
  veiculos_em_movimento: 'Veículos em movimento',
  bloqueio_via: 'Bloqueio da via',
  confianca: 'Confiança',
  observacao: 'Observação',
};

const criterioLabels = {
  'veiculos.carro': 'Carros',
  'veiculos.moto': 'Motos',
  'veiculos.caminhao': 'Caminhões',
  'veiculos.onibus': 'Ônibus',
  pessoa_na_pista: 'Pessoa na pista',
  pessoa_ao_solo: 'Pessoa ao solo',
  fogo: 'Fogo',
  fumaca: 'Fumaça',
  carga_derramada: 'Carga derramada',
  agua_na_pista: 'Água na pista',
  veiculo_parado: 'Veículo parado',
  bloqueio_via: 'Bloqueio da via',
};

const tipoEvidenciaLabels = {
  veiculo: 'Veículos',
  pessoa: 'Pessoas',
  fogo: 'Fogo',
  fumaca: 'Fumaça',
  agua: 'Água',
  carga: 'Carga',
  outro: 'Outros',
};

const camposPorTipoEvidencia = {
  veiculo: ['veiculo_parado', 'veiculos.carro', 'veiculos.moto', 'veiculos.caminhao', 'veiculos.onibus'],
  pessoa: ['pessoa_na_pista', 'pessoa_ao_solo'],
  fogo: ['fogo'],
  fumaca: ['fumaca'],
  agua: ['agua_na_pista'],
  carga: ['carga_derramada'],
};

const estadoVeiculoLabels = {
  estacionado: 'estacionado',
  parado_na_pista: 'parado na pista',
  em_movimento: 'em movimento',
  indeterminado: 'indeterminado',
};

function navegar(path) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    const error = new Error(payload.error || 'Falha na comunicação com a API.');
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function uploadArquivo(path, file, onProgress, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('arquivo', file);

    const request = new XMLHttpRequest();
    request.open('POST', path);
    request.withCredentials = true;
    request.timeout = timeoutMs;

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    request.upload.onload = () => {
      if (typeof onProgress === 'function') {
        onProgress(100);
      }
    };

    request.onload = () => {
      let payload = {};
      try {
        payload = JSON.parse(request.responseText || '{}');
      } catch {
        payload = {};
      }

      if (request.status >= 200 && request.status < 300) {
        resolve(payload);
        return;
      }

      const error = new Error(payload.error || 'Falha no envio do arquivo.');
      error.status = request.status;
      reject(error);
    };

    request.onerror = () => reject(new Error('Falha de rede no envio do arquivo.'));
    request.ontimeout = () => reject(new Error('Tempo limite excedido. A importação pode levar até um minuto; tente novamente.'));
    request.onabort = () => reject(new Error('Envio cancelado.'));
    request.send(formData);
  });
}

function formatarData(value) {
  if (!value) {
    return 'Sem horário';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(value));
}

function formatarDataInput(date) {
  return date.toISOString().slice(0, 10);
}

function periodoPadrao() {
  const ate = new Date();
  const de = new Date(ate.getTime() - 30 * 24 * 60 * 60 * 1000);

  return {
    de: formatarDataInput(de),
    ate: formatarDataInput(ate),
  };
}

function formatarSegundos(value) {
  if (value === null || value === undefined) {
    return 'Sem dados';
  }

  const total = Math.round(Number(value));
  const minutos = Math.floor(total / 60);
  const segundos = total % 60;

  if (minutos <= 0) {
    return `${segundos}s`;
  }

  return `${minutos}min ${segundos}s`;
}

function formatarPercentual(value) {
  if (value === null || value === undefined) {
    return 'Sem dados';
  }

  return new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(value));
}

function formatarStatus(value) {
  const option = statusOptions.find((item) => item.value === value);
  return option ? option.label : value || 'Sem status';
}

function formatarValor(value) {
  if (typeof value === 'boolean') {
    return value ? 'Sim' : 'Não';
  }

  if (value === null || value === undefined || value === '') {
    return 'Não informado';
  }

  return String(value);
}

function formatarOperador(operador) {
  if (operador === 'igual') {
    return 'igual a';
  }
  if (operador === 'maior_que') {
    return 'maior que';
  }
  if (operador === 'menor_que') {
    return 'menor que';
  }
  return operador;
}

function formatarCondicao(condicao) {
  const operador = ['igual', 'maior_que', 'menor_que'].find((item) => (
    Object.hasOwn(condicao, item)
  ));

  if (!operador) {
    return `${criterioLabels[condicao.campo] || condicao.campo} sem operador`;
  }

  return `${criterioLabels[condicao.campo] || condicao.campo} ${formatarOperador(operador)} ${formatarValor(condicao[operador])}`;
}

function contarCriterios(criterios) {
  if (!criterios || typeof criterios !== 'object') {
    return 0;
  }

  return ['todos', 'algum', 'nenhum'].reduce((total, chave) => {
    const condicoes = criterios[chave];
    return total + (Array.isArray(condicoes) ? condicoes.length : 0);
  }, 0);
}

function listaFatos(fatos) {
  if (!fatos || typeof fatos !== 'object') {
    return [];
  }

  const veiculos = fatos.veiculos && typeof fatos.veiculos === 'object'
    ? Object.entries(fatos.veiculos).map(([key, value]) => ({
      label: fatoLabels[key] || key,
      value,
    }))
    : [];

  const demais = Object.entries(fatos)
    .filter(([key]) => key !== 'veiculos' && key !== 'frame_evidencia')
    .map(([key, value]) => ({
      label: fatoLabels[key] || key.replaceAll('_', ' '),
      value,
    }));

  return [...veiculos, ...demais];
}

function extrairFrame(item) {
  if (typeof item === 'string') {
    return item;
  }

  if (item && typeof item === 'object') {
    return item.path || item.caminho || item.frame || item.url || null;
  }

  return null;
}

function normalizarFrames(frames, framePrincipal) {
  let lista = frames;

  if (typeof frames === 'string') {
    try {
      lista = JSON.parse(frames);
    } catch {
      lista = [];
    }
  }

  const ordenados = [
    framePrincipal,
    ...(Array.isArray(lista) ? lista.map(extrairFrame) : []),
  ].filter(Boolean);

  return Array.from(new Set(ordenados));
}

function normalizarAcionamentosUi(acionamentos) {
  const porOrgao = new Map();

  for (const acionamento of Array.isArray(acionamentos) ? acionamentos : []) {
    const orgao = typeof acionamento?.orgao === 'string' ? acionamento.orgao.trim().replace(/\s+/g, ' ') : '';
    const prioridade = Number(acionamento?.prioridade);

    if (!orgao || !Number.isInteger(prioridade) || prioridade <= 0) {
      continue;
    }

    const chave = orgao.toLocaleLowerCase('pt-BR');
    const atual = porOrgao.get(chave);
    if (!atual || prioridade < atual.prioridade) {
      porOrgao.set(chave, { orgao, prioridade, ativo: true });
    }
  }

  return Array.from(porOrgao.values()).sort((a, b) => a.orgao.localeCompare(b.orgao, 'pt-BR'));
}

function acionamentosSugeridosUi(protocolos) {
  const acionamentos = [];

  for (const protocolo of Array.isArray(protocolos) ? protocolos : []) {
    if (protocolo?.acionamentos_suprimidos) {
      continue;
    }

    const lista = Array.isArray(protocolo?.acionamentos_sugeridos)
      ? protocolo.acionamentos_sugeridos
      : protocolo?.acionamentos;

    if (Array.isArray(lista)) {
      acionamentos.push(...lista);
    }
  }

  return normalizarAcionamentosUi(acionamentos);
}

function criterioUsaFato(criterios, fato) {
  if (!criterios || typeof criterios !== 'object') {
    return false;
  }

  return ['todos', 'algum', 'nenhum'].some((grupo) => (
    Array.isArray(criterios[grupo])
    && criterios[grupo].some((condicao) => condicao?.campo === fato)
  ));
}

function camposDosCriterios(criterios) {
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

  return Array.from(new Set(campos));
}

function protocolosPorFatos(protocolos, fatos) {
  const relacionados = (Array.isArray(protocolos) ? protocolos : []).filter((protocolo) => (
    fatos.some((fato) => criterioUsaFato(protocolo.criterios, fato))
  ));

  return relacionados.length > 0 ? relacionados : (Array.isArray(protocolos) ? protocolos : []);
}

function protocolosPorTipo(protocolos, tipo) {
  const campos = camposPorTipoEvidencia[tipo] || [];
  return protocolosPorFatos(protocolos, campos);
}

function montarEvidencias(ocorrencia) {
  const frames = normalizarFrames(ocorrencia.frames, ocorrencia.frame_principal);
  const evidencias = ocorrencia.fatos?.frame_evidencia;

  if (Array.isArray(evidencias)) {
    const lista = evidencias
      .filter((item) => Number.isInteger(item?.frame) && frames[item.frame])
      .map((item, index) => ({
        id: `${item.tipo}-${item.frame}-${index}`,
        frame: frames[item.frame],
        tipo: item.tipo,
        descricao: item.descricao,
        estado: item.estado,
        fatos: [],
        protocolos: protocolosPorTipo(ocorrencia.protocolos_casados, item.tipo),
        fallback: false,
      }));

    if (lista.length > 0) {
      return lista;
    }
  }

  if (!evidencias || typeof evidencias !== 'object' || Array.isArray(evidencias)) {
    return [{
      id: 'fallback',
      frame: ocorrencia.frame_principal || frames[0] || '',
      tipo: 'outro',
      descricao: 'Frame principal da ocorrência.',
      fatos: [],
      protocolos: Array.isArray(ocorrencia.protocolos_casados) ? ocorrencia.protocolos_casados : [],
      fallback: true,
    }];
  }

  const porFrame = new Map();

  for (const [fato, indice] of Object.entries(evidencias)) {
    if (!Number.isInteger(indice) || !frames[indice]) {
      continue;
    }

    const atual = porFrame.get(indice) || {
      id: `legado-${indice}`,
      frame: frames[indice],
      tipo: 'outro',
      descricao: 'Evidência registrada em formato anterior.',
      fatos: [],
    };

    atual.fatos.push(fato);
    porFrame.set(indice, atual);
  }

  const lista = Array.from(porFrame.values()).map((evidencia) => ({
    ...evidencia,
    protocolos: protocolosPorFatos(ocorrencia.protocolos_casados, evidencia.fatos),
    fallback: false,
  }));

  if (lista.length === 0) {
    return [{
      id: 'fallback',
      frame: ocorrencia.frame_principal || frames[0] || '',
      tipo: 'outro',
      descricao: 'Frame principal da ocorrência.',
      fatos: [],
      protocolos: Array.isArray(ocorrencia.protocolos_casados) ? ocorrencia.protocolos_casados : [],
      fallback: true,
    }];
  }

  return lista;
}

function agruparEvidencias(evidencias) {
  const grupos = new Map();

  for (const evidencia of evidencias) {
    const tipo = evidencia.tipo || 'outro';
    if (!grupos.has(tipo)) {
      grupos.set(tipo, []);
    }
    grupos.get(tipo).push(evidencia);
  }

  return Array.from(grupos.entries()).map(([tipo, itens]) => ({ tipo, itens }));
}

function BrandHeader({ compact = false }) {
  return (
    <div className={compact ? 'brand brand-compact' : 'brand'}>
      <img src="/brasao.svg" alt="Brasão temporário do piloto" />
      <span className="brand-divider" />
      <div>
        <strong>Centro de Operações</strong>
        <strong>e Resiliência</strong>
      </div>
    </div>
  );
}

function SessionProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);

  const carregarSessao = useCallback(async () => {
    try {
      const data = await api('/api/auth/eu');
      setUsuario(data.usuario);
    } catch (error) {
      if (error.status !== 401) {
        console.error(error);
      }
      setUsuario(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    carregarSessao();
  }, [carregarSessao]);

  const login = useCallback(async (email, senha) => {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, senha }),
    });
    setUsuario(data.usuario);
    return data.usuario;
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUsuario(null);
    navegar('/login');
  }, []);

  const value = useMemo(() => ({
    usuario,
    carregando,
    login,
    logout,
    carregarSessao,
  }), [usuario, carregando, login, logout, carregarSessao]);

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

function useSession() {
  return useContext(SessionContext);
}

function AppShell({ children }) {
  const { usuario, logout } = useSession();
  const podeVerPainel = usuario?.papel === 'gestor' || usuario?.papel === 'admin';

  return (
    <div className="app-shell">
      <header className="topbar">
        <BrandHeader compact />
        <div className="topbar-actions">
          <nav className="topbar-nav" aria-label="Navegação principal">
            <a href="/ocorrencias" onClick={(event) => { event.preventDefault(); navegar('/ocorrencias'); }}>
              Ocorrências
            </a>
            <a href="/protocolos" onClick={(event) => { event.preventDefault(); navegar('/protocolos'); }}>
              Protocolos
            </a>
            {podeVerPainel ? (
              <a href="/painel" onClick={(event) => { event.preventDefault(); navegar('/painel'); }}>
                Painel
              </a>
            ) : null}
          </nav>
          <span>{usuario?.nome || usuario?.email}</span>
          <button type="button" className="button button-ghost" onClick={logout}>
            Sair
          </button>
        </div>
      </header>
      <main className="page">
        {children}
      </main>
    </div>
  );
}

function LoginPage() {
  const { login } = useSession();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setErro('');
    setEnviando(true);

    try {
      await login(email, senha);
      navegar('/ocorrencias');
    } catch (error) {
      setErro(error.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <BrandHeader />
        <div>
          <p className="eyebrow">Piloto de monitoramento urbano</p>
          <h1>Acesso do operador</h1>
        </div>
        <form onSubmit={handleSubmit} className="form-stack">
          <label>
            E-mail
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(event) => setSenha(event.target.value)}
              required
            />
          </label>
          {erro ? <p className="form-error">{erro}</p> : null}
          <button type="submit" className="button button-primary" disabled={enviando}>
            {enviando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
        <footer>Piloto COR - monitoramento assistido de túneis</footer>
      </section>
    </main>
  );
}

function OcorrenciaCard({ ocorrencia }) {
  const protocolos = Array.isArray(ocorrencia.protocolos_casados)
    ? ocorrencia.protocolos_casados
    : [];

  return (
    <article className="occurrence-card">
      <button
        type="button"
        className="card-link"
        onClick={() => navegar(`/ocorrencias/${ocorrencia.id}`)}
      >
        <div className="thumb">
          {ocorrencia.frame_principal ? (
            <img src={`/api/midia/${ocorrencia.frame_principal}`} alt="Frame principal da ocorrência" />
          ) : (
            <span>Sem imagem</span>
          )}
        </div>
        <div className="card-body">
          <div className="card-title-row">
            <h2>{ocorrencia.tunel || 'Upload'}</h2>
            <span className={`status status-${ocorrencia.status}`}>
              {formatarStatus(ocorrencia.status)}
            </span>
          </div>
          <dl className="meta-grid">
            <div>
              <dt>Horário</dt>
              <dd>{formatarData(ocorrencia.horario)}</dd>
            </div>
            <div>
              <dt>Confiança</dt>
              <dd>{formatarValor(ocorrencia.confianca)}</dd>
            </div>
          </dl>
          <div className="protocol-list compact-list">
            {protocolos.length > 0 ? protocolos.map((protocolo) => (
              <span key={`${ocorrencia.id}-${protocolo.protocolo_id || protocolo.codigo}`}>
                {protocolo.codigo} - {protocolo.nome}
              </span>
            )) : (
              <span>Nenhum protocolo aplicável segundo a regra</span>
            )}
          </div>
        </div>
      </button>
    </article>
  );
}

function OcorrenciasPage() {
  const videoInputRef = useRef(null);
  const [ocorrencias, setOcorrencias] = useState([]);
  const [status, setStatus] = useState('');
  const [tunel, setTunel] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [uploadErro, setUploadErro] = useState('');
  const [uploadProgresso, setUploadProgresso] = useState(0);
  const [enviandoVideo, setEnviandoVideo] = useState(false);

  const carregar = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) {
      params.set('status', status);
    }
    if (tunel.trim()) {
      params.set('tunel', tunel.trim());
    }

    try {
      const data = await api(`/api/ocorrencias${params.toString() ? `?${params}` : ''}`);
      setOcorrencias(data.ocorrencias || []);
      setErro('');
    } catch (error) {
      setErro(error.message);
    } finally {
      setCarregando(false);
    }
  }, [status, tunel]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    carregar();
    const intervalId = window.setInterval(carregar, 15000);
    return () => window.clearInterval(intervalId);
  }, [carregar]);

  async function enviarVideo(event) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    setUploadErro('');
    setUploadProgresso(0);
    setEnviandoVideo(true);

    try {
      const data = await uploadArquivo('/api/ocorrencias/upload', file, setUploadProgresso);
      navegar(`/ocorrencias/${data.ocorrencia_id}`);
    } catch (error) {
      setUploadErro(error.message);
    } finally {
      setEnviandoVideo(false);
    }
  }

  return (
    <AppShell>
      <section className="page-heading">
        <p className="eyebrow">Fila do operador</p>
        <h1>Ocorrências</h1>
      </section>

      <section className="card upload-card">
        <div>
          <p className="eyebrow">Demonstração</p>
          <h2>Enviar vídeo do acervo</h2>
          <p>O sistema extrai os frames, analisa a cena e cruza os fatos com os protocolos ativos.</p>
        </div>
        <button
          type="button"
          className="button button-primary"
          disabled={enviandoVideo}
          onClick={() => videoInputRef.current?.click()}
        >
          {enviandoVideo ? 'Enviando...' : 'Enviar vídeo'}
        </button>
        <input
          ref={videoInputRef}
          className="file-input-hidden"
          type="file"
          accept="video/mp4,video/quicktime,video/x-matroska,video/x-msvideo,.mp4,.mov,.mkv,.avi"
          onChange={enviarVideo}
          disabled={enviandoVideo}
        />
        {enviandoVideo ? (
          <div className="progress">
            <div style={{ width: `${uploadProgresso}%` }} />
            <span>{uploadProgresso}%</span>
          </div>
        ) : null}
        {uploadErro ? <p className="alert alert-error">{uploadErro}</p> : null}
      </section>

      <section className="filters card">
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          Túnel
          <input
            type="text"
            value={tunel}
            onChange={(event) => setTunel(event.target.value)}
            placeholder="Nome exato do túnel"
          />
        </label>
        <button type="button" className="button button-secondary" onClick={carregar}>
          Atualizar
        </button>
      </section>

      {erro ? <p className="alert alert-error">{erro}</p> : null}
      {carregando ? <p className="loading">Carregando ocorrências...</p> : null}

      <section className="occurrence-grid">
        {!carregando && ocorrencias.length === 0 ? (
          <div className="empty-state card">Nenhuma ocorrência encontrada.</div>
        ) : null}
        {ocorrencias.map((ocorrencia) => (
          <OcorrenciaCard key={ocorrencia.id} ocorrencia={ocorrencia} />
        ))}
      </section>
    </AppShell>
  );
}

function DecisionPanel({
  detalhe,
  onDecidido,
  acionamentos,
  setAcionamentos,
  orientacao,
  setOrientacao,
}) {
  const [motivo, setMotivo] = useState('');
  const [novoOrgao, setNovoOrgao] = useState('');
  const [novaPrioridade, setNovaPrioridade] = useState('1');
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [enviando, setEnviando] = useState('');
  const aguardando = detalhe.ocorrencia.status === 'aguardando_operador';
  const acionamentosAtivos = acionamentos.filter((acionamento) => acionamento.ativo);

  async function decidir(decisao, body = {}) {
    setErro('');
    setMensagem('');
    setEnviando(decisao);

    try {
      await api(`/api/ocorrencias/${detalhe.ocorrencia.id}/decidir`, {
        method: 'POST',
        body: JSON.stringify({ decisao, ...body }),
      });
      setMensagem('Decisão registrada.');
      await onDecidido();
    } catch (error) {
      setErro(error.message);
    } finally {
      setEnviando('');
    }
  }

  function alternarAcionamento(index) {
    setAcionamentos((atuais) => atuais.map((acionamento, itemIndex) => (
      itemIndex === index ? { ...acionamento, ativo: !acionamento.ativo } : acionamento
    )));
  }

  function alterarPrioridade(index, prioridade) {
    setAcionamentos((atuais) => atuais.map((acionamento, itemIndex) => (
      itemIndex === index ? { ...acionamento, prioridade: Number(prioridade) } : acionamento
    )));
  }

  function adicionarAcionamento() {
    const orgao = novoOrgao.trim();
    const prioridade = Number(novaPrioridade);

    if (!orgao || !Number.isInteger(prioridade) || prioridade <= 0) {
      return;
    }

    setAcionamentos((atuais) => normalizarAcionamentosUi([
      ...atuais.filter((acionamento) => acionamento.ativo),
      { orgao, prioridade },
    ]));
    setNovoOrgao('');
    setNovaPrioridade('1');
  }

  return (
    <section className="decision-card inline-decision">
      <p className="eyebrow">Decisão humana</p>
      <h2>Ações do operador</h2>
      {!aguardando ? (
        <p className="muted">Esta ocorrência não está aguardando decisão.</p>
      ) : null}
      {erro ? <p className="alert alert-error">{erro}</p> : null}
      {mensagem ? <p className="alert alert-success">{mensagem}</p> : null}
      <div className="decision-grid">
        <div className="action-editor">
          <h3>Acionamentos definidos</h3>
          <p>Altere os órgãos e prioridades antes de aprovar. A regra original fica preservada.</p>
          {acionamentos.map((acionamento, index) => (
            <div className="action-editor-row" key={`${acionamento.orgao}-${index}`}>
              <label>
                <input
                  type="checkbox"
                  checked={acionamento.ativo}
                  disabled={!aguardando}
                  onChange={() => alternarAcionamento(index)}
                />
                {acionamento.orgao}
              </label>
              <input
                type="number"
                min="1"
                value={acionamento.prioridade}
                disabled={!aguardando || !acionamento.ativo}
                onChange={(event) => alterarPrioridade(index, event.target.value)}
              />
            </div>
          ))}
          <div className="add-action-row">
            <input
              type="text"
              value={novoOrgao}
              onChange={(event) => setNovoOrgao(event.target.value)}
              placeholder="Adicionar órgão"
              disabled={!aguardando}
            />
            <input
              type="number"
              min="1"
              value={novaPrioridade}
              onChange={(event) => setNovaPrioridade(event.target.value)}
              disabled={!aguardando}
            />
            <button type="button" className="button button-secondary" disabled={!aguardando} onClick={adicionarAcionamento}>
              Adicionar
            </button>
          </div>
          <label>
            Orientação para a equipe em campo
            <textarea
              value={orientacao}
              onChange={(event) => setOrientacao(event.target.value)}
              disabled={!aguardando}
              rows="4"
            />
          </label>
        </div>
        <div className="decision-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={!aguardando || acionamentosAtivos.length === 0 || enviando === 'aprovada'}
            onClick={() => decidir('aprovada', {
              acionamentos_definidos: acionamentosAtivos.map(({ orgao, prioridade }) => ({ orgao, prioridade })),
              orientacao_campo: orientacao,
            })}
          >
            Aprovar
          </button>
          <h3>Descartar</h3>
          <p>Informe o motivo para descartar a ocorrência.</p>
          <textarea
            value={motivo}
            onChange={(event) => setMotivo(event.target.value)}
            disabled={!aguardando}
            rows="4"
          />
          <button
            type="button"
            className="button button-danger"
            disabled={!aguardando || !motivo.trim() || enviando === 'descartada'}
            onClick={() => decidir('descartada', { decisao_obs: motivo })}
          >
            Descartar
          </button>
        </div>
      </div>
    </section>
  );
}

function EvidenceCard({ evidencia, highlighted, onOpenImage, onProtocolClick }) {
  return (
    <article className={highlighted ? 'card evidence-row highlighted' : 'card evidence-row'}>
      {evidencia.frame ? (
        <button
          type="button"
          className="evidence-thumb"
          onClick={() => onOpenImage(evidencia.frame)}
        >
          <img src={`/api/midia/${evidencia.frame}`} alt="Frame de evidência da ocorrência" />
        </button>
      ) : (
        <div className="empty-frame">Sem frame disponível</div>
      )}
      <div className="evidence-content">
        <div>
          <p className="eyebrow">Evidência identificada pela análise</p>
          <h2>{tipoEvidenciaLabels[evidencia.tipo] || 'Evidência'}</h2>
          <p>{evidencia.descricao}</p>
          {evidencia.tipo === 'veiculo' ? (
            <p className="vehicle-state">
              Estado: {estadoVeiculoLabels[evidencia.estado] || 'não informado'}
            </p>
          ) : null}
          {evidencia.fatos.length > 0 ? (
            <div className="compact-list">
              {evidencia.fatos.map((fato) => (
                <span key={fato}>{fatoLabels[fato] || fato.replaceAll('_', ' ')}</span>
              ))}
            </div>
          ) : (
            <p className="muted">Ocorrência sem frame_evidencia. Exibindo o frame principal.</p>
          )}
        </div>
        <div>
          <h3>Protocolos aplicáveis segundo a regra</h3>
          <div className="protocol-list compact-list">
            {evidencia.protocolos.length > 0 ? evidencia.protocolos.map((protocolo) => (
              <button
                type="button"
                className="protocol-chip"
                key={`${evidencia.frame}-${protocolo.protocolo_id || protocolo.codigo}`}
                onClick={() => onProtocolClick(protocolo)}
              >
                {protocolo.codigo} - {protocolo.nome}
              </button>
            )) : (
              <span>Nenhum protocolo relacionado a esta evidência</span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function ImageModal({ frame, onClose }) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    if (frame) {
      window.addEventListener('keydown', onKeyDown);
    }

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [frame, onClose]);

  if (!frame) {
    return null;
  }

  return (
    <div className="image-modal" role="dialog" aria-modal="true">
      <div className="image-modal-content">
        <button type="button" className="button button-ghost image-modal-close" onClick={onClose}>
          Fechar
        </button>
        <img src={`/api/midia/${frame}`} alt="Frame de evidência ampliado" />
      </div>
    </div>
  );
}

function OcorrenciaDetalhePage({ id }) {
  const [detalhe, setDetalhe] = useState(null);
  const [frameAtual, setFrameAtual] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [mostrarTodosFrames, setMostrarTodosFrames] = useState(false);
  const [acionamentos, setAcionamentos] = useState([]);
  const [orientacao, setOrientacao] = useState('');
  const [imagemAmpliada, setImagemAmpliada] = useState('');
  const [framesDestacados, setFramesDestacados] = useState([]);
  const [avisoEvidencia, setAvisoEvidencia] = useState('');

  const carregar = useCallback(async () => {
    try {
      const data = await api(`/api/ocorrencias/${id}`);
      setDetalhe(data);
      const frames = normalizarFrames(data.ocorrencia.frames, data.ocorrencia.frame_principal);
      setFrameAtual((atual) => (atual && frames.includes(atual) ? atual : frames[0] || ''));
      setErro('');
    } catch (error) {
      setErro(error.message);
    } finally {
      setCarregando(false);
    }
  }, [id]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    carregar();
  }, [carregar]);

  useEffect(() => {
    if (detalhe?.ocorrencia?.status !== 'analisando') {
      return undefined;
    }

    const intervalId = window.setInterval(carregar, 5000);
    return () => window.clearInterval(intervalId);
  }, [carregar, detalhe?.ocorrencia?.status]);

  useEffect(() => {
    if (!detalhe) {
      return;
    }

    const definidos = Array.isArray(detalhe.ocorrencia.acionamentos_definidos)
      && detalhe.ocorrencia.acionamentos_definidos.length > 0
      ? normalizarAcionamentosUi(detalhe.ocorrencia.acionamentos_definidos)
      : acionamentosSugeridosUi(detalhe.ocorrencia.protocolos_casados);

    // oxlint-disable-next-line react/set-state-in-effect
    setAcionamentos(definidos);
    // oxlint-disable-next-line react/set-state-in-effect
    setOrientacao(detalhe.ocorrencia.orientacao_campo || '');
  }, [detalhe]);

  const sequenciaFrames = useMemo(() => (
    normalizarFrames(detalhe?.ocorrencia?.frames, detalhe?.ocorrencia?.frame_principal)
  ), [detalhe]);

  const frameIndex = sequenciaFrames.indexOf(frameAtual);
  const framePosicao = frameIndex >= 0 ? frameIndex : 0;
  const totalFrames = sequenciaFrames.length;
  const evidencias = useMemo(() => (
    detalhe ? montarEvidencias(detalhe.ocorrencia) : []
  ), [detalhe]);
  const gruposEvidencia = useMemo(() => agruparEvidencias(evidencias), [evidencias]);

  const irParaFrame = useCallback((direcao) => {
    setFrameAtual((atual) => {
      if (sequenciaFrames.length === 0) {
        return '';
      }

      const indiceAtual = Math.max(0, sequenciaFrames.indexOf(atual));
      const proximoIndice = Math.min(
        sequenciaFrames.length - 1,
        Math.max(0, indiceAtual + direcao),
      );

      return sequenciaFrames[proximoIndice];
    });
  }, [sequenciaFrames]);

  function destacarProtocolo(protocolo) {
    const evidenciasPorFato = detalhe?.ocorrencia?.fatos?.frame_evidencia;
    const frames = normalizarFrames(detalhe?.ocorrencia?.frames, detalhe?.ocorrencia?.frame_principal);
    const campos = camposDosCriterios(protocolo.criterios);
    const framesEncontrados = [];
    const semEvidencia = [];

    if (campos.length === 0) {
      setFramesDestacados([]);
      setAvisoEvidencia('Este protocolo não tem critérios preservados nesta ocorrência para vincular a um frame de evidência.');
      return;
    }

    if (Array.isArray(evidenciasPorFato)) {
      const tiposRelacionados = new Set();
      for (const [tipo, camposTipo] of Object.entries(camposPorTipoEvidencia)) {
        if (campos.some((campo) => camposTipo.includes(campo))) {
          tiposRelacionados.add(tipo);
        }
      }

      for (const evidencia of evidenciasPorFato) {
        if (tiposRelacionados.has(evidencia.tipo) && Number.isInteger(evidencia.frame) && frames[evidencia.frame]) {
          framesEncontrados.push(frames[evidencia.frame]);
        }
      }

      setFramesDestacados(Array.from(new Set(framesEncontrados)));
      setAvisoEvidencia(framesEncontrados.length === 0
        ? `Sem evidência registrada para os critérios de ${protocolo.codigo}.`
        : '');

      window.setTimeout(() => {
        document.querySelector('.evidence-row.highlighted')?.scrollIntoView({
          block: 'center',
        });
      }, 0);
      return;
    }

    for (const campo of campos) {
      const indice = evidenciasPorFato?.[campo];
      if (Number.isInteger(indice) && frames[indice]) {
        framesEncontrados.push(frames[indice]);
      } else {
        semEvidencia.push(criterioLabels[campo] || campo);
      }
    }

    setFramesDestacados(Array.from(new Set(framesEncontrados)));
    setAvisoEvidencia(semEvidencia.length > 0
      ? `Sem evidência registrada para: ${semEvidencia.join(', ')}.`
      : '');

    window.setTimeout(() => {
      document.querySelector('.evidence-row.highlighted')?.scrollIntoView({
        block: 'center',
      });
    }, 0);
  }

  useEffect(() => {
    function onKeyDown(event) {
      const tagName = event.target?.tagName;
      if (tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA') {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        irParaFrame(-1);
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        irParaFrame(1);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [irParaFrame]);

  if (carregando) {
    return (
      <AppShell>
        <p className="loading">Carregando ocorrência...</p>
      </AppShell>
    );
  }

  if (erro || !detalhe) {
    return (
      <AppShell>
        <button type="button" className="button button-ghost" onClick={() => navegar('/ocorrencias')}>
          Voltar
        </button>
        <p className="alert alert-error">{erro || 'Ocorrência não encontrada.'}</p>
      </AppShell>
    );
  }

  const { ocorrencia } = detalhe;
  const fatos = listaFatos(ocorrencia.fatos);

  return (
    <AppShell>
      <button type="button" className="button button-ghost back-button" onClick={() => navegar('/ocorrencias')}>
        Voltar para fila
      </button>

      <section className="page-heading">
        <p className="eyebrow">Ocorrência</p>
        <h1>{ocorrencia.camera?.tunel || 'Upload'}</h1>
        <p>{formatarData(ocorrencia.detectada_em || ocorrencia.created_at)}</p>
      </section>

      <section className="evidence-layout">
        <div className="detail-main">
          {gruposEvidencia.map((grupo) => (
            <section className="evidence-group" key={grupo.tipo}>
              <h2>
                {tipoEvidenciaLabels[grupo.tipo] || 'Evidências'} ({grupo.itens.length})
                {grupo.tipo === 'veiculo' && ocorrencia.fatos ? (
                  <span>
                    {' '} - estacionados {ocorrencia.fatos.veiculos_estacionados ?? 0}, parados na pista {ocorrencia.fatos.veiculos_parados_na_pista ?? 0}, em movimento {ocorrencia.fatos.veiculos_em_movimento ?? 0}
                  </span>
                ) : null}
              </h2>
              {grupo.itens.map((evidencia, index) => (
                <EvidenceCard
                  key={evidencia.id || `${evidencia.frame}-${index}`}
                  evidencia={evidencia}
                  highlighted={framesDestacados.includes(evidencia.frame)}
                  onOpenImage={setImagemAmpliada}
                  onProtocolClick={destacarProtocolo}
                />
              ))}
            </section>
          ))}

          {avisoEvidencia ? <p className="alert alert-warning">{avisoEvidencia}</p> : null}

          <section className="card decision-section">
            <DecisionPanel
              detalhe={detalhe}
              onDecidido={carregar}
              acionamentos={acionamentos}
              setAcionamentos={setAcionamentos}
              orientacao={orientacao}
              setOrientacao={setOrientacao}
            />
          </section>

          <button
            type="button"
            className="link-button"
            onClick={() => setMostrarTodosFrames((atual) => !atual)}
          >
            {mostrarTodosFrames ? 'ocultar todos os frames' : 'ver todos os frames'}
          </button>

          {mostrarTodosFrames ? (
            <article className="card frame-card">
              {frameAtual ? (
                <img src={`/api/midia/${frameAtual}`} alt="Frame selecionado da ocorrência" />
              ) : (
                <div className="empty-frame">Sem frame disponível</div>
              )}
              <div className="frame-navigation">
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={totalFrames <= 1 || framePosicao === 0}
                  onClick={() => irParaFrame(-1)}
                >
                  Anterior
                </button>
                <strong>
                  {totalFrames > 0 ? `Frame ${framePosicao + 1} de ${totalFrames}` : 'Sem frames'}
                </strong>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={totalFrames <= 1 || framePosicao >= totalFrames - 1}
                  onClick={() => irParaFrame(1)}
                >
                  Próximo
                </button>
              </div>
              {totalFrames > 0 ? (
                <div className="frame-strip">
                  {sequenciaFrames.map((frame, index) => (
                    <button
                      type="button"
                      key={frame}
                      className={frame === frameAtual ? 'frame-thumb active' : 'frame-thumb'}
                      onClick={() => setFrameAtual(frame)}
                      aria-label={`Selecionar frame ${index + 1} de ${totalFrames}`}
                    >
                      <img src={`/api/midia/${frame}`} alt={`Miniatura do frame ${index + 1}`} />
                      <span>{index + 1}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
          ) : null}
        </div>

        <aside className="detail-side">
          <section className="card">
            <p className="eyebrow">Identificado pela análise</p>
            <h2>Fatos observados</h2>
            <dl className="facts-grid">
              {fatos.map((fato) => (
                <div key={fato.label}>
                  <dt>{fato.label}</dt>
                  <dd>{formatarValor(fato.value)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="card">
            <p className="eyebrow">Auditoria</p>
            <h2>Eventos</h2>
            <ol className="audit-list">
              {detalhe.auditoria.map((evento) => (
                <li key={evento.id}>
                  <strong>{evento.evento}</strong>
                  <span>{formatarData(evento.created_at)}</span>
                  <small>Ator: {evento.ator}</small>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </section>
      <ImageModal frame={imagemAmpliada} onClose={() => setImagemAmpliada('')} />
    </AppShell>
  );
}

function CriteriosLegiveis({ criterios }) {
  const grupos = [
    ['todos', 'Todos'],
    ['algum', 'Algum'],
    ['nenhum', 'Nenhum'],
  ];

  if (contarCriterios(criterios) === 0) {
    return <p className="muted">Sem critérios cadastrados.</p>;
  }

  return (
    <div className="criteria-readable">
      {grupos.map(([chave, label]) => {
        const condicoes = Array.isArray(criterios?.[chave]) ? criterios[chave] : [];
        if (condicoes.length === 0) {
          return null;
        }

        return (
          <div key={chave}>
            <strong>{label}</strong>
            <ul>
              {condicoes.map((condicao, index) => (
                <li key={`${chave}-${index}`}>{formatarCondicao(condicao)}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function ProtocolosPage() {
  const pdfInputRef = useRef(null);
  const [protocolos, setProtocolos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [importando, setImportando] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [resultadoImportacao, setResultadoImportacao] = useState(null);

  const carregar = useCallback(async () => {
    try {
      const data = await api('/api/protocolos');
      setProtocolos(data.protocolos || []);
      setErro('');
    } catch (error) {
      setErro(error.message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    carregar();
  }, [carregar]);

  async function importarPdf(event) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    setErro('');
    setResultadoImportacao(null);
    setImportProgress(0);
    setImportando(true);

    try {
      const data = await uploadArquivo('/api/protocolos/importar', file, setImportProgress);
      setResultadoImportacao(data);
      await carregar();
    } catch (error) {
      setErro(error.message);
    } finally {
      setImportando(false);
    }
  }

  async function alterarAtivo(protocolo) {
    try {
      await api(`/api/protocolos/${protocolo.id}/ativo`, {
        method: 'PATCH',
        body: JSON.stringify({ ativo: !protocolo.ativo }),
      });
      await carregar();
    } catch (error) {
      setErro(error.message);
    }
  }

  return (
    <AppShell>
      <section className="page-heading">
        <p className="eyebrow">Calibração</p>
        <h1>Protocolos</h1>
      </section>

      <section className="card upload-card">
        <div>
          <p className="eyebrow">Importação</p>
          <h2>Enviar PDF de protocolos</h2>
          <p>O modelo extrai protocolos, e o sistema grava apenas o que passa na validação.</p>
        </div>
        <button
          type="button"
          className="button button-primary"
          disabled={importando}
          onClick={() => pdfInputRef.current?.click()}
        >
          {importando ? 'Importando...' : 'Importar PDF'}
        </button>
        <input
          ref={pdfInputRef}
          className="file-input-hidden"
          type="file"
          accept="application/pdf,.pdf"
          onChange={importarPdf}
          disabled={importando}
        />
        {importando ? (
          <>
            <div className="progress">
              <div style={{ width: `${importProgress}%` }} />
              <span>{importProgress}%</span>
            </div>
            <p className="muted upload-note">
              {importProgress < 100
                ? 'Enviando PDF para análise.'
                : 'PDF enviado. A análise dos protocolos pode levar até um minuto.'}
            </p>
          </>
        ) : null}
      </section>

      {erro ? <p className="alert alert-error">{erro}</p> : null}
      {resultadoImportacao ? (
        <section className="card import-result">
          <h2>Resultado da importação</h2>
          <p>{resultadoImportacao.importados} protocolo(s) importado(s).</p>
          {resultadoImportacao.codigos_importados?.length > 0 ? (
            <p>Códigos: {resultadoImportacao.codigos_importados.join(', ')}</p>
          ) : null}
          {resultadoImportacao.recusados?.length > 0 ? (
            <div>
              <strong>Recusados</strong>
              <ul>
                {resultadoImportacao.recusados.map((item, index) => (
                  <li key={`${item.codigo}-${index}`}>
                    {item.codigo || 'Sem código'} - {item.motivo}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {carregando ? <p className="loading">Carregando protocolos...</p> : null}

      <section className="protocol-table">
        {protocolos.map((protocolo) => (
          <article className="card protocol-row" key={protocolo.id}>
            <div className="protocol-row-header">
              <div>
                <p className="eyebrow">{protocolo.codigo}</p>
                <h2>{protocolo.nome}</h2>
                <p>{protocolo.descricao}</p>
              </div>
              <button
                type="button"
                className={protocolo.ativo ? 'button button-secondary' : 'button button-primary'}
                onClick={() => alterarAtivo(protocolo)}
              >
                {protocolo.ativo ? 'Desativar' : 'Ativar'}
              </button>
            </div>
            <dl className="meta-grid">
              <div>
                <dt>Prioridade</dt>
                <dd>{protocolo.prioridade}</dd>
              </div>
              <div>
                <dt>Situação</dt>
                <dd>{protocolo.ativo ? 'Ativo' : 'Inativo'}</dd>
              </div>
              <div>
                <dt>Origem</dt>
                <dd>{protocolo.origem === 'pdf' ? 'PDF' : 'Manual'}</dd>
              </div>
              <div>
                <dt>Critérios</dt>
                <dd>{protocolo.quantidade_criterios ?? contarCriterios(protocolo.criterios)}</dd>
              </div>
            </dl>
            {protocolo.origem_arquivo ? (
              <p className="muted">
                Arquivo de origem: {protocolo.origem_arquivo}
                {protocolo.importado_em ? ` em ${formatarData(protocolo.importado_em)}` : ''}
              </p>
            ) : null}
            <CriteriosLegiveis criterios={protocolo.criterios} />
          </article>
        ))}
        {!carregando && protocolos.length === 0 ? (
          <div className="empty-state card">Nenhum protocolo encontrado.</div>
        ) : null}
      </section>
    </AppShell>
  );
}

function MetricCard({ title, children }) {
  return (
    <article className="card metric-card">
      <h2>{title}</h2>
      {children}
    </article>
  );
}

function PainelPage() {
  const { usuario } = useSession();
  const inicial = useMemo(() => periodoPadrao(), []);
  const [de, setDe] = useState(inicial.de);
  const [ate, setAte] = useState(inicial.ate);
  const [metricas, setMetricas] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const autorizado = usuario?.papel === 'gestor' || usuario?.papel === 'admin';

  const carregar = useCallback(async () => {
    if (!autorizado) {
      setCarregando(false);
      return;
    }

    const params = new URLSearchParams();
    if (de) {
      params.set('de', de);
    }
    if (ate) {
      params.set('ate', ate);
    }

    try {
      const data = await api(`/api/metricas?${params.toString()}`);
      setMetricas(data);
      setErro('');
    } catch (error) {
      setErro(error.message);
    } finally {
      setCarregando(false);
    }
  }, [autorizado, de, ate]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    carregar();
  }, [carregar]);

  if (!autorizado) {
    return (
      <AppShell>
        <section className="card">
          <h1>Acesso restrito</h1>
          <p>O painel de métricas é visível apenas para gestor e admin.</p>
        </section>
      </AppShell>
    );
  }

  const ocorrencias = metricas?.ocorrencias_detectadas;
  const taxaDescarte = metricas?.taxa_descarte;
  const acertoMotor = metricas?.acerto_motor_protocolos;

  return (
    <AppShell>
      <section className="page-heading">
        <p className="eyebrow">Avaliação do piloto</p>
        <h1>Painel</h1>
        <p>Indicadores acordados para avaliação do piloto pelo Centro de Operações e Resiliência.</p>
      </section>

      <section className="filters card">
        <label>
          De
          <input type="date" value={de} onChange={(event) => setDe(event.target.value)} />
        </label>
        <label>
          Até
          <input type="date" value={ate} onChange={(event) => setAte(event.target.value)} />
        </label>
        <button type="button" className="button button-secondary" onClick={carregar}>
          Atualizar
        </button>
      </section>

      {erro ? <p className="alert alert-error">{erro}</p> : null}
      {carregando ? <p className="loading">Carregando métricas...</p> : null}

      {metricas ? (
        <section className="metrics-grid">
          <MetricCard title="Tempo entre detecção e decisão">
            <div className="metric-numbers two">
              <div>
                <strong>{formatarSegundos(metricas.tempo_decisao.media_segundos)}</strong>
                <span>Média</span>
              </div>
              <div>
                <strong>{formatarSegundos(metricas.tempo_decisao.mediana_segundos)}</strong>
                <span>Mediana</span>
              </div>
            </div>
            <p className="muted">{metricas.tempo_decisao.total_decididas} ocorrência(s) decidida(s).</p>
          </MetricCard>

          <MetricCard title="Ocorrências detectadas pelo sistema">
            <strong className="metric-big">{ocorrencias.total}</strong>
            <dl className="metric-list">
              <div>
                <dt>Aguardando decisão</dt>
                <dd>{ocorrencias.por_status.aguardando_decisao}</dd>
              </div>
              <div>
                <dt>Aprovadas</dt>
                <dd>{ocorrencias.por_status.aprovadas}</dd>
              </div>
              <div>
                <dt>Descartadas</dt>
                <dd>{ocorrencias.por_status.descartadas}</dd>
              </div>
            </dl>
          </MetricCard>

          <MetricCard title="Taxa de descarte pelo operador">
            <strong className="metric-big">{formatarPercentual(taxaDescarte.valor)}</strong>
            <p className="muted">
              {taxaDescarte.descartadas} descarte(s) em {taxaDescarte.total_decididas} decisão(ões).
            </p>
          </MetricCard>

          <MetricCard title="Acerto do motor de protocolos">
            <strong className="metric-big">{formatarPercentual(acertoMotor.valor)}</strong>
            <p className="muted">
              {acertoMotor.aprovadas_sem_ajuste} aprovada(s) sem ajuste em {acertoMotor.total_avaliadas} avaliação(ões).
            </p>
          </MetricCard>

          <MetricCard title="Protocolos mais acionados">
            <ol className="rank-list">
              {metricas.protocolos_mais_acionados.map((item) => (
                <li key={item.codigo}>
                  <span>{item.codigo} - {item.nome}</span>
                  <strong>{item.quantidade}</strong>
                </li>
              ))}
            </ol>
            {metricas.protocolos_mais_acionados.length === 0 ? <p className="muted">Sem dados no período.</p> : null}
          </MetricCard>

          <MetricCard title="Protocolos mais ajustados">
            <div className="adjustment-list">
              {metricas.protocolos_mais_ajustados.map((item, index) => (
                <div key={`${item.sugerido_codigo}-${item.escolhido_codigo}-${index}`}>
                  <strong>{item.quantidade} ajuste(s)</strong>
                  <span>Sugerido: {item.sugerido_codigo} - {item.sugerido_nome}</span>
                  <span>Escolhido: {item.escolhido_codigo || 'Sem protocolo'} - {item.escolhido_nome || 'Não informado'}</span>
                  <span>Escolhido fora dos casados: {item.escolhido_fora_dos_casados}</span>
                </div>
              ))}
            </div>
            {metricas.protocolos_mais_ajustados.length === 0 ? <p className="muted">Sem ajustes no período.</p> : null}
          </MetricCard>
        </section>
      ) : null}
    </AppShell>
  );
}

function Router() {
  const { usuario, carregando } = useSession();
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!carregando && !usuario && path !== '/login') {
      navegar('/login');
    }

    if (!carregando && usuario && (path === '/' || path === '/login')) {
      navegar('/ocorrencias');
    }
  }, [carregando, usuario, path]);

  if (carregando) {
    return <div className="loading full-page">Verificando sessão...</div>;
  }

  if (!usuario) {
    return <LoginPage />;
  }

  if (path === '/protocolos') {
    return <ProtocolosPage />;
  }

  if (path === '/painel') {
    return <PainelPage />;
  }

  const detalheMatch = path.match(/^\/ocorrencias\/([^/]+)$/);
  if (detalheMatch) {
    return <OcorrenciaDetalhePage id={detalheMatch[1]} />;
  }

  return <OcorrenciasPage />;
}

function App() {
  return (
    <SessionProvider>
      <Router />
    </SessionProvider>
  );
}

export default App;
