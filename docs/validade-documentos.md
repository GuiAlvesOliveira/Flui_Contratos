# Validade de documentos pelo mês de referência

**Regras:** RN-01, RN-04, RN-07 · **Avisos:** só dentro da plataforma (sem e-mail ou WhatsApp)

Os bancos só aceitam holerite, extrato bancário e comprovante de endereço recentes. Quando um deles vencia no meio do processo, a equipe só descobria tarde. Agora, ao validar um documento desse tipo, o analista informa o **mês de referência** (a competência do holerite, o mês do extrato, o mês da conta usada como comprovante). O sistema calcula até quando o documento vale, mostra a situação no checklist e no portal do cliente, trava o avanço de etapa quando um documento vence e avisa o cliente e a equipe dentro da plataforma.

## Regras

### Validade por tipo de documento
- Cada item da **Lista de Documentos** da assessoria (Configurações) tem uma validade em meses, alterável pelo gestor sem mudar código (`document_types.validity_months`, de 1 a 120). Vazio = sem validade.
- Valores iniciais (migration, pelo nome do item, em todas as assessorias): **Holerite 3 meses**, **Comprovante de endereço 3 meses**, **Extrato bancário 6 meses**. Assessorias novas recebem a lista padrão já com esses prazos.
- Tipos sem validade (RG, CNH, certidões, IRPF) funcionam como antes: a validação não pede mês.
- Mudar a validade de um item vale para as **próximas validações**. Cada documento validado guarda o prazo usado (`documents.validity_months`) e a data calculada.

### Cálculo do vencimento
- O documento vale até o **último dia do mês (mês de referência + validade em meses)**. Ex.: holerite de 03/2026 com 3 meses vale até 30/06/2026; extrato de 11/2026 com 3 meses vale até 28/02/2027.
- Vale **até o dia do vencimento, inclusive**; a partir do dia seguinte está **vencido**.
- **Vencendo** = faltam 15 dias ou menos (`EXPIRING_DAYS`).
- Datas no calendário de **São Paulo** (a API roda em UTC).
- O cálculo fica isolado em `backend/src/documents/document-validity.ts` (testado em `document-validity.spec.ts`) porque a regra pode mudar. A tela usa uma cópia em `frontend/src/lib/documentValidity.ts` só para a prévia; quem decide é a API.

### Mês de referência na validação
- Validar um documento de tipo com validade **exige** o mês (MM/AAAA). Sem ele, o botão "Aprovar" fica bloqueado na tela, e a API recusa com 400.
- Mês **no futuro** (depois do mês corrente de São Paulo) é recusado (400).
- Documento que **já nasceria vencido** não é aprovado (422): o caminho é rejeitar e pedir um mais recente.
- Assim que o mês é preenchido, a tela mostra "Válido até DD/MM/AAAA".
- Só a equipe da assessoria informa o mês; o cliente recebe 403.
- Rejeitar o documento ou enviar um arquivo novo limpa a validade: o mês pertence à versão validada. O histórico de versões guarda o mês de cada versão validada.

### Documentos validados antes desta regra
- Ficam **sem mês de referência** e **nunca vencem sozinhos**. Para a equipe, aparecem como **"Mês de referência não informado"**.
- O analista revisa e usa **"Informar mês"**. O mesmo caminho serve para corrigir um mês digitado errado ("Corrigir mês"). Aqui um resultado já vencido é aceito: o documento já estava aprovado, e ele passa a ser pendência.

### Situação do documento
| Situação | Quando | Checklist (equipe) | Portal (cliente) |
|---|---|---|---|
| Válido | faltam mais de 15 dias | "Válido até DD/MM/AAAA" | igual |
| Vencendo | faltam 15 dias ou menos | "Vence em N dias · DD/MM/AAAA" e botão "Enviar mais recente" | igual |
| Vencido | depois do último dia | selo "Vencido", "Valia até DD/MM/AAAA" e "Enviar mais recente" | igual, mais o aviso no topo do portal |
| Mês não informado | validado antes da regra | "Mês de referência não informado" e "Informar mês" | nada (assunto da equipe) |

### Pendência (RN-04)
Documento **vencido conta como pendência**: o processo não avança de etapa enquanto houver documento obrigatório vencido. A mesma trava já exigia todos os documentos validados. A conta é feita na API, pela data, mesmo que a rotina diária ainda não tenha rodado. A mensagem separa "N documento(s) pendente(s) de validação" de "N documento(s) vencido(s)", e a lista de pendências mostra o vencido com a situação `vencido`.

