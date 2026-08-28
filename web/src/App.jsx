import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

function uploadArquivo(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('arquivo', file);

    const request = new XMLHttpRequest();
    request.open('POST', path);
    request.withCredentials = true;

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.round((event.loaded / event.total) * 100));
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
    .filter(([key]) => key !== 'veiculos')
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
      const data = await api('/auth/eu');
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
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, senha }),
    });
    setUsuario(data.usuario);
    return data.usuario;
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
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
            <img src={`/midia/${ocorrencia.frame_principal}`} alt="Frame principal da ocorrência" />
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
      const data = await api(`/ocorrencias${params.toString() ? `?${params}` : ''}`);
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
      const data = await uploadArquivo('/ocorrencias/upload', file, setUploadProgresso);
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
        <label className="button button-primary file-button">
          {enviandoVideo ? 'Enviando...' : 'Enviar vídeo'}
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/x-matroska,video/x-msvideo,.mp4,.mov,.mkv,.avi"
            onChange={enviarVideo}
            disabled={enviandoVideo}
          />
        </label>
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

function ProtocolosCasados({ protocolos }) {
  const lista = Array.isArray(protocolos) ? protocolos : [];

  if (lista.length === 0) {
    return <p className="muted">Nenhum protocolo aplicável segundo a regra.</p>;
  }

  return (
    <div className="protocol-stack">
      {lista.map((protocolo) => {
        const acionamentos = protocolo.acionamentos_sugeridos || protocolo.acionamentos || [];
        return (
          <article className="protocol-card" key={protocolo.protocolo_id || protocolo.codigo}>
            <div className="card-title-row">
              <h3>{protocolo.codigo} - {protocolo.nome}</h3>
              <span>Prioridade {protocolo.prioridade}</span>
            </div>
            <p>Protocolo aplicável segundo a regra.</p>
            {protocolo.acionamentos_suprimidos ? (
              <p className="alert alert-warning">
                Leitura com confiança baixa. Nenhum acionamento é sugerido.
              </p>
            ) : (
              <ul className="action-list">
                {acionamentos.map((acionamento, index) => (
                  <li key={`${protocolo.codigo}-${index}`}>
                    {acionamento.orgao} - prioridade {acionamento.prioridade}
                  </li>
                ))}
              </ul>
            )}
          </article>
        );
      })}
    </div>
  );
}

function DecisionPanel({ detalhe, onDecidido }) {
  const [motivo, setMotivo] = useState('');
  const [protocoloId, setProtocoloId] = useState('');
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [enviando, setEnviando] = useState('');
  const aguardando = detalhe.ocorrencia.status === 'aguardando_operador';

  async function decidir(decisao, body = {}) {
    setErro('');
    setMensagem('');
    setEnviando(decisao);

    try {
      await api(`/ocorrencias/${detalhe.ocorrencia.id}/decidir`, {
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

  return (
    <section className="card decision-card">
      <p className="eyebrow">Decisão humana</p>
      <h2>Ações do operador</h2>
      {!aguardando ? (
        <p className="muted">Esta ocorrência não está aguardando decisão.</p>
      ) : null}
      {erro ? <p className="alert alert-error">{erro}</p> : null}
      {mensagem ? <p className="alert alert-success">{mensagem}</p> : null}
      <div className="decision-grid">
        <div>
          <h3>Aprovar</h3>
          <p>Confirma o protocolo aplicável segundo a regra.</p>
          <button
            type="button"
            className="button button-primary"
            disabled={!aguardando || enviando === 'aprovada'}
            onClick={() => decidir('aprovada')}
          >
            Aprovar
          </button>
        </div>
        <div>
          <h3>Ajustar</h3>
          <p>Escolha um protocolo ativo quando a regra precisar de correção.</p>
          <select
            value={protocoloId}
            onChange={(event) => setProtocoloId(event.target.value)}
            disabled={!aguardando}
          >
            <option value="">Selecione um protocolo</option>
            {detalhe.protocolos_ativos.map((protocolo) => (
              <option key={protocolo.id} value={protocolo.id}>
                {protocolo.codigo} - {protocolo.nome}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button button-secondary"
            disabled={!aguardando || !protocoloId || enviando === 'ajustada'}
            onClick={() => decidir('ajustada', { protocolo_escolhido_id: protocoloId })}
          >
            Ajustar
          </button>
        </div>
        <div>
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

function OcorrenciaDetalhePage({ id }) {
  const [detalhe, setDetalhe] = useState(null);
  const [frameAtual, setFrameAtual] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    try {
      const data = await api(`/ocorrencias/${id}`);
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

  const sequenciaFrames = useMemo(() => (
    normalizarFrames(detalhe?.ocorrencia?.frames, detalhe?.ocorrencia?.frame_principal)
  ), [detalhe]);

  const frameIndex = sequenciaFrames.indexOf(frameAtual);
  const framePosicao = frameIndex >= 0 ? frameIndex : 0;
  const totalFrames = sequenciaFrames.length;

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

      <section className="detail-layout">
        <div className="detail-main">
          <article className="card frame-card">
            {frameAtual ? (
              <img src={`/midia/${frameAtual}`} alt="Frame selecionado da ocorrência" />
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
                    <img src={`/midia/${frame}`} alt={`Miniatura do frame ${index + 1}`} />
                    <span>{index + 1}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </article>

          <article className="card">
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
          </article>

          <article className="card">
            <p className="eyebrow">Regra operacional</p>
            <h2>Protocolos aplicáveis</h2>
            <ProtocolosCasados protocolos={ocorrencia.protocolos_casados} />
          </article>
        </div>

        <aside className="detail-side">
          <DecisionPanel detalhe={detalhe} onDecidido={carregar} />
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
  const [protocolos, setProtocolos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [importando, setImportando] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [resultadoImportacao, setResultadoImportacao] = useState(null);

  const carregar = useCallback(async () => {
    try {
      const data = await api('/protocolos');
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
      const data = await uploadArquivo('/protocolos/importar', file, setImportProgress);
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
      await api(`/protocolos/${protocolo.id}/ativo`, {
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
        <label className="button button-primary file-button">
          {importando ? 'Importando...' : 'Importar PDF'}
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={importarPdf}
            disabled={importando}
          />
        </label>
        {importando ? (
          <div className="progress">
            <div style={{ width: `${importProgress}%` }} />
            <span>{importProgress}%</span>
          </div>
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
