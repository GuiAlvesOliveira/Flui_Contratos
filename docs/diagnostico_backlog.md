# Diagnóstico do MVP e Product Backlog — Sprint 0

**Produto:** Flui Contratos — SaaS de gestão de financiamento imobiliário para assessorias
**Equipe:** Guilherme Alves de Oliveira e Oliveira · João Pedro Lima Paulo
**Disciplina:** Ciência da Computação — FECAP · **Entrega:** Sprint 0 (Diagnóstico do MVP e Product Backlog)
**Data do diagnóstico:** 2026-08-25 · **Versão avaliada:** commit `244f458` (branch `main`)

> **🔗 LINK DO PRODUCT BACKLOG (ferramenta compartilhada — acesso de leitura público):**
> **https://github.com/users/GuiAlvesOliveira/projects/2**
> Publicado em **GitHub Projects v2** (board público) + **117 Issues** rastreáveis em `github.com/GuiAlvesOliveira/Flui_Contratos/issues`. _Exigência do enunciado §1.3 atendida._

---

## 0. Como este documento cobre o enunciado (rastreabilidade)

O enunciado da Sprint 0 pede **2 artefatos conectados**: (i) o **Diagnóstico** ("onde e como está o MVP e o que falta") e (ii) o **Product Backlog** ordenado por valor, onde cada item de backlog referencia um gap do diagnóstico. Mapa de cobertura:

| Exigência do enunciado (PDF) | Onde é atendida | Status |
|---|---|---|
| §1.2 Comp. 1 — Diagnóstico com 4 dimensões de gap + evidências | §2 (este doc) | ✅ |
| §2.1 Identificação do produto (nome, equipe, links, versão) | §2.1 | ✅ |
| §2.2 Estado atual (Pronto/Parcial/Não iniciado) + tabela-síntese | §2.2 | ✅ |
| §2.3 Análise de gaps nas 4 dimensões | §2.3 | ✅ |
| §2.4 Riscos e impedimentos | §2.4 | ✅ |
| §2.5 Síntese com semáforo (Funciona? Entrega valor? Validado?) | §2.5 | ✅ |
| §1.2 Comp. 2 — Backlog ≥ 20 itens, 3 tipos, colunas exigidas | §3 (auditoria da planilha) | ⚠️ parcial |
| §1.3 Backlog publicado em ferramenta + link no documento | §4 — **GitHub Projects v2 público** (117 itens) | ✅ |
| §1.3 Todos os integrantes responsáveis por ≥ 1 item | §3.2 | ✅ |

**Conclusão do mapeamento:** o Diagnóstico está completo; o Backlog existe e é robusto (107 itens), mas tem **3 pendências que impactam a nota** (tipo Documentação ausente, coluna Evidência vazia, publicação em ferramenta) — detalhadas em §3 e §4.

---

## 1. Evidências-base (links verificáveis)

Todas as afirmações do diagnóstico se apoiam nestas fontes (§1.2 do enunciado: "afirmações sem evidência não serão consideradas"):

| Tipo | Evidência |
|---|---|
| Repositório de código | `github.com/GuiAlvesOliveira/Flui_Contratos` (branch `main`, commit `244f458`) |
| Backend em produção | `https://flui-api-dev.azurewebsites.net` — `GET /health` público retorna `{status:"ok"}` |
| Frontend em produção | Azure Blob Storage `$web` (Static Website) — SPA servida ao vivo |
| CI/CD | `.github/workflows/deploy-backend.yml` e `deploy-frontend.yml` (GitHub Actions, Node 24) |
| Testes automatizados | 12 spec files unitários em `backend/src/**` + `backend/test/guards.e2e-spec.ts` |
| Documentação interna | `README.md`, `fluxo_processo.md`, `DIAGNOSTICO.md`, `PRODUCAO.md`, `roadmap.md`, `MERCADO.md` |
| Backlog (fonte) | `BACKLOG/Sprint0_Product_Backlog.xlsx` + quadro Kanban `BACKLOG/index.html` (data.js) |

> ⚠️ **Ainda faltam evidências de dois tipos exigidos:** (a) **capturas de tela** das telas em produção (login, Kanban, portal do cliente) e (b) **registros de validação com usuários reais**. Anexar prints antes do envio (ver gaps DOC/VAL em §2.3).

---

## 2. Diagnóstico Sintético do MVP (Componente 1)

