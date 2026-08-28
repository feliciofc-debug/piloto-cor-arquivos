# Piloto COR — Documento de arquitetura (v2, servidor próprio)

**Cliente:** Centro de Operações Rio
**Fornecedor:** Atom Brasil Digital LTDA — CNPJ 22.003.550/0001-05
**Escopo:** monitoramento assistido de túneis
**Domínio:** pilotocor.com.br

> **Mudança em relação à v1:** exigência do cliente de que tudo rode em
> servidor próprio. Não há Supabase, não há nuvem de terceiro para dados nem
> aplicação. Todo o sistema é entregável como um `docker compose up`.

---

## 1. Escopo do piloto

- Ingestão de imagem de câmera de túnel (stream ou upload)
- Extração de quadros no worker
- Análise de cena por modelo de visão, com saída estruturada
- Cruzamento dos fatos observados com protocolos cadastrados
- Tela de aprovação do operador
- Notificação ao responsável por WhatsApp

**Fora do escopo:** canal do cidadão, camada de dados (Waze, meteorologia,
maré, nível de rio), índice de risco regional, reconhecimento facial,
contagem de fluxo de veículos, expansão para outras câmeras.

---

## 2. Princípios de projeto — não negociáveis

**1. A IA descreve. Ela não decide.**
O modelo de visão devolve fatos observados em campos estruturados. Nunca
escolhe protocolo, nunca sugere acionamento, nunca classifica gravidade.

**2. A regra decide.**
O cruzamento entre fatos e protocolo é consulta SQL determinística e
auditável. A resposta para "por que sugeriu isso" é a linha do protocolo que
casou — não a opinião de um modelo.

**3. O humano aprova.**
Nada é despachado, publicado ou comunicado sem confirmação do operador.

**Derivadas:**
- Confiança baixa nunca sugere acionamento; apenas abre o registro.
- O sistema nunca classifica óbito. Reporta "pessoa ao solo" e para aí.
- Toda decisão gera registro de auditoria por gatilho no banco, não por
  disciplina de quem escreve o código.

---

## 3. Infraestrutura — o que já existe

Servidor Contabo, x86_64, 6 vCPU, 11 GB RAM, 125 GB livres.
Docker 29.1.3, Compose v5.0.0.

**Já em produção na máquina, não tocar:** `render-worker` (worker de vídeo da
AMZ), `cia-postgres` (5432), `ratel-*` (5433, 6379, 8090).

**Já criado para o piloto:**
```
/opt/piloto-cor/
  .env                  # segredos, permissão 600
  docker-compose.yml
  api/
  worker/
  db/init/
  storage/frames/
```
`cor-postgres` em `127.0.0.1:5434`, PostgreSQL 16.13, saudável.
API reservada em `127.0.0.1:8091`.

Nenhum serviço do piloto é exposto diretamente à internet. Acesso externo
apenas via Nginx, com TLS, no domínio `pilotocor.com.br`.

---

## 4. Componentes

```
Câmera / upload
      │
      ▼
[ API Node/Fastify :8091 ] ── fila ──►  [ Worker Python + FFmpeg ]
      │                                          │
      │  ◄──────── quadros no disco ─────────────┘
      ▼
[ Análise de visão ]  → JSON estruturado
      │
      ▼
[ Motor de protocolos — SQL ]  → protocolos casados + acionamentos
      │
      ▼
[ Frontend React ]  → operador aprova
      │
      ▼
[ Notificação WhatsApp ]
```

**Serviços do compose:** `db`, `api`, `worker`, `web`, `nginx`.

---

## 5. Autenticação e autorização

Não existe `auth.uid()` nem RLS do Supabase. **A autorização é
responsabilidade da API.**

- Login por e-mail e senha. Hash com **argon2id**.
- Sessão por **JWT assinado com `JWT_SECRET`**, validade de 12 horas,
  enviado em cookie `httpOnly`, `secure`, `sameSite=strict`.
- Todo endpoint declara o papel exigido. Sem papel declarado, o padrão é
  negar.
- Papéis: `operador`, `gestor`, `admin`.
- Não há cadastro público. Os usuários do piloto são criados por comando
  administrativo (`npm run criar-usuario`), com senha inicial forte.
- Rate limit no login: 5 tentativas por minuto por IP.

**A RLS do Postgres não é usada nesta versão.** A separação por papel
acontece na API, que é a única a falar com o banco. O banco não é exposto a
nenhum cliente externo.

