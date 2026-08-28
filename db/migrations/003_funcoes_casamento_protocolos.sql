create or replace function protocol_value_at(fatos jsonb, campo text)
returns jsonb
language sql
immutable
as $$
  select case
    when fatos is null or campo is null or campo = '' then null
    else fatos #> string_to_array(campo, '.')
  end;
$$;

create or replace function protocol_jsonb_to_numeric(valor jsonb)
returns numeric
language plpgsql
immutable
as $$
declare
  valor_texto text;
begin
  if valor is null then
    return null;
  end if;

  valor_texto := valor #>> '{}';

  if valor_texto is null or valor_texto !~ '^-?[0-9]+(\.[0-9]+)?$' then
    return null;
  end if;

  return valor_texto::numeric;
end;
$$;

create or replace function protocol_condition_matches(fatos jsonb, condicao jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  campo text;
  valor jsonb;
  valor_num numeric;
  esperado_num numeric;
begin
  campo := condicao ->> 'campo';

  if campo is null or campo = '' then
    return false;
  end if;

  valor := protocol_value_at(fatos, campo);

  if condicao ? 'igual' then
    return valor = condicao -> 'igual';
  end if;

  if condicao ? 'maior_que' then
    valor_num := protocol_jsonb_to_numeric(valor);
    esperado_num := protocol_jsonb_to_numeric(condicao -> 'maior_que');
    return valor_num is not null
      and esperado_num is not null
      and valor_num > esperado_num;
  end if;

  if condicao ? 'menor_que' then
    valor_num := protocol_jsonb_to_numeric(valor);
    esperado_num := protocol_jsonb_to_numeric(condicao -> 'menor_que');
    return valor_num is not null
      and esperado_num is not null
      and valor_num < esperado_num;
  end if;

  return false;
end;
$$;

create or replace function protocol_jsonb_array_or_empty(valor jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when jsonb_typeof(valor) = 'array' then valor
    else '[]'::jsonb
  end;
$$;

create or replace function protocol_criteria_matches(fatos jsonb, criterios jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  todos jsonb := protocol_jsonb_array_or_empty(criterios -> 'todos');
  algum jsonb := protocol_jsonb_array_or_empty(criterios -> 'algum');
  nenhum jsonb := protocol_jsonb_array_or_empty(criterios -> 'nenhum');
  total_condicoes integer;
begin
  total_condicoes :=
    jsonb_array_length(todos)
    + jsonb_array_length(algum)
    + jsonb_array_length(nenhum);

  -- Protocolo sem nenhuma condição não é aplicável.
  -- Isso evita que um cadastro incompleto case com toda ocorrência.
  if total_condicoes = 0 then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(todos) condicao
    where not protocol_condition_matches(fatos, condicao)
  ) then
    return false;
  end if;

  if jsonb_array_length(algum) > 0 and not exists (
    select 1
    from jsonb_array_elements(algum) condicao
    where protocol_condition_matches(fatos, condicao)
  ) then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(nenhum) condicao
    where protocol_condition_matches(fatos, condicao)
  ) then
    return false;
  end if;

  return true;
end;
$$;

comment on function protocol_criteria_matches(jsonb, jsonb)
is 'Avalia criterios todos/algum/nenhum. Se todos, algum e nenhum estiverem vazios, o protocolo nao casa com nada.';