### 2.1 Identificação do produto

- **Nome:** Flui Contratos.
- **Proposta de valor (uma frase):** _plataforma multi-tenant que organiza, em um Kanban espelhado no funil real de financiamento imobiliário (Cadastro → Análise de Crédito → Análise Jurídica → Vistoria → Contrato → Cartório), toda a operação de uma assessoria, com gate de documentos, trilha de auditoria e notificações automáticas ao cliente._
- **Integrantes e papéis:** Guilherme A. de Oliveira (full-stack, infra/DevOps, backend), João Pedro Lima Paulo (full-stack, backend/QA, frontend).
- **Links:** repositório, ambiente de produção (API + frontend), backlog e protótipo — ver §1. _(Protótipo Figma: colar link se existir.)_
- **Versão avaliada:** commit `244f458`, `main`, 2026-08-25.

### 2.2 Estado atual do MVP

O MVP **roda de ponta a ponta no fluxo principal** (login → criar processo → avançar etapas com gate de documentos → auditoria → webhook n8n → portal do cliente). O grande bloco pendente **não é funcionalidade, é validação com usuários reais e endurecimento de segurança para produção**.

**Bloco A — Funcionalidades implementadas (Pronto, ponta a ponta):** autenticação Supabase + multi-tenant (guards em cadeia), 13 módulos de backend (Users, Processes com máquina de 11 etapas, Documents com upload no Blob, Empreendimentos, Unidades, Participants, Audit, Email, Webhook, Storage, Me, Tenants, Health), 18 páginas de frontend (Login, AppShell, Dashboard, Workflow/Kanban, Empreendimentos, Portal do Cliente, etc.), CI/CD e ambos os ambientes no ar.

**Bloco B — Funcionalidades parciais (existe, mas incompleto/não integrado):** abas do `ProponenteDetailPage` (Cadastro/Ficha/Docs/Atividade — em andamento), `ProponentesPage` global, drag-and-drop no Kanban, busca global e notificações da Topbar (só UI, sem backend), analytics agregados (`GET /dashboard/summary` ainda não existe — o dashboard consome `/processes`), domínio próprio (DNS em propagação).

**Bloco C — Validações realizadas:** **apenas validação técnica automatizada** (12 specs unitários + 1 e2e da cadeia de guards, com gate de cobertura no CI). **Nenhum teste com usuário real (assessoria/analista/cliente) foi conduzido até a data** — esse é o gap de validação mais importante.

#### Tabela-síntese (uma linha por item → gap → ação no backlog)

| Item | Estado | Evidência | Gap identificado | Ação (ID backlog) |
|---|---|---|---|---|
| Autenticação + multi-tenant (isolamento por `tenant_id`) | Pronto | `auth/*`, `common/guards/*`; specs de guards; e2e | Validação de JWT faz round-trip ao Supabase (latência/SPOF) | SEC-03 |
| Segurança de contas (senha inicial, estados de conta) | Parcial | `createAnalista` usa CPF como senha temporária | Risco de sequestro de conta; sem estado `disabled` | SEC-01, SEC-02, INFRA-16 |
| Máquina de estados do processo + gate RN-04 | Pronto | `ProcessesModule`; specs RN-04/RN-05 | — (core validado por testes) | QA-04 |
| Upload/checklist de documentos (Azure Blob) | Pronto | `DocumentsModule`, `AzureStorageService` | UI de upload inline (DocsTab) incompleta | FE-21 |
| Kanban / Workflow | Pronto | `WorkflowPage`, `NovoProcessoDrawer` | Sem drag-and-drop; sem botão "novo processo" inline | FE-24, FE-25 |
| Dashboard analítico | Parcial | `DashboardPage` consome `/processes` | Falta endpoint agregado com conversão/tempo médio | BE-14 |
| Webhooks n8n (RN-08/09) | Parcial | `WebhookService` fire-and-forget | 6 pontos não verificados 1-a-1; sem assinatura HMAC (PII) | BE-15, BE-16 |
| Portal do cliente | Pronto | `ClientePortalPage` | Notificações reais ausentes (só UI) | FE-29 |
| Segredos e CORS de produção | Parcial | Key Vault provisionado; `FRONTEND_URL` | Segredos ainda em app settings; CORS de prod | INFRA-15, INFRA-17 |
| Domínio próprio `fluicontratos.com.br` | Parcial | Config DNS/CDN em andamento | Propagação de DNS pendente | INFRA-14 |
| **Validação com usuários reais** | **Não iniciado** | — (não há registro) | Nenhuma hipótese testada com assessoria/cliente | **VAL-01..05 (a criar)** |
| **Documentação da disciplina** (atas, guia de instalação, registro de decisões) | **Parcial** | `README.md`, `fluxo_processo.md` existem | Sem atas de reunião, sem ADR, sem guia passo-a-passo | **DOC-01..05 (a criar)** |

