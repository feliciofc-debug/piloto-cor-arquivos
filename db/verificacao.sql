
-- Verificacao do schema inicial do Piloto COR.
-- Rode depois de aplicar as migracoes em db/migrations/.
--
-- O script imprime uma linha OK/FALHA por verificacao.
-- Ele cria registros de teste com prefixo VERIFICACAO_.

create temp table if not exists verificacao_resultados (
  id bigserial primary key,
  status text not null,
  verificacao text not null,
  detalhe text
);

truncate table verificacao_resultados;

create or replace function pg_temp.registrar_verificacao(
  nome text,
  passou boolean,
  detalhe_ok text default null,
  detalhe_falha text default null
)
returns void
language plpgsql
as $$
begin
  insert into verificacao_resultados (status, verificacao, detalhe)
  values (
    case when passou then 'OK' else 'FALHA' end,
    nome,
    case when passou then detalhe_ok else detalhe_falha end
  );
end;
$$;

do $$
declare
  table_name text;
  expected_tables text[] := array[
    'usuarios',
    'cameras',
    'protocolos',
    'ocorrencias',
    'frame_jobs',
    'auditoria'
  ];
begin
  foreach table_name in array expected_tables loop
    perform pg_temp.registrar_verificacao(
      format('tabela public.%s existe', table_name),
      exists (
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = table_name
          and c.relkind = 'r'
      ),
      'tabela encontrada',
      'tabela ausente'
    );

    perform pg_temp.registrar_verificacao(
      format('public.%s esta sem RLS', table_name),
      exists (
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = table_name
          and c.relkind = 'r'
          and c.relrowsecurity = false
      ),
      'RLS desabilitada como previsto na v2',
      'RLS habilitada indevidamente ou tabela ausente'
    );
  end loop;

  perform pg_temp.registrar_verificacao(
    'tabela public.schema_migrations existe',
    exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'schema_migrations'
        and c.relkind = 'r'
    ),
    'controle de versao do schema encontrado',
    'schema_migrations ausente'
  );
end;
$$;

do $$
begin
  perform pg_temp.registrar_verificacao(
    'trigger auditoria_no_update existe',
    exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'auditoria'
        and t.tgname = 'auditoria_no_update'
        and not t.tgisinternal
        and t.tgenabled = 'O'
    ),
    'trigger habilitado',
    'trigger ausente ou desabilitado'
  );

  perform pg_temp.registrar_verificacao(
    'trigger auditoria_no_delete existe',
    exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'auditoria'
        and t.tgname = 'auditoria_no_delete'
        and not t.tgisinternal
        and t.tgenabled = 'O'
    ),
    'trigger habilitado',
    'trigger ausente ou desabilitado'
  );

  perform pg_temp.registrar_verificacao(
    'trigger ocorrencias_audit_decisao existe',
    exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'ocorrencias'
        and t.tgname = 'ocorrencias_audit_decisao'
        and not t.tgisinternal
        and t.tgenabled = 'O'
    ),
    'trigger habilitado',
    'trigger ausente ou desabilitado'
  );
end;
$$;

do $$
declare
  v_usuario_id uuid := gen_random_uuid();
  v_camera_id uuid := gen_random_uuid();
  v_protocolo_id uuid := gen_random_uuid();
  v_ocorrencia_id uuid := gen_random_uuid();
  v_auditoria_id uuid;
  v_constraint text;