---

## 6. Modelo de dados

Uma migração por arquivo, em `db/init/`, aplicadas em ordem no primeiro
start do container e versionadas no repositório.

### `usuarios`
```sql
id            uuid primary key default gen_random_uuid(),
email         text not null unique,
senha_hash    text not null,
nome          text,
papel         text not null check (papel in ('operador','gestor','admin')),
ativo         boolean not null default true,
ultimo_login  timestamptz,
created_at    timestamptz not null default now()
```

### `cameras`
```sql
id            uuid primary key default gen_random_uuid(),
nome          text not null,
tunel         text not null,
sentido       text,
endereco      text,
latitude      numeric,
longitude     numeric,
stream_url    text,
ativa         boolean not null default true,
intervalo_seg integer not null default 10 check (intervalo_seg > 0),
created_at    timestamptz not null default now()
```
**A localização do alerta vem daqui. Nunca da análise de imagem.**

### `protocolos`
```sql
id            uuid primary key default gen_random_uuid(),
codigo        text not null unique,
nome          text not null,
descricao     text,
criterios     jsonb not null check (jsonb_typeof(criterios) = 'object'),
acionamentos  jsonb not null check (jsonb_typeof(acionamentos) = 'array'),
prioridade    integer not null check (prioridade > 0),
ativo         boolean not null default true,
created_at    timestamptz not null default now()
```

### `ocorrencias`
```sql
id                     uuid primary key default gen_random_uuid(),
camera_id              uuid references cameras(id) on delete restrict,
origem                 text not null check (origem in ('camera','upload','whatsapp')),
status                 text not null check (status in
                         ('analisando','aguardando_operador','aprovada',
                          'descartada','expirada')),
fatos                  jsonb,
confianca              text check (confianca is null or
                         confianca in ('alta','media','baixa')),
protocolos_casados     jsonb not null default '[]'::jsonb,
protocolo_escolhido_id uuid references protocolos(id) on delete restrict,
frame_principal        text,
frames                 jsonb not null default '[]'::jsonb,
operador_id            uuid references usuarios(id),
decisao                text check (decisao is null or
                         decisao in ('aprovada','descartada','ajustada')),
decisao_obs            text,
detectada_em           timestamptz,
decidida_em            timestamptz,
created_at             timestamptz not null default now(),

constraint descarte_exige_obs check (
  decisao is distinct from 'descartada'
  or nullif(trim(coalesce(decisao_obs,'')), '') is not null),
constraint ajuste_exige_protocolo check (
  decisao is distinct from 'ajustada'
  or protocolo_escolhido_id is not null)
```

`protocolos_casados` guarda o que a regra encontrou e **nunca é sobrescrito**.
`protocolo_escolhido_id` guarda a escolha humana ao lado. É essa separação que
permite medir, ao fim do piloto, em que percentual o motor acertou.

### `frame_jobs`
```sql
id            uuid primary key default gen_random_uuid(),
ocorrencia_id uuid not null references ocorrencias(id) on delete restrict,
tipo          text not null check (tipo in ('extrair_frames')),
origem        text not null,        -- caminho no disco ou URL do stream
destino_dir   text not null,        -- pasta em storage/frames/<ocorrencia_id>
parametros    jsonb not null,       -- {fps, max_frames, largura}
status        text not null check (status in
                ('pendente','processando','concluido','erro')),
claimed_by    text,
claimed_at    timestamptz,
concluido_em  timestamptz,
erro_mensagem text,
tentativas    integer not null default 0 check (tentativas >= 0),
created_at    timestamptz not null default now()
```

### `auditoria` — append-only
```sql
id            uuid primary key default gen_random_uuid(),
ocorrencia_id uuid references ocorrencias(id) on delete restrict,
evento        text not null,
detalhe       jsonb not null default '{}'::jsonb,
ator          text not null,
created_at    timestamptz not null default now()
```

Proteção por gatilho, não por convenção:
```sql
create function prevent_auditoria_mutation() returns trigger
language plpgsql as $$
begin raise exception 'auditoria is append-only'; end; $$;

create trigger auditoria_no_update before update on auditoria
for each row execute function prevent_auditoria_mutation();
create trigger auditoria_no_delete before delete on auditoria
for each row execute function prevent_auditoria_mutation();
```