### 2.3 Análise de gaps — o que falta (4 dimensões)

**A. Produto / funcional**
- Abas do proponente (Cadastro/Ficha/Docs/Atividade/Forms) incompletas → **FE-20, FE-21, FE-22, FE-23**.
- Interações de Kanban (drag-and-drop, criar processo inline, criar cliente pelo empreendimento) → **FE-24, FE-25, FE-26**.
- Recursos "de casca" ainda só na UI: busca global, notificações, breadcrumb → **FE-28, FE-29, FE-30**.
- Analytics agregados e exportação → **BE-14, BE-17**.

**B. Técnico**
- Segurança pré-produção: senha inicial fraca, estado de conta, JWT local → **SEC-01, SEC-02, SEC-03**.
- Endurecimento de produção: CORS, migração versionada de `status`, segredos no Key Vault via managed identity → **INFRA-15, INFRA-16, INFRA-17**.
- Confiabilidade de webhooks (verificação dos 6 pontos + HMAC contra PII) → **BE-15, BE-16**.
- Cobertura de testes existe, mas concentrada em services/guards; faltam testes de integração de webhook e testes de frontend.

**C. Validação** _(dimensão mais fraca hoje)_
- Nenhuma sessão de teste com usuário real (assessoria/analista/cliente) → criar **VAL-01 (teste de usabilidade moderado com 1–2 analistas), VAL-02 (entrevista com dono de assessoria sobre o funil), VAL-03 (teste do portal com um cliente final)**.
- Métricas de uso não instrumentadas (sem analytics de produto/App Insights de negócio) → **VAL-04 (instrumentar eventos-chave)**.
- Hipótese de valor do "gate de documentos" não confrontada com o processo real da assessoria → **VAL-05 (walkthrough do fluxo com especialista)**.

**D. Documentação**
- Existem `README.md` e `fluxo_processo.md`, mas **faltam artefatos exigidos pela disciplina**: **DOC-01 guia de instalação/execução passo-a-passo**, **DOC-02 atas de reunião/sprint**, **DOC-03 registros de decisão (ADR)**, **DOC-04 este diagnóstico publicado/versionado**, **DOC-05 vídeo/roteiro de demonstração do MVP**.

### 2.4 Riscos e impedimentos

| Risco | Prob. | Impacto | Mitigação (→ vira item de backlog) |
|---|---|---|---|
| Falta de acesso a usuários reais para validar | Alta | Alto | Agendar 2–3 sessões via rede de contato/assessoria parceira → **VAL-01/02/03** |
| Vulnerabilidade de conta (senha=CPF) exposta em prod | Média | Crítico | **SEC-01** antes de qualquer usuário real no ambiente |
| Segredos em Application Settings (vazamento) | Média | Alto | **INFRA-17** (Key Vault + managed identity) |
| Webhooks com PII sem assinatura | Média | Alto | **BE-16** (HMAC) |
| Propagação de DNS atrasa demo no domínio | Média | Médio | Usar URL Azure atual como fallback na apresentação → **INFRA-14** |
| Equipe de 2 pessoas / escopo amplo | Alta | Médio | Priorizar por Score e cortar P2/P3 se o prazo apertar |

### 2.5 Síntese do diagnóstico (semáforo)

- **Funciona? 🟢 Verde.** O MVP roda de ponta a ponta no fluxo principal em produção: autenticação, criação e avanço de processo com gate de documentos (RN-04), auditoria (RN-07), webhook n8n e portal do cliente. Coberto por 12 specs unitários + e2e de guards.
- **Entrega valor? 🟡 Amarelo.** A espinha dorsal que resolve o problema central (organizar o funil de financiamento com gate documental) está pronta, mas partes da experiência que sustentam o valor no dia a dia (abas do proponente, analytics agregados, notificações reais) ainda estão parciais.
- **Está validado? 🔴 Vermelho.** Há validação **técnica** (testes automatizados), porém **zero validação com usuários reais**. Não existe evidência de que assessoria/analista/cliente confirmem que problema e solução fazem sentido.

