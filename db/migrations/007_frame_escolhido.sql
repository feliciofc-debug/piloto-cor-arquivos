alter table ocorrencias
  add column frame_escolhido text;

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
      'frame_escolhido', new.frame_escolhido,
      'decisao_obs', new.decisao_obs
    )
  );

  return new;
end;
$$;
