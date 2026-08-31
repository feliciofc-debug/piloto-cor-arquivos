alter table ocorrencias
  add column video_analise text,
  add column video_analise_truncado boolean not null default false;
