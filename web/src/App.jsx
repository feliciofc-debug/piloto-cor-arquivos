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
  caminhao: 'Caminhoes',
  onibus: 'Onibus',
  pessoa_na_pista: 'Pessoa na pista',
  pessoa_ao_solo: 'Pessoa ao solo',
  fogo: 'Fogo',
  fumaca: 'Fumaca',
  carga_derramada: 'Carga derramada',
  agua_na_pista: 'Agua na pista',
  veiculo_parado: 'Veiculo parado',
  bloqueio_via: 'Bloqueio da via',
  confianca: 'Confianca',
  observacao: 'Observacao',
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

    const error = new Error(payload.error || 'Falha na comunicacao com a API.');
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function formatarData(value) {
  if (!value) {
    return 'Sem horario';
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
    return value ? 'Sim' : 'Nao';
  }

  if (value === null || value === undefined || value === '') {
    return 'Nao informado';
  }

  return String(value);
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

function BrandHeader({ compact = false }) {
  return (
    <div className={compact ? 'brand brand-compact' : 'brand'}>
      <img src="/brasao.svg" alt="Brasao temporario do piloto" />
      <span className="brand-divider" />
      <div>
        <strong>Centro de Operacoes</strong>
        <strong>e Resiliencia</strong>
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
        <footer>Piloto COR - monitoramento assistido de tuneis</footer>
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
            <img src={`/midia/${ocorrencia.frame_principal}`} alt="Frame principal da ocorrencia" />
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
              <dt>Horario</dt>
              <dd>{formatarData(ocorrencia.horario)}</dd>
            </div>
            <div>
              <dt>Confianca</dt>
              <dd>{formatarValor(ocorrencia.confianca)}</dd>
            </div>
          </dl>
          <div className="protocol-list compact-list">
            {protocolos.length > 0 ? protocolos.map((protocolo) => (
              <span key={`${ocorrencia.id}-${protocolo.protocolo_id || protocolo.codigo}`}>
                {protocolo.codigo} - {protocolo.nome}
              </span>
            )) : (
              <span>Nenhum protocolo aplicavel segundo a regra</span>
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

  return (
    <AppShell>
      <section className="page-heading">
        <p className="eyebrow">Fila do operador</p>
        <h1>Ocorrencias</h1>
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
          Tunel
          <input
            type="text"
            value={tunel}
            onChange={(event) => setTunel(event.target.value)}
            placeholder="Nome exato do tunel"
          />
        </label>
        <button type="button" className="button button-secondary" onClick={carregar}>
          Atualizar
        </button>
      </section>

      {erro ? <p className="alert alert-error">{erro}</p> : null}
      {carregando ? <p className="loading">Carregando ocorrencias...</p> : null}

      <section className="occurrence-grid">
        {!carregando && ocorrencias.length === 0 ? (
          <div className="empty-state card">Nenhuma ocorrencia encontrada.</div>
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
    return <p className="muted">Nenhum protocolo aplicavel segundo a regra.</p>;
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
            <p>Protocolo aplicavel segundo a regra.</p>
            {protocolo.acionamentos_suprimidos ? (
              <p className="alert alert-warning">
                Leitura com confianca baixa. Nenhum acionamento e sugerido.
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
      setMensagem('Decisao registrada.');
      await onDecidido();
    } catch (error) {
      setErro(error.message);
    } finally {
      setEnviando('');
    }
  }

  return (
    <section className="card decision-card">
      <p className="eyebrow">Decisao humana</p>
      <h2>Acoes do operador</h2>
      {!aguardando ? (
        <p className="muted">Esta ocorrencia nao esta aguardando decisao.</p>
      ) : null}
      {erro ? <p className="alert alert-error">{erro}</p> : null}
      {mensagem ? <p className="alert alert-success">{mensagem}</p> : null}
      <div className="decision-grid">
        <div>
          <h3>Aprovar</h3>
          <p>Confirma o protocolo aplicavel segundo a regra.</p>
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
          <p>Escolha um protocolo ativo quando a regra precisar de correcao.</p>
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
          <p>Informe o motivo para descartar a ocorrencia.</p>
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
      const frames = Array.isArray(data.ocorrencia.frames) ? data.ocorrencia.frames : [];
      setFrameAtual(data.ocorrencia.frame_principal || frames[0] || '');
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

  if (carregando) {
    return (
      <AppShell>
        <p className="loading">Carregando ocorrencia...</p>
      </AppShell>
    );
  }

  if (erro || !detalhe) {
    return (
      <AppShell>
        <button type="button" className="button button-ghost" onClick={() => navegar('/ocorrencias')}>
          Voltar
        </button>
        <p className="alert alert-error">{erro || 'Ocorrencia nao encontrada.'}</p>
      </AppShell>
    );
  }

  const { ocorrencia } = detalhe;
  const frames = Array.isArray(ocorrencia.frames) ? ocorrencia.frames : [];
  const fatos = listaFatos(ocorrencia.fatos);

  return (
    <AppShell>
      <button type="button" className="button button-ghost back-button" onClick={() => navegar('/ocorrencias')}>
        Voltar para fila
      </button>

      <section className="page-heading">
        <p className="eyebrow">Ocorrencia</p>
        <h1>{ocorrencia.camera?.tunel || 'Upload'}</h1>
        <p>{formatarData(ocorrencia.detectada_em || ocorrencia.created_at)}</p>
      </section>

      <section className="detail-layout">
        <div className="detail-main">
          <article className="card frame-card">
            {frameAtual ? (
              <img src={`/midia/${frameAtual}`} alt="Frame selecionado da ocorrencia" />
            ) : (
              <div className="empty-frame">Sem frame disponivel</div>
            )}
            {frames.length > 1 ? (
              <div className="frame-strip">
                {frames.map((frame) => (
                  <button
                    type="button"
                    key={frame}
                    className={frame === frameAtual ? 'frame-thumb active' : 'frame-thumb'}
                    onClick={() => setFrameAtual(frame)}
                  >
                    <img src={`/midia/${frame}`} alt="Miniatura de frame da ocorrencia" />
                  </button>
                ))}
              </div>
            ) : null}
          </article>

          <article className="card">
            <p className="eyebrow">Identificado pela analise</p>
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
            <h2>Protocolos aplicaveis</h2>
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
    return <div className="loading full-page">Verificando sessao...</div>;
  }

  if (!usuario) {
    return <LoginPage />;
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
