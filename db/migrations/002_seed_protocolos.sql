-- Protocolos provisórios para teste do piloto em túnel.
-- Estes registros serão substituídos pelos protocolos oficiais do COR
-- quando a documentação operacional for entregue.

insert into protocolos (
  codigo,
  nome,
  descricao,
  criterios,
  acionamentos,
  prioridade,
  ativo
)
values
  (
    'TUN-01',
    'Pessoa ao solo',
    'Pessoa ao solo em área de túnel ou pista.',
    jsonb_build_object(
      'todos', jsonb_build_array(jsonb_build_object(
        'campo', 'pessoa_ao_solo',
        'igual', true
      )),
      'algum', '[]'::jsonb,
      'nenhum', '[]'::jsonb
    ),
    jsonb_build_array(
      jsonb_build_object('orgao', 'SAMU', 'prioridade', 1),
      jsonb_build_object('orgao', 'Bombeiros', 'prioridade', 1),
      jsonb_build_object('orgao', 'Agente', 'prioridade', 2)
    ),
    1,
    true
  ),
  (
    'TUN-02',
    'Princípio de incêndio',
    'Fogo ou fumaça identificados em túnel.',
    jsonb_build_object(
      'todos', '[]'::jsonb,
      'algum', jsonb_build_array(
        jsonb_build_object('campo', 'fogo', 'igual', true),
        jsonb_build_object('campo', 'fumaca', 'igual', true)
      ),
      'nenhum', '[]'::jsonb
    ),
    jsonb_build_array(
      jsonb_build_object('orgao', 'Bombeiros', 'prioridade', 1),
      jsonb_build_object('orgao', 'Agente', 'prioridade', 1)
    ),
    1,
    true
  ),
  (
    'TUN-03',
    'Veículo parado em faixa',
    'Veículo parado em faixa de rolamento.',
    jsonb_build_object(
      'todos', jsonb_build_array(jsonb_build_object(
        'campo', 'veiculo_parado',
        'igual', true
      )),
      'algum', '[]'::jsonb,
      'nenhum', '[]'::jsonb
    ),
    jsonb_build_array(
      jsonb_build_object('orgao', 'Reboque', 'prioridade', 2),
      jsonb_build_object('orgao', 'Agente', 'prioridade', 2)
    ),
    2,
    true
  ),
  (
    'TUN-04',
    'Pessoa a pé na pista',
    'Pessoa caminhando ou parada na pista do túnel.',
    jsonb_build_object(
      'todos', jsonb_build_array(jsonb_build_object(
        'campo', 'pessoa_na_pista',
        'igual', true
      )),
      'algum', '[]'::jsonb,
      'nenhum', '[]'::jsonb
    ),
    jsonb_build_array(
      jsonb_build_object('orgao', 'Agente', 'prioridade', 1)
    ),
    1,
    true
  ),
  (
    'TUN-05',
    'Água na pista',
    'Acúmulo de água ou lâmina d''água na pista do túnel.',
    jsonb_build_object(
      'todos', jsonb_build_array(jsonb_build_object(
        'campo', 'agua_na_pista',
        'igual', true
      )),
      'algum', '[]'::jsonb,
      'nenhum', '[]'::jsonb
    ),
    jsonb_build_array(
      jsonb_build_object('orgao', 'Agente', 'prioridade', 2),
      jsonb_build_object('orgao', 'Manutenção', 'prioridade', 3)
    ),
    2,
    true
  )
on conflict (codigo) do update
set
  nome = excluded.nome,
  descricao = excluded.descricao,
  criterios = excluded.criterios,
  acionamentos = excluded.acionamentos,
  prioridade = excluded.prioridade,
  ativo = excluded.ativo;