E o gatilho que registra a decisão automaticamente:
```sql
create function audit_decisao() returns trigger
language plpgsql as $$
begin
  if new.decisao is not null and old.decisao is null then
    insert into auditoria (ocorrencia_id, evento, ator, detalhe)
    values (new.id, 'decidida', coalesce(new.operador_id::text,'desconhecido'),
      jsonb_build_object(
        'decisao', new.decisao,
        'status', new.status,
        'protocolos_casados', new.protocolos_casados,
        'protocolo_escolhido_id', new.protocolo_escolhido_id,
        'decisao_obs', new.decisao_obs));
  end if;
  return new;
end; $$;

create trigger ocorrencias_audit_decisao after update on ocorrencias
for each row execute function audit_decisao();
```

**A auditoria acontece por construção.** Não depende de a API lembrar de
gravar.

---

## 7. Contrato worker ↔ API

Seguir o padrão de `/opt/render-worker`, que já funciona em produção.
O worker **só faz chamadas de saída**. Autenticação por header
`x-worker-token`, validado contra `WORKER_TOKEN` com **comparação em tempo
constante**.

### `POST /worker/frame-claim`
Resposta: `{ job: { id, origem, destino_dir, parametros } }` ou `{ job: null }`.
Marca `processando`, grava `claimed_by` e `claimed_at`.

### `POST /worker/frame-complete`
```json
{ "job_id": "...", "success": true, "frames": ["frame_001.jpg"], "duracao_ms": 1840 }
```
Em erro: `{ "job_id": "...", "success": false, "erro": "..." }`

### Manutenção
Rotina a cada minuto na API: job em `processando` há mais de 5 minutos volta
para `pendente`. Após 3 tentativas, vai para `erro` e abre registro.

### Comando do worker
```
ffmpeg -i <origem> -vf "fps=1,scale=768:-1" -q:v 3 <destino>/frame_%03d.jpg
```
Vídeo acima de 20 s: `fps=0.5`. Teto de 30 quadros por análise.
Limpeza de órfãos a cada hora, como já faz o `render-worker`.

---

## 8. Análise de visão — saída estruturada obrigatória

Modelo com suporte a múltiplas imagens na mesma chamada. Quadros enviados
**inline em base64**. Schema estrito, não prompt pedindo JSON.

```json
{
  "veiculos": { "carro": 0, "moto": 0, "caminhao": 0, "onibus": 0 },
  "pessoa_na_pista": false,
  "pessoa_ao_solo": false,
  "fogo": false,
  "fumaca": false,
  "carga_derramada": false,
  "agua_na_pista": false,
  "veiculo_parado": false,
  "bloqueio_via": "nenhum",
  "confianca": "alta",
  "observacao": "texto curto do que se vê"
}
```

Todos obrigatórios, enums fechados.

**Proibido no prompt:** pedir gravidade, sugerir acionamento, identificar
pessoas, estimar óbito, ler placa.

**Chave da API de visão fica apenas no `.env` do servidor**, nunca no
frontend nem no repositório.

> Pendente de confirmação com o cliente: se a exigência de servidor próprio
> alcança também o modelo de visão. Modelo local exige GPU, que a máquina
> atual não tem.

---

## 9. Motor de protocolos

`criterios`:
```json
{
  "todos":  [ { "campo": "pessoa_ao_solo", "igual": true } ],
  "algum":  [ { "campo": "veiculos.moto", "maior_que": 0 } ],
  "nenhum": []
}
```

`acionamentos`:
```json
[ { "orgao": "SAMU", "prioridade": 1 },
  { "orgao": "Bombeiros", "prioridade": 1 } ]
```

O casamento é **consulta SQL sobre os fatos**, executada pela API. Não é o
modelo que escolhe. Vários protocolos podem casar — todos são apresentados,
ordenados por prioridade.

Com `confianca = "baixa"`: registro criado, protocolos exibidos como
referência, **nenhum acionamento sugerido**, marcação visual no cartão.

---

## 10. Telas

React + Vite, servido pelo Nginx.

- **`/ocorrencias`** — fila do operador. Miniatura, túnel, horário,
  protocolos casados, nível de confiança. Filtro por status e túnel.
- **`/ocorrencias/:id`** — quadro principal, navegação entre quadros, fatos
  em lista, protocolos casados com acionamentos, e três ações: **Aprovar**,
  **Ajustar** (escolhe outro protocolo), **Descartar** (motivo obrigatório).
