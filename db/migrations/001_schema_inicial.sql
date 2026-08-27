create extension if not exists pgcrypto;

create table if not exists schema_migrations (
  versao text primary key,
  aplicada_em timestamptz not null default now()
);

create table usuarios (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  senha_hash text not null,
  nome text,
  papel text not null check (papel in ('operador', 'gestor', 'admin')),
  ativo boolean not null default true,
  ultimo_login timestamptz,
  created_at timestamptz not null default now()
);

create table cameras (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tunel text not null,
  sentido text,
  endereco text,
  latitude numeric,
  longitude numeric,
  stream_url text,
  ativa boolean not null default true,
  intervalo_seg integer not null default 10 check (intervalo_seg > 0),
  created_at timestamptz not null default now()
);

create table protocolos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nome text not null,
  descricao text,
  criterios jsonb not null check (jsonb_typeof(criterios) = 'object'),
  acionamentos jsonb not null check (jsonb_typeof(acionamentos) = 'array'),
  prioridade integer not null check (prioridade > 0),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table ocorrencias (
  id uuid primary key default gen_random_uuid(),
  camera_id uuid references cameras(id) on delete restrict,
  origem text not null check (origem in ('camera', 'upload', 'whatsapp')),
  status text not null check (
    status in (
      'analisando',
      'aguardando_operador',
      'aprovada',
      'descartada',
      'expirada'
    )
  ),
  fatos jsonb,
  confianca text check (
    confianca is null
    or confianca in ('alta', 'media', 'baixa')
  ),
  protocolos_casados jsonb not null default '[]'::jsonb,
  protocolo_escolhido_id uuid references protocolos(id) on delete restrict,
  frame_principal text,
  frames jsonb not null default '[]'::jsonb,
  operador_id uuid references usuarios(id) on delete restrict,
  decisao text check (
    decisao is null
    or decisao in ('aprovada', 'descartada', 'ajustada')
  ),
  decisao_obs text,
  detectada_em timestamptz,
  decidida_em timestamptz,
  created_at timestamptz not null default now(),

  constraint protocolos_casados_array check (
    jsonb_typeof(protocolos_casados) = 'array'
  ),

  constraint frames_array check (
    jsonb_typeof(frames) = 'array'
  ),

  constraint descarte_exige_obs check (
    decisao is distinct from 'descartada'
    or nullif(trim(coalesce(decisao_obs, '')), '') is not null
  ),

  constraint ajuste_exige_protocolo check (
    decisao is distinct from 'ajustada'
    or protocolo_escolhido_id is not null
  ),

  constraint decisao_exige_operador_e_data check (
    decisao is null
    or (
      operador_id is not null
      and decidida_em is not null
    )
  )
);

create table frame_jobs (
  id uuid primary key default gen_random_uuid(),
  ocorrencia_id uuid not null references ocorrencias(id) on delete restrict,
  tipo text not null check (tipo in ('extrair_frames')),
  origem text not null,
  destino_dir text not null,
  parametros jsonb not null,
  status text not null check (
    status in ('pendente', 'processando', 'concluido', 'erro')
  ),
  claimed_by text,
  claimed_at timestamptz,
  concluido_em timestamptz,
  erro_mensagem text,
  tentativas integer not null default 0 check (tentativas >= 0),
  created_at timestamptz not null default now(),

  constraint frame_jobs_parametros_object check (
    jsonb_typeof(parametros) = 'object'
  )
);

create table auditoria (
  id uuid primary key default gen_random_uuid(),
  ocorrencia_id uuid references ocorrencias(id) on delete restrict,
  evento text not null,
  detalhe jsonb not null default '{}'::jsonb,
  ator text not null,
  created_at timestamptz not null default now(),

  constraint auditoria_detalhe_object check (
    jsonb_typeof(detalhe) = 'object'
  )
);

create index usuarios_email_idx
  on usuarios (email);

create index usuarios_papel_ativo_idx
  on usuarios (papel, ativo);

create index cameras_ativa_idx
  on cameras (ativa);

create index protocolos_ativo_prioridade_idx
  on protocolos (ativo, prioridade);

create index ocorrencias_camera_id_idx
  on ocorrencias (camera_id);

create index ocorrencias_status_created_at_idx
  on ocorrencias (status, created_at desc);

create index ocorrencias_protocolos_casados_gin_idx
  on ocorrencias using gin (protocolos_casados);

create index ocorrencias_protocolo_escolhido_id_idx
  on ocorrencias (protocolo_escolhido_id);

create index ocorrencias_operador_id_idx
  on ocorrencias (operador_id);

create index frame_jobs_status_created_at_idx
  on frame_jobs (status, created_at);

create index frame_jobs_ocorrencia_id_idx
  on frame_jobs (ocorrencia_id);

create index auditoria_ocorrencia_id_created_at_idx
  on auditoria (ocorrencia_id, created_at);

create function prevent_auditoria_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'auditoria is append-only';
end;
$$;

create trigger auditoria_no_update
before update on auditoria
for each row execute function prevent_auditoria_mutation();

create trigger auditoria_no_delete
before delete on auditoria
for each row execute function prevent_auditoria_mutation();

create function audit_decisao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into auditoria (
    ocorrencia_id,
    evento,
    ator,
    detalhe
  )
  values (
    new.id,
    'decidida',
    coalesce(new.operador_id::text, 'desconhecido'),
    jsonb_build_object(
      'decisao', new.decisao,
      'status', new.status,
      'protocolos_casados', new.protocolos_casados,
      'protocolo_escolhido_id', new.protocolo_escolhido_id,
      'decisao_obs', new.decisao_obs
    )
  );

  return new;
end;
$$;

create trigger ocorrencias_audit_decisao
after update of decisao on ocorrencias
for each row
when (
  old.decisao is null
  and new.decisao is not null
)
execute function audit_decisao();
