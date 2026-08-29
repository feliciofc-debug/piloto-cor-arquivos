alter table ocorrencias
  add column acionamentos_definidos jsonb not null default '[]'::jsonb,
  add column orientacao_campo text,
  add constraint acionamentos_definidos_array check (
    jsonb_typeof(acionamentos_definidos) = 'array'
  );

alter table ocorrencias
  drop constraint ajuste_exige_protocolo;

alter table ocorrencias
  add constraint ajuste_exige_protocolo check (
    decisao is distinct from 'ajustada'
    or protocolo_escolhido_id is not null
    or jsonb_array_length(acionamentos_definidos) > 0
  );

create or replace function audit_decisao()
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
      'acionamentos_definidos', new.acionamentos_definidos,
      'orientacao_campo', new.orientacao_campo,
      'decisao_obs', new.decisao_obs
    )
  );

  return new;
end;
$$;
