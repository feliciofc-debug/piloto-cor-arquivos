alter table ocorrencias
  drop constraint ocorrencias_status_check;

alter table ocorrencias
  add constraint ocorrencias_status_check check (
    status in (
      'analisando',
      'aguardando_operador',
      'aprovada',
      'descartada',
      'expirada',
      'sem_ocorrencia'
    )
  );
