# Histórico de Atividades

**Item:** PROD-14 (#129) · **Regras:** RN-01, RN-07

Na página de cada cliente (aba **Histórico de Atividades** da tela do processo), o analista responsável registra o que fez no acompanhamento do financiamento: tentativas de contato, cobrança de documentos, mensagens enviadas etc. O gestor acompanha o histórico completo e o cliente lê os registros no próprio portal.

A aba substitui a antiga aba "Atividade": no topo ficam os registros do analista e, abaixo, a linha do tempo automática que já existia (agora com o título **Eventos do processo**).

## Regras

### Registro
- **Quem registra:** só o analista responsável pelo processo (`processes.analista_id`). Gestor, outros analistas e o cliente não registram. Processo sem analista responsável ou removido não recebe registros.
- **O que o usuário preenche:** só a descrição, texto livre, de 3 a 2000 caracteres (espaços nas pontas são removidos).
- **O que o sistema preenche:** data e hora (relógio do banco no momento da gravação), etapa (a etapa do processo naquele instante, lida no mesmo comando), autor (usuário logado), assessoria, processo e cliente. A API recusa qualquer outro campo no corpo (`stage`, `createdAt`, `authorId`...).
- **A etapa não muda depois:** se o processo avançar, os registros antigos continuam com a etapa da época.

### Leitura
| Perfil | O que vê |
|---|---|
| Analista responsável | Histórico completo, com autor; formulário para registrar; editar/excluir os próprios registros dentro do prazo |
| Outro analista da assessoria | Histórico completo, com autor (mesma regra de acesso da página do processo); sem formulário |
| Gestor | Histórico completo, com autor; sem formulário; **poder geral** sobre os registros: edita qualquer um a qualquer momento e exclui qualquer um, com motivo |
| Cliente (portal) | Só o próprio processo; de cada registro, só **data, hora, etapa e descrição** (sem autor nem dados internos); nenhuma ação |

Ordem: mais recente primeiro. Registros excluídos não aparecem para ninguém.

### Edição
- **Autor (analista):** só os próprios registros, até **24 horas** depois do registro. Depois disso, a correção é um novo registro.
- **Gestor:** qualquer registro, de qualquer autor, a qualquer momento (poder geral, decisão do PO em 13/10/2026).
- Só a **descrição** muda. Data, hora, etapa e autor nunca mudam; quem editou fica gravado (`edited_by`).
- O registro passa a mostrar "editado" para a equipe, ou "editado por <nome>" quando quem editou não foi o autor (o cliente não vê essa marca).
- O texto anterior fica no Log de Ações (`activity_edited`, com `before` e `authorId` nos metadados).

### Exclusão
- **Nunca definitiva:** o registro sai do histórico (inclusive do portal do cliente), mas continua no banco, com `deleted_at`, `deleted_by` e `delete_reason`.
- **Autor:** pode retirar o próprio registro até 24 horas depois; motivo opcional.
- **Gestor:** pode excluir qualquer registro a qualquer momento, com **motivo obrigatório** (moderação do que o cliente lê).
- **Cliente e outros analistas:** nunca excluem.
- A exclusão vai para o Log de Ações (`activity_deleted`, com o texto e o motivo).
- Edições e exclusões aparecem para a equipe na linha do tempo do processo e no Log de Ações; o cliente não as vê.

### Isolamento (RN-01)
Toda consulta filtra pela assessoria do usuário. Processo de outra assessoria, ou de outro cliente no caso do cliente, responde 404, como `GET /processes/:id`.

## API

| Método | Rota | Perfis | Observações |
|---|---|---|---|
| GET | `/processes/:processId/activities` | gestor, analista, cliente | `{ canCreate, activities[] }`; para a equipe, cada item traz `author`, `editedAt`, `canEdit`, `canDelete` |
| POST | `/processes/:processId/activities` | analista (responsável) | corpo `{ description }` |
| PATCH | `/processes/:processId/activities/:id` | analista (autor, 24 h), gestor (qualquer registro, sem prazo) | corpo `{ description }` |
| DELETE | `/processes/:processId/activities/:id?reason=...` | analista (autor, 24 h), gestor (motivo obrigatório) | exclusão lógica |

## Banco

Tabela `process_activities` (migrations `1718501000000-AddProcessActivities` e `1718501100000-AddActivityEditedBy`): `id`, `tenant_id`, `process_id`, `client_id`, `author_id`, `stage`, `description`, `created_at`, `edited_at`, `edited_by`, `deleted_at`, `deleted_by`, `delete_reason`.

Por que não reaproveitar `audit_logs`: o log de auditoria é imutável e registra o que o sistema fez. Os registros do histórico são texto do analista, que pode ser corrigido ou retirado. Por isso ficam numa tabela própria, e só as correções e as exclusões vão para `audit_logs`.

## Critérios de aceite

| # | Critério | Como testar |
|---|---|---|
| CA-01 | O analista responsável registra uma atividade só com a descrição; data/hora, etapa atual e autor são preenchidos pelo sistema e gravados com assessoria, processo e cliente | Registrar e conferir a resposta e a linha em `process_activities` |
| CA-02 | Descrição obrigatória, de 3 a 2000 caracteres: vazia, em branco, com 2 ou com 2001 caracteres → 400; com 2000 → aceita | POST com cada caso |
| CA-03 | Etapa, data e autor enviados pelo usuário são recusados (400) | POST com `stage`, `createdAt`, `authorId` |
| CA-04 | A etapa gravada é a do momento do registro e não muda quando o processo avança | Registrar em Cadastro, avançar para Análise de Crédito, registrar de novo e listar |
| CA-05 | O histórico aparece do mais recente para o mais antigo | Listar depois de dois registros |
| CA-06 | O gestor vê o histórico completo com autor, mas não registra (403) | GET e POST como gestor |
| CA-07 | Outro analista da assessoria vê o histórico, mas não registra (403) | GET e POST como outro analista |
| CA-08 | Processo sem analista responsável não recebe registros e a tela não mostra o formulário | POST e GET no processo sem analista |
| CA-09 | O cliente vê as atividades do próprio processo, só com data/hora, etapa e descrição, e não cria, edita nem exclui (403) | GET, POST, PATCH e DELETE como cliente |
| CA-10 | Outro cliente da mesma assessoria não acessa o histórico (404) | GET como outro cliente |
| CA-11 | Usuários de outra assessoria não leem, não escrevem e não excluem (404) | GET, POST e DELETE como gestor, analista e cliente da outra assessoria |
| CA-12 | O autor edita a descrição em até 24 h, sem mudar data, etapa e autor, e o texto anterior vai para o Log de Ações; depois de 24 h, 403; o gestor edita qualquer registro a qualquer momento e fica gravado como quem editou (a equipe vê "editado por", o cliente não); outro analista não edita | PATCH dentro e fora do prazo, pelo gestor e por outro analista; consulta a `edited_by` |
| CA-13 | Exclusão: autor em até 24 h; gestor a qualquer momento, só com motivo (400 sem motivo); o registro some do histórico (inclusive para o cliente), continua no banco marcado como excluído e aparece no Log de Ações | DELETE em cada caso e consulta ao banco |
| CA-14 | O histórico persiste: depois de recarregar a página ou reiniciar a API, os mesmos registros aparecem na mesma ordem | Reiniciar a API e listar como analista e como cliente |
| CA-15 | A linha do tempo do processo mostra edições e exclusões para a equipe, mas não para o cliente | `GET /processes/:id/audit` como gestor e como cliente |
| CA-16 | Na tela: o analista digita, clica em "Salvar atividade", o registro aparece no topo na hora e o campo é limpo; continua lá depois de recarregar; gestor e outro analista não veem o formulário; o gestor edita qualquer registro e só exclui com motivo; o cliente não vê autor nem botões; no celular (390 px) não há rolagem horizontal | Navegador, como cada perfil |

## Testes

- `backend/src/activities/activities.service.spec.ts`: regras de criação, leitura por perfil, edição, exclusão e isolamento.
- `backend/test/activities.e2e-spec.ts`: rotas com o `RolesGuard` e o `ValidationPipe` reais (perfis, validação da descrição, campos forjados, UUIDs).
- `backend/src/processes/processes.service.spec.ts`: o cliente não vê `activity_edited`/`activity_deleted` na linha do tempo.

Verificado em 13/10/2026 (ambiente local): API real contra uma cópia do banco com uma segunda assessoria, 56 verificações dos critérios CA-01 a CA-15 pela API e 18 verificações da CA-16 no navegador (Chrome), incluindo celular e a edição pelo gestor.