**Três conclusões que definem a ordem do backlog:**
1. **Segurança pré-produção é bloqueante** (SEC-01/02/03, INFRA-15/16/17) — precede qualquer exposição a usuários reais → topo do backlog nas primeiras sprints.
2. **Validação com usuários é o maior gap acadêmico e de produto** — criar itens de tipo *Validação* (VAL-01..05) e alocá-los cedo, em paralelo ao endurecimento técnico.
3. **A camada de produto está madura; falta acabamento e instrumentação** (FE-20..30, BE-14/15/16) — priorizados por Score depois dos bloqueadores.

---

## 3. Auditoria do Product Backlog (a planilha atende o PDF?)

Análise do arquivo `Sprint0_Product_Backlog.xlsx` frente aos requisitos mínimos do enunciado (§1.2 / §3).

### 3.1 O que a planilha JÁ atende ✅

| Requisito do enunciado | Situação na planilha |
|---|---|
| **Mínimo de 20 itens** | ✅ **107 itens** na aba *Product Backlog* |
| Colunas exigidas: tipo, user story/descrição, critérios de aceite, valor, prioridade, story points, status, responsável | ✅ Todas presentes (15 colunas, inclui ainda Impacto no MVP, Dependências, Sprint, Evidência) |
| **Critérios de aceite em todos os itens** | ✅ 107/107 preenchidos |
| **Valor de negócio (1-10) em todos** | ✅ 107/107 preenchidos |
| Story Points em Fibonacci | ✅ Presentes; instruções de calibração na aba *Instruções* |
| Score calculado (ordenação por valor) | ✅ Fórmula viva `=ROUND(Valor/StoryPoints;2)` na coluna Score |
| **Todos os integrantes responsáveis por ≥ 1 item** | ✅ Guilherme (55) e João Pedro (52) |
| Itens críticos nas primeiras sprints | ✅ Sprint 0 = 64, Sprint 1 = 14, Sprint 2 = 9 (críticos concentrados cedo) |
| Dupla classificação Prioridade × Impacto, semáforo, legenda, checklist | ✅ Abas *Legenda*, *Instruções*, *Checklist Sprint 0* completas |

### 3.2 Distribuição atual

- **Por tipo:** Técnica 59 · Produto 43 · Validação 5 · **Documentação 0**
- **Por status:** Concluído 64 · Em andamento 3 · A fazer 20 · Backlog 20
- **Por sprint:** Sprint 0 = 64 · Sprint 1 = 14 · Sprint 2 = 9 · sem sprint (backlog) = 20

### 3.3 Gaps da planilha — o que precisa mudar antes de entregar ❌⚠️

| # | Gap | Gravidade | Correção |
|---|---|---|---|
| **G1** | **Nenhum item do tipo "Documentação".** O enunciado exige explicitamente cobertura dos **três tipos: Produto, Validação e Documentação**. Hoje há Produto, Validação e Técnica — falta Documentação. | 🔴 **Zera critério** (o Checklist da própria planilha lista "itens dos tipos Produto, Validação e Documentação" como obrigatório) | Adicionar **DOC-01..05** (guia de instalação, atas, ADR, diagnóstico publicado, roteiro de demo) — já especificados em §2.3-D |
| **G2** | **Poucos itens de Validação e nenhum com usuário real.** Os 5 itens "Validação" são todos QA automatizado (testes/guards), não experimentos com usuários. | 🟠 Alto (§2.5 aponta validação 🔴) | Adicionar **VAL-01..05** (usabilidade, entrevistas, portal, métricas, walkthrough) — §2.3-C |
| **G3** | **Coluna "Evidência / Link" vazia em 107/107 itens.** As instruções da planilha pedem colar print/commit/ata ao concluir; o enunciado exige evidências. | 🟠 Alto (afeta critério "Ferramenta e histórico") | Preencher ao menos nos 64 itens *Concluído*: link do commit/arquivo, URL do ambiente, print |
| **G4** | **Backlog não está ordenado por Score decrescente.** Está agrupado por área (INFRA→AUTH→BE…). O enunciado e as instruções pedem ordem do maior Score para o menor, respeitando dependências. | 🟡 Médio | Ordenar a aba pela coluna Score (desc), mantendo dependências |
| **G5** | **Rótulo do Score inconsistente:** cabeçalho diz "Score (Valor×Pontos)", mas a fórmula é Valor **÷** Pontos (valor por esforço). | 🟢 Baixo | Corrigir o rótulo para "Score (Valor÷Pontos)" — a fórmula (÷) está correta conceitualmente |
| **G6** | **Backlog ainda não publicado em ferramenta compartilhada** e sem link no diagnóstico. | 🔴 **Zera critério "Ferramenta e compartilhamento" (10%)** | Publicar (ver §4) e colar o link no topo deste documento |