begin
  insert into usuarios (
    id,
    email,
    senha_hash,
    nome,
    papel,
    ativo
  )
  values (
    v_usuario_id,
    'verificacao+' || v_usuario_id::text || '@pilotocor.local',
    'argon2id_hash_de_teste',
    'VERIFICACAO_OPERADOR',
    'operador',
    true
  );

  insert into cameras (
    id,
    nome,
    tunel,
    sentido,
    endereco,
    latitude,
    longitude,
    stream_url
  )
  values (
    v_camera_id,
    'VERIFICACAO_CAMERA',
    'Tunel de verificacao',
    'sentido teste',
    'endereco teste',
    -22.0,
    -43.0,
    null
  );

  insert into protocolos (
    id,
    codigo,
    nome,
    descricao,
    criterios,
    acionamentos,
    prioridade,
    ativo
  )
  values (
    v_protocolo_id,
    'VERIFICACAO_' || substr(v_protocolo_id::text, 1, 8),
    'Protocolo de verificacao',
    'Registro criado pelo teste de migracao',
    '{"todos":[{"campo":"veiculo_parado","igual":true}],"algum":[],"nenhum":[]}'::jsonb,
    '[{"orgao":"COR","prioridade":1}]'::jsonb,
    1,
    true
  );

  insert into ocorrencias (
    id,
    camera_id,
    origem,
    status,
    fatos,
    confianca,
    protocolos_casados,
    frame_principal,
    frames,
    detectada_em
  )
  values (
    v_ocorrencia_id,
    v_camera_id,
    'upload',
    'aguardando_operador',
    '{"veiculo_parado":true,"confianca":"alta"}'::jsonb,
    'alta',
    jsonb_build_array(jsonb_build_object(
      'protocolo_id', v_protocolo_id,
      'codigo', 'VERIFICACAO',
      'nome', 'Protocolo de verificacao',
      'acionamentos', jsonb_build_array(jsonb_build_object(
        'orgao', 'COR',
        'prioridade', 1
      ))
    )),
    'verificacao/frame_001.jpg',
    '["verificacao/frame_001.jpg"]'::jsonb,
    now()
  );

  update ocorrencias
  set
    status = 'aprovada',
    operador_id = v_usuario_id,
    decisao = 'aprovada',
    decidida_em = now()
  where id = v_ocorrencia_id;

  select a.id
  into v_auditoria_id
  from auditoria a
  where a.ocorrencia_id = v_ocorrencia_id
    and a.evento = 'decidida'
    and a.ator = v_usuario_id::text
    and a.detalhe ->> 'decisao' = 'aprovada'
    and a.detalhe ->> 'status' = 'aprovada'
    and a.detalhe ? 'protocolos_casados'
    and a.detalhe ? 'protocolo_escolhido_id'
    and a.detalhe ? 'decisao_obs'
  order by a.created_at desc
  limit 1;

  perform pg_temp.registrar_verificacao(
    'trigger de decisao cria auditoria com evento decidida',
    v_auditoria_id is not null,
    'linha de auditoria criada com decisao, status, protocolos_casados, protocolo_escolhido_id e decisao_obs',
    'nenhuma linha de auditoria esperada foi encontrada'
  );

  if v_auditoria_id is not null then
    begin
      update auditoria
      set detalhe = jsonb_set(detalhe, '{tentativa}', '"update"')
      where id = v_auditoria_id;

      perform pg_temp.registrar_verificacao(
        'trigger append-only bloqueia update em auditoria',
        false,
        null,
        'update em auditoria foi aceito, mas deveria falhar'
      );
    exception
      when others then
        perform pg_temp.registrar_verificacao(
          'trigger append-only bloqueia update em auditoria',
          sqlerrm = 'auditoria is append-only',
          'update bloqueado pela trigger auditoria_no_update',
          'erro inesperado: ' || sqlerrm
        );
    end;

    begin
      delete from auditoria
      where id = v_auditoria_id;

      perform pg_temp.registrar_verificacao(
        'trigger append-only bloqueia delete em auditoria',
        false,
        null,
        'delete em auditoria foi aceito, mas deveria falhar'
      );
    exception
      when others then
        perform pg_temp.registrar_verificacao(
          'trigger append-only bloqueia delete em auditoria',
          sqlerrm = 'auditoria is append-only',
          'delete bloqueado pela trigger auditoria_no_delete',
          'erro inesperado: ' || sqlerrm
        );
    end;
  else
    perform pg_temp.registrar_verificacao(
      'trigger append-only bloqueia update em auditoria',
      false,
      null,
      'teste ignorado porque a auditoria de decisao nao foi criada'
    );

    perform pg_temp.registrar_verificacao(
      'trigger append-only bloqueia delete em auditoria',
      false,
      null,
      'teste ignorado porque a auditoria de decisao nao foi criada'
    );
  end if;

  begin
    insert into ocorrencias (
      camera_id,
      origem,
      status,
      protocolos_casados,
      frames,
      operador_id,
      decisao,
      decisao_obs,
      decidida_em
    )
    values (
      v_camera_id,
      'upload',
      'descartada',
      '[]'::jsonb,
      '[]'::jsonb,
      v_usuario_id,
      'descartada',
      null,
      now()
    );

    perform pg_temp.registrar_verificacao(
      'constraint bloqueia descarte sem motivo',
      false,
      null,
      'descarte sem decisao_obs foi aceito'
    );
  exception
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;

      perform pg_temp.registrar_verificacao(
        'constraint bloqueia descarte sem motivo',
        v_constraint = 'descarte_exige_obs',
        'check violation esperado: descarte_exige_obs',
        'check violation veio de outra constraint: ' || coalesce(v_constraint, '<sem nome>')
      );
    when others then
      perform pg_temp.registrar_verificacao(
        'constraint bloqueia descarte sem motivo',
        false,
        null,
        'erro inesperado: ' || sqlerrm
      );
  end;

  begin
    insert into ocorrencias (
      camera_id,
      origem,
      status,
      protocolos_casados,
      frames,
      operador_id,
      decisao,
      decisao_obs,
      decidida_em
    )
    values (
      v_camera_id,
      'upload',
      'aprovada',
      '[]'::jsonb,
      '[]'::jsonb,
      v_usuario_id,
      'ajustada',
      'ajuste sem protocolo escolhido deve falhar',
      now()
    );

    perform pg_temp.registrar_verificacao(
      'constraint bloqueia ajuste sem protocolo escolhido',
      false,
      null,
      'ajuste sem protocolo_escolhido_id foi aceito'
    );
  exception
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;

      perform pg_temp.registrar_verificacao(
        'constraint bloqueia ajuste sem protocolo escolhido',
        v_constraint = 'ajuste_exige_protocolo',
        'check violation esperado: ajuste_exige_protocolo',
        'check violation veio de outra constraint: ' || coalesce(v_constraint, '<sem nome>')
      );
    when others then
      perform pg_temp.registrar_verificacao(
        'constraint bloqueia ajuste sem protocolo escolhido',
        false,
        null,
        'erro inesperado: ' || sqlerrm
      );
  end;