### Rotina diária
- Roda às **7h de Brasília** (`DOCUMENT_EXPIRY_HOUR`) e também 1 minuto depois de cada boot da API. `DOCUMENT_EXPIRY_ENABLED=off` desliga.
- Considera documentos **validados com mês de referência** que vencem em até 15 dias ou já venceram, de processos **ativos e em andamento**. Assinatura, Inativo e Crédito recusado não geram aviso, como no prazo de atendimento.
- **Faltando 15 dias ou menos:** cria o aviso **"documento vencendo"**.
- **Vencido:** marca o documento (`expired_at`), registra `document_expired` no histórico de cada processo que o usa e cria o aviso **"documento vencido"**.
- **Quem recebe:** o cliente dono do documento e o **analista responsável** pelo processo. Sem analista ativo, os **gestores** da assessoria recebem, a mesma regra do alerta de processo parado. O comprovante de endereço vale para todos os processos do cliente: o analista de cada processo recebe o aviso, uma vez por pessoa.
- **Sem aviso repetido:** antes de criar, a rotina confere se já existe aviso para aquele documento, tipo de aviso, destinatário e ciclo de validade. O índice único `uq_notifications_document_cycle` garante o mesmo com duas instâncias da API ao mesmo tempo, e cada documento é tratado numa transação com trava (`pg_advisory_xact_lock` + `FOR UPDATE`).
- Cada aviso criado vai para o histórico do processo (`document_expiry_notice`, com destinatário e tipo).

### Novo documento, nova contagem
O cliente envia um documento novo do mesmo tipo (nova versão). O documento volta para "Recebido", sai da lista de vencidos e o aviso do topo some. Quando o analista valida com um **novo mês de referência**, a contagem recomeça, a pendência deixa de existir e os avisos antigos daquele documento passam a "Resolvido" (`resolved_at`).

### Avisos na plataforma
- Tabela `notifications`: assessoria, processo, destinatário, documento, tipo do aviso, mensagem, criação, leitura e resolução.
- **Sino (cliente e equipe):** contador de não lidas (avisos pendentes não lidos mais as atualizações) e a seção "Validade de documentos" com a mensagem e o botão **"Enviar documento"** (cliente) ou **"Ver documento"** (equipe). Esse botão abre o processo direto na aba Documentos, com a linha do documento em destaque. Abrir o aviso marca como lido. Avisos resolvidos ficam na lista por 30 dias, sem botão.
- Mensagens (exemplos):
  - cliente: *Seu documento "Extrato Bancário (mês 1)" vence em 15 dias (30/11/2026). Envie um documento mais recente.*
  - cliente: *Seu documento "Comprovante de Endereço" está vencido (valia até 31/10/2026). Envie um documento mais recente para o processo continuar.*
  - equipe: *"Extrato Bancário (mês 1)" de Maria Souza vence em 10 dias (30/11/2026). Peça um documento mais recente ao cliente.*
- **Portal do cliente:** aviso em destaque no topo enquanto houver documento vencido, com o botão para enviar.
- **Painel do analista e do gestor:** cartão **"Documentos vencendo ou vencidos"**. O analista vê os processos dele; o gestor vê os da assessoria. Vencidos aparecem primeiro.
- Tudo se atualiza sozinho a cada minuto, sem recarregar a página.

### Isolamento (RN-01)
Todas as consultas filtram pela assessoria do usuário. Avisos só são lidos e marcados pelo próprio destinatário. O cliente só vê os documentos e avisos dos próprios processos. O registro de quem recebeu cada aviso (`document_expiry_notice`) fica fora da linha do tempo do portal.

### Histórico (RN-07)
- `document_validated` (com `referenceMonth`, `validUntil`, `validityMonths`): quem informou o mês e quando, gravado na mesma transação da validação. Documento pessoal entra no histórico do processo aberto na tela.
- `document_reference_month_set`: mês informado ou corrigido depois (guarda o mês anterior).
- `document_expired` e `document_expiry_notice`: o vencimento e cada aviso criado (ator "Sistema").

## API