> **Veredito:** a planilha é **forte em estrutura e granularidade**, mas **não atende integralmente o enunciado enquanto G1 e G6 não forem resolvidos** (ambos são obrigatórios e "zeram o componente se ausentes", segundo o próprio Checklist da planilha). G2/G3 elevam a nota; G4/G5 são refinamentos.

### 3.4 Itens novos a adicionar (rascunho pronto para colar na planilha)

| ID | Tipo | Item / User Story | Critério de aceite | Valor | Prior. | SP |
|---|---|---|---|---|---|---|
| DOC-01 | Documentação | Guia de instalação e execução (README passo-a-passo local + produção) | Um novo dev sobe backend+frontend seguindo só o guia | 8 | Alta | 3 |
| DOC-02 | Documentação | Atas de reunião/sprint versionadas em `/docs` | 1 ata por sprint com decisões e responsáveis | 6 | Média | 2 |
| DOC-03 | Documentação | Registros de decisão de arquitetura (ADR) | ≥ 3 ADRs (multi-tenant, auth, storage) | 6 | Média | 3 |
| DOC-04 | Documentação | Diagnóstico do MVP publicado e linkado no backlog | Este documento no repo + link no topo | 9 | Alta | 2 |
| DOC-05 | Documentação | Roteiro + vídeo curto de demonstração do MVP | Vídeo ≤ 5 min cobrindo o fluxo principal | 7 | Média | 3 |
| VAL-01 | Validação | Teste de usabilidade moderado com 1–2 analistas | Roteiro + gravação + lista de achados priorizados | 9 | Alta | 5 |
| VAL-02 | Validação | Entrevista com dono de assessoria sobre o funil | Notas + validação/refutação de 3 hipóteses | 9 | Alta | 3 |
| VAL-03 | Validação | Teste do portal com um cliente final | Cliente conclui upload de doc sem ajuda | 8 | Alta | 3 |
| VAL-04 | Validação | Instrumentar métricas de uso (eventos-chave) | Eventos de login/criação/avanço no App Insights | 7 | Média | 5 |
| VAL-05 | Validação | Walkthrough do gate de documentos com especialista | Checklist de docs validado contra processo real | 7 | Média | 2 |

---

## 4. Publicação do Backlog em ferramenta (Componente 2 — requisito de entrega)

O enunciado (§1.2/§1.3) exige o backlog **publicado em ferramenta visível e compartilhada com o professor, com acesso de leitura, e o link no documento**. Opções ordenadas por praticidade **via CLI**.

### ✅ Opção recomendada — GitHub Projects (via `gh` CLI)

**Viável agora:** o `gh` CLI **já está instalado (v2.93) e autenticado** como `GuiAlvesOliveira`, e o repositório já tem remoto GitHub. Só falta **um scope de token**.

Passo único de habilitação (interativo, abre o navegador — rode você mesmo no terminal com o prefixo `!`):

```bash
gh auth refresh -s project    # concede read:project + project ao token
```

Depois, criação e carga do board por linha de comando:

```bash
# 1) criar o Project (v2) no seu usuário
gh project create --owner GuiAlvesOliveira --title "Flui Contratos — Product Backlog (Sprint 0)"

# 2) descobrir o número do project
gh project list --owner GuiAlvesOliveira

# 3) adicionar itens como rascunho (repetir por item) — exemplo:
gh project item-create <NUM> --owner GuiAlvesOliveira \
  --title "SEC-01 — Senha inicial aleatória" \
  --body "Tipo: Técnica | Valor: 10 | Prioridade: Alta | SP: 2 | Critério: crypto.randomBytes(16)…"

# 4) tornar público (acesso de leitura por link, sem convidar o professor)
gh project edit <NUM> --owner GuiAlvesOliveira --visibility PUBLIC
```