end;
$$;

do $$
declare
  missing_protocolos text;
begin
  select string_agg(codigo, ', ' order by codigo)
  into missing_protocolos
  from (
    values
      ('TUN-01'),
      ('TUN-02'),
      ('TUN-03'),
      ('TUN-04'),
      ('TUN-05')
  ) expected(codigo)
  where not exists (
    select 1
    from protocolos p
    where p.codigo = expected.codigo
      and p.ativo = true
  );

  perform pg_temp.registrar_verificacao(
    'protocolos provisórios TUN-01 a TUN-05 existem',
    missing_protocolos is null,
    'cinco protocolos provisórios encontrados',
    coalesce('protocolos ausentes: ' || missing_protocolos, 'protocolos ausentes')
  );
end;
$$;

do $$
declare
  tun01_ok boolean;
  tun03_ok boolean;
  tun05_ok boolean;
  vazio_ok boolean;
  nenhum_bloqueia_ok boolean;
  aninhado_ok boolean;
begin
  perform pg_temp.registrar_verificacao(
    'funcao protocol_criteria_matches existe',
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'protocol_criteria_matches'
    ),
    'funcao encontrada',
    'funcao ausente'
  );

  select protocol_criteria_matches(
    '{"pessoa_ao_solo":true}'::jsonb,
    p.criterios
  )
  into tun01_ok
  from protocolos p
  where p.codigo = 'TUN-01';

  perform pg_temp.registrar_verificacao(
    'TUN-01 casa com pessoa_ao_solo = true',
    coalesce(tun01_ok, false),
    'casamento confirmado',
    'TUN-01 nao casou como esperado'
  );

  select protocol_criteria_matches(
    '{"veiculo_parado":true}'::jsonb,
    p.criterios
  )
  into tun03_ok
  from protocolos p
  where p.codigo = 'TUN-03';

  perform pg_temp.registrar_verificacao(
    'TUN-03 casa com veiculo_parado = true',
    coalesce(tun03_ok, false),
    'casamento confirmado',
    'TUN-03 nao casou como esperado'
  );

  select protocol_criteria_matches(
    '{"agua_na_pista":true}'::jsonb,
    p.criterios
  )
  into tun05_ok
  from protocolos p
  where p.codigo = 'TUN-05';

  perform pg_temp.registrar_verificacao(
    'TUN-05 casa com agua_na_pista = true',
    coalesce(tun05_ok, false),
    'casamento confirmado',
    'TUN-05 nao casou como esperado'
  );

  select not protocol_criteria_matches(
    '{}'::jsonb,
    '{"todos":[],"algum":[],"nenhum":[]}'::jsonb
  )
  into vazio_ok;

  perform pg_temp.registrar_verificacao(
    'criterio vazio nao casa com tudo',
    coalesce(vazio_ok, false),
    'protocolo sem condicao nao casa',
    'protocolo sem condicao casou indevidamente'
  );

  select not protocol_criteria_matches(
    '{"fogo":true}'::jsonb,
    '{"todos":[],"algum":[],"nenhum":[{"campo":"fogo","igual":true}]}'::jsonb
  )
  into nenhum_bloqueia_ok;

  perform pg_temp.registrar_verificacao(
    'nenhum bloqueia quando condicao proibida aparece',
    coalesce(nenhum_bloqueia_ok, false),
    'condicao proibida bloqueou o casamento',
    'condicao proibida nao bloqueou o casamento'
  );

  select protocol_condition_matches(
    '{"veiculos":{"moto":1}}'::jsonb,
    '{"campo":"veiculos.moto","maior_que":0}'::jsonb
  )
  into aninhado_ok;

  perform pg_temp.registrar_verificacao(
    'campo aninhado veiculos.moto funciona',
    coalesce(aninhado_ok, false),
    'campo aninhado avaliado corretamente',
    'campo aninhado nao foi avaliado corretamente'
  );
end;
$$;

select
  status,
  verificacao,
  detalhe
from verificacao_resultados
order by id;