- **`/protocolos`** — CRUD com editor de critérios. **O COR precisa editar
  protocolo sem depender do fornecedor.** Não é opcional.
- **`/cameras`** — cadastro das câmeras do piloto.
- **`/painel`** — as três métricas do piloto em tempo real.

Identidade visual da Prefeitura do Rio, mediante autorização escrita.

---

## 11. Métricas do piloto

Saem direto do banco, sem instrumentação extra:

1. **Tempo entre detecção e decisão** — `decidida_em - detectada_em`
2. **Ocorrências detectadas pelo sistema** — contagem por período e por túnel
3. **Taxa de descarte pelo operador** — indicador de precisão
4. **Acerto do motor de protocolos** — proporção de decisões `aprovada`
   contra `ajustada`, disponível porque `protocolos_casados` é preservado

---

## 12. WhatsApp

Reaproveitar como referência `whatsapp-cloud-webhook` e
`whatsapp-send-message` da AMZ, reescritos em Node.
Número próprio do piloto, WABA da Atom.

**No piloto:** notificar o responsável quando ocorrência de prioridade 1 é
aprovada pelo operador.

**Cuidado registrado:** número do agente e número do responsável são campos
distintos e nunca podem ser invertidos. Causa conhecida de bug recorrente.

---

## 13. Operação e continuidade

- **Backup diário** do Postgres via `pg_dump` em cron, com retenção de 7 dias
  fora do volume do container. O `render-worker` hoje não tem backup — este
  projeto tem desde o primeiro dia.
- **Logs** em JSON, com rotação.
- **Healthcheck** em `/health` na API, verificando banco e fila.
- **Limites de recurso** em todos os serviços do compose, para não competir
  com o `render-worker` da AMZ.
- Nenhuma porta do piloto exposta além do Nginx.

---

## 14. Ordem de construção

**Estado em 28/08/2026: passos 1 a 5 concluídos e validados em produção.**

Já rodando na VPS: banco com as seis tabelas e os dois gatilhos de auditoria;
API Fastify com autenticação argon2id, JWT em cookie httpOnly e negar-por-padrão;
fila de frames com claim atômico e recuperação de job travado; worker Python
com FFmpeg; análise de visão pelo gemini-2.5-pro via proxy; e motor de
protocolos em função SQL determinística.

Validado ponta a ponta com vídeo real: 30 frames extraídos, 5 carros
identificados, veiculo_parado e pessoa_na_pista com confiança alta, TUN-04 e
TUN-03 casados por prioridade, e os quatro eventos de auditoria gravados.
Ciclo completo em 32 segundos. Verificação SQL: 29 de 29.


1. Migrações em `db/init/`, com os dois gatilhos de auditoria
2. API Node com autenticação, criação de usuário e `/health`
3. Fila e o par claim/complete, com o worker extraindo quadros
4. Análise de visão com schema estrito
5. Motor de protocolos e o casamento
6. Telas de ocorrência e decisão
7. CRUD de protocolos e câmeras
8. Ingestão contínua da câmera
9. Painel de métricas
10. Notificação por WhatsApp
11. Nginx com TLS, backup e healthcheck

Os passos 1 a 6 já entregam demonstração completa: imagem entra, protocolo
sai, operador aprova.

---

## 15. O que reaproveitar da AMZ

Como **referência de padrão**, reescrito em Node — não copiar Deno para cá:

| Origem | Para quê |
|---|---|
| `_shared/render-auth.ts` | Autenticação do worker em tempo constante |
| `video-render-claim/complete/maintenance` | Padrão da fila e recuperação |
| `/opt/render-worker/worker.py` | **O molde do worker. Segue quase igual.** |
| `whatsapp-cloud-webhook` | Verificação de assinatura da Meta |
| `whatsapp-send-message` | Envio pela Graph API |

**Não trazer:** `whatsapp-cloud-inbound-processor`, `video-legenda-flow`,
`copy-style`, `agent-soul`, `amz-context`, frontend, billing e todo o fluxo
de marketing.

---

## 16. Testes antes da câmera real

**Vídeo gravado em loop, para desenvolver.** Reproduzível — permite ajustar e
comparar resultado no mesmo trecho.

**Stream público, para validar a captura.** Verificar os termos de uso antes.
Aceitável para teste pontual, não para operação contínua.

**Cenas a testar primeiro:** veículo parado em faixa, pessoa na pista, fumaça.
São as três de maior consequência em túnel.