> Campos personalizados (Tipo, Valor, Score, Sprint, Responsável) podem ser criados com `gh project field-create`. Para importar as 107 linhas de uma vez, dá para gerar os comandos `item-create` a partir do `data.js`/xlsx com um script — se quiser, eu preparo esse script de importação em massa.

**Prós:** já autenticado, no mesmo repositório do código (rastreabilidade máxima), CLI first-class, histórico de atualização visível. **Contras:** campos custom via CLI dão trabalho para 107 itens (mitigável com script).

### Alternativa A — Planilha online (menor esforço, 100% aceito pelo enunciado)

O enunciado aceita **"planilha online compartilhada"**. Como a fonte **já é um `.xlsx`**, o caminho mais rápido é subir a planilha existente e compartilhar como leitura:

- **Google Sheets via CLI:** com `rclone` (`rclone copy Sprint0_Product_Backlog.xlsx gdrive:` e converter) ou com a API do Drive (`gcloud`/`curl`). Requer configurar OAuth uma vez.
- **OneDrive/SharePoint via CLI:** `m365 spo file add` (CLI for Microsoft 365) — natural se a conta FECAP for Microsoft.
- Mais simples ainda (não-CLI): upload manual no Google Drive/OneDrive → "compartilhar com link (leitura)". 2 minutos.

**Prós:** zero retrabalho — a planilha já está pronta e é o próprio modelo do professor. **Contras:** compartilhamento por link costuma ser passo manual no navegador.

### Alternativa B — Jira (via CLI)

- CLI da comunidade **`jira` (ankitpokhrel/jira-cli)**: `jira init` (configura site Atlassian + token) e depois `jira issue create -tTask -s"SEC-01 …"`. Importação em massa é possível via CSV nativo do Jira ou script sobre a API REST.
- **Prós:** ferramenta ágil "de verdade", story points/sprints nativos. **Contras:** exige criar site Jira Cloud e configurar API token; overhead maior que GitHub Projects para um TCC.

### Alternativa C — Trello / Notion (via CLI/API)

- **Trello:** sem CLI oficial, mas API REST simples (`curl` com key+token) cria board/listas/cards. Há wrappers como `trello-cli` (npm).
- **Notion:** sem CLI oficial; `curl` na API (integration token) cria uma database e páginas. Há libs não oficiais.
- **Prós:** visual limpo, fácil de compartilhar por link. **Contras:** sem CLI de primeira classe; script sobre API necessário.

### Recomendação final

1. **Rápido e garantido:** subir o `.xlsx` como **planilha online compartilhada** (Alternativa A) e colar o link no topo — resolve **G6** hoje.
2. **Melhor nota/rastreabilidade:** publicar em **GitHub Projects** (opção recomendada), que integra com o repositório onde estão as evidências.
3. Antes de qualquer publicação, **resolver G1 (itens DOC-*) e G2 (itens VAL-*)** com os rascunhos de §3.4 — senão o backlog publicado ainda não cobre os três tipos exigidos.

---

## 5. Checklist de entrega (antes de enviar ao professor)

- [x] G1 — Itens **DOC-01..05** (tipo Documentação) criados no backlog do GitHub _(falta espelhar no `.xlsx` se a planilha também for entregue)_
- [x] G2 — Itens **VAL-01..05** (validação com usuários) criados no backlog do GitHub _(idem `.xlsx`)_
- [x] G6 — **Backlog publicado** em GitHub Projects v2 público + link colado no topo deste documento
- [x] **Ambos os integrantes** como responsáveis (Guilherme e João Pedro) — ✅
- [ ] G3 — Preencher **Evidência/Link** nos itens Concluídos (colar commit/URL no corpo das issues fechadas)
- [ ] G4 — Ordenar o board por **Score** (no Projects: *sort → Score → desc*) e salvar a view
- [ ] G5 — Corrigir rótulo "Score (Valor÷Pontos)" no `.xlsx`
- [ ] Espelhar DOC-*/VAL-* no `.xlsx` **caso** vá entregar a planilha além do board GitHub
- [ ] Anexar **prints** das telas em produção (login, Kanban, portal) ao diagnóstico
- [ ] Exportar este `diagnostico_backlog.md` para **PDF/DOCX** (formato de entrega exige PDF/DOCX)