| Método | Rota | Perfis | Observações |
|---|---|---|---|
| PATCH | `/documents/:id` | equipe | `{ status: 'validado', referenceMonth: 'MM/AAAA' }` valida; `{ referenceMonth }` sozinho informa ou corrige o mês de documento já validado; `processId` (opcional) é o processo aberto na tela |
| GET | `/processes/:id/documents` | equipe, cliente | cada documento de tipo com validade traz `typeValidityMonths`, `validityStatus` (`valido`, `vencendo`, `vencido`, `sem_referencia`), `daysLeft`, `referenceMonth`, `validUntil` |
| GET/POST/PATCH | `/document-types` | gestor altera | campo `validityMonths` (1 a 120; `null` tira a validade) |
| GET | `/document-expiry/processes` | gestor, analista | processos com documento vencendo ou vencido (analista: os dele) |
| GET | `/document-expiry/mine` | cliente | os próprios documentos vencidos (aviso do topo) e vencendo |
| GET | `/notifications` | todos | inclui `alerts[]` (avisos persistidos); `unread` soma os dois |
| POST | `/notifications/:id/read` · `/notifications/read-all` | todos | também marcam os avisos, só os do próprio usuário |

## Banco

Migration `1718502200000-AddDocumentValidity`:
- `document_types.validity_months`;
- `documents.reference_month`, `valid_until`, `validity_months`, `reference_month_set_by`, `reference_month_set_at`, `expired_at`;
- `document_versions.reference_month`, `valid_until`;
- tabela `notifications`, com índice único por documento + tipo + destinatário + ciclo (`valid_until`).

## Configuração

| Variável | Padrão | Efeito |
|---|---|---|
| `DOCUMENT_EXPIRY_HOUR` | `7` | hora (Brasília) da verificação diária |
| `DOCUMENT_EXPIRY_ENABLED` | `on` | `off` desliga a rotina nesta instância |

## Critérios de aceite

| # | Critério | Como testar |
|---|---|---|
| CA-01 | Validar tipo com validade sem mês → bloqueado na tela e 400 na API, nada gravado | `documents.service.spec`, e2e e tela |
| CA-02 | Mês no futuro → recusado na tela e na API | idem |
| CA-03 | Com o mês, a tela mostra "Válido até…" e a API grava vencimento, quem informou e quando, inclusive no histórico | idem |
| CA-04 | Vencimento = último dia do mês (referência + validade), com virada de ano e meses de 28/29/30/31 dias | `document-validity.spec` |
| CA-05 | Tipos sem validade funcionam como antes | unidade e e2e |
| CA-06 | Situação válido/vencendo/vencido no checklist e no portal, com a data | tela |
| CA-07 | Documento obrigatório vencido trava o avanço de etapa (RN-04) | e2e e tela |
| CA-08 | A rotina cria "vencendo" (≤ 15 dias) e "vencido" (marca o documento) para cliente e analista, registrados no histórico | e2e e API real |
| CA-09 | O mesmo aviso nunca é criado duas vezes, nem com execuções simultâneas | e2e (3 execuções em paralelo) e reinício da API |
| CA-10 | Portal: contador, lista com mensagem clara e botão que leva ao envio; marcar como lido ao abrir; aviso no topo enquanto houver vencido | tela |
| CA-11 | Painel do analista com os processos dele com documentos vencendo ou vencidos | e2e e tela |
| CA-12 | Documento novo validado com outro mês: contagem recomeça, pendência resolvida, avisos antigos resolvidos | e2e e tela |
| CA-13 | Documentos antigos sem mês não vencem sozinhos e aparecem como "mês de referência não informado" | e2e e tela |
| CA-14 | Isolamento: outra assessoria não vê avisos, documentos ou processos; o cliente só vê os próprios; ninguém marca o aviso de outra pessoa | e2e e tela |

## Testes

- `backend/src/documents/document-validity.spec.ts`: cálculo do vencimento, mês de referência, fuso de São Paulo e situação.
- `backend/src/documents/documents.service.spec.ts`: bloqueio sem mês, mês futuro, já vencido, gravação e histórico na mesma transação, tipos sem validade, documentos antigos.
- `backend/src/document-expiry/document-expiry.spec.ts`: textos dos avisos, rotina (sem repetir, destinatários, vencido marcado uma vez) e agendamento.
- `backend/src/notifications/notifications.service.spec.ts`: avisos no sino, contador e marcação só do próprio usuário.
- `backend/test/document-validity.e2e-spec.ts`: PostgreSQL real, com migration, validação, rotina (inclusive em paralelo), RN-04, nova contagem e isolamento entre assessorias e clientes.
