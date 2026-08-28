alter table protocolos
  add column origem text not null default 'manual',
  add column origem_arquivo text,
  add column importado_em timestamptz,
  add constraint protocolos_origem_check check (origem in ('manual', 'pdf'));

create index protocolos_origem_idx
  on protocolos (origem, importado_em);
