# Flui Contratos — Backlog Ágil

> Kanban de desenvolvimento organizado por status. Atualizar ao mover itens entre colunas.
> Última atualização: 2026-08-18

---

## Legenda

| Símbolo | Significado |
|---|---|
| 🔴 P0 | Crítico — bloqueia entrega ou dados reais |
| 🟠 P1 | Alto — necessário para MVP funcional |
| 🟡 P2 | Médio — melhoria relevante de produto |
| 🟢 P3 | Baixo — nice-to-have, backlog longo prazo |
| XS / S / M / L / XL | Estimativa de esforço relativo |

---

## ✅ CONCLUÍDO

### Infraestrutura & DevOps

| ID | Item | Prioridade | Tamanho |
|---|---|---|---|
| INFRA-01 | Monorepo estruturado (backend + frontend + infra) | 🔴 P0 | S |
| INFRA-02 | Docker Compose local (PostgreSQL 16, n8n, Azurite) | 🔴 P0 | S |
| INFRA-03 | `seed.sql` idempotente com tenant, usuários e processo de dev | 🔴 P0 | S |
| INFRA-04 | Azure provisionado via `provision.sh` (App Service B1, Blob, PostgreSQL, Key Vault, Application Insights) | 🔴 P0 | M |
| INFRA-05 | CI/CD GitHub Actions — deploy backend (test → build → upload zip) | 🟠 P1 | M |
| INFRA-06 | CI/CD GitHub Actions — deploy frontend (build → sync `$web` Blob) | 🟠 P1 | M |
| INFRA-07 | Backend ao vivo em `flui-api-dev.azurewebsites.net` | 🔴 P0 | S |
| INFRA-08 | Frontend ao vivo via Azure Blob Storage (`$web`) | 🔴 P0 | S |
| INFRA-09 | TypeORM Migrations: `InitialSchema` + `UnifyProcessStages` | 🔴 P0 | M |
| INFRA-10 | `migrationsRun: true` no boot (instância única) | 🟠 P1 | XS |
| INFRA-11 | Throttling global 300 req/min por IP (ThrottlerGuard) | 🟠 P1 | XS |
| INFRA-12 | CORS configurado (`FRONTEND_URL` env var) | 🔴 P0 | XS |
| INFRA-13 | CI com Node 24 e gate de cobertura de testes | 🟠 P1 | S |

### Autenticação & Autorização

| ID | Item | Prioridade | Tamanho |
|---|---|---|---|
| AUTH-01 | SupabaseGuard global (valida JWT HS256 via `SUPABASE_JWT_SECRET`) | 🔴 P0 | M |
| AUTH-02 | TenantGuard global (resolve `tenantId` + `role` do DB por `external_id`) | 🔴 P0 | M |
| AUTH-03 | RolesGuard com `@Roles()` decorator | 🔴 P0 | S |
| AUTH-04 | `@Public()` decorator (bypass auth em rotas públicas) | 🔴 P0 | XS |
| AUTH-05 | `@PasswordChangeExempt()` decorator (bypass check de senha temporária) | 🟠 P1 | XS |
| AUTH-06 | Fluxo de convite: geração de link Supabase + e-mail via Brevo | 🟠 P1 | M |
| AUTH-07 | `mustChangePassword` flag — força troca de senha no primeiro login | 🟠 P1 | S |
| AUTH-08 | `onboardingCompleted` flag — garante onboarding antes de acessar o sistema | 🟠 P1 | S |
| AUTH-09 | Cache in-memory 60s no TenantGuard (evita query a cada requisição) | 🟡 P2 | XS |

### Backend — Módulos e Regras de Negócio

| ID | Item | Prioridade | Tamanho |
|---|---|---|---|
| BE-01 | `UsersModule` — CRUD, hierarquia (dono cria analista, não admin), bulk import CSV | 🔴 P0 | L |
| BE-02 | `ProcessesModule` — máquina de estados 11 etapas, advance com gate RN-04 | 🔴 P0 | XL |
| BE-03 | `DocumentsModule` — checklist init, upload Azure Blob (PDF/JPEG/PNG ≤ 20 MB), validate, download | 🔴 P0 | L |
| BE-04 | `EmpreendimentosModule` — CRUD projetos imobiliários | 🟠 P1 | M |
| BE-05 | `UnidadesModule` — CRUD unidades por empreendimento | 🟠 P1 | S |
| BE-06 | `ParticipantsModule` — CRUD co-proponentes + composição de renda (RN-06) | 🟠 P1 | M |
| BE-07 | `AuditModule` — listagem de logs + undo de operação (dono only) | 🟠 P1 | M |
| BE-08 | `EmailModule` — envio via Brevo SMTP (convite, notificações) | 🟠 P1 | S |
| BE-09 | `WebhookService` — disparo fire-and-forget para n8n (RN-08/09) | 🔴 P0 | S |
| BE-10 | `AzureStorageService` — upload/download de documentos no Blob | 🔴 P0 | M |
| BE-11 | `MeModule` — profile, change password, onboarding completion | 🔴 P0 | S |
| BE-12 | `TenantsModule` — criação de tenant (super admin only) | 🟠 P1 | S |
| BE-13 | `HealthModule` — `GET /health` público | 🔴 P0 | XS |
| RN-01 | Isolamento total de dados por `tenant_id` (nunca vazar entre tenants) | 🔴 P0 | M |
| RN-04 | Gate na API: processo não avança sem documentos obrigatórios validados | 🔴 P0 | M |
| RN-05 | Campos MIP e DFI obrigatórios em todo processo | 🟠 P1 | S |
| RN-06 | Renda total = soma dos declarados de todos os participantes | 🟠 P1 | S |
| RN-07 | Audit trail: toda mudança de status logada (ator, anterior, novo, timestamp) | 🔴 P0 | M |
| RN-08 | Webhook n8n disparado em toda transição de etapa | 🟠 P1 | S |

### Frontend — Páginas e Componentes

| ID | Item | Prioridade | Tamanho |
|---|---|---|---|
| FE-01 | `LoginPage` — formulário Supabase `signInWithPassword` | 🔴 P0 | S |
| FE-02 | `SetPasswordPage` — fluxo de convite (hash Supabase no URL) | 🟠 P1 | S |
| FE-03 | `ChangePasswordPage` — troca forçada de senha temporária | 🟠 P1 | S |
| FE-04 | `AnalistaOnboardingPage` — onboarding guiado para analistas | 🟠 P1 | M |
| FE-05 | `ClienteOnboardingPage` — onboarding guiado para clientes | 🟠 P1 | M |
| FE-06 | `AppShell` — sidebar + topbar + menu por role + logout | 🔴 P0 | L |
| FE-07 | Design System (`src/styles/design.css`) — tokens CSS, ds-* classes, Geist font | 🔴 P0 | M |
| FE-08 | `DashboardPage` — KPIs, PhaseRow, analytics por etapa, valor médio de unidade | 🟠 P1 | L |
| FE-09 | `WorkflowPage` — Kanban board com swimlanes, AdvanceDrawer, StageSummaryBar | 🔴 P0 | XL |
| FE-10 | `EmpreendimentosPage` — lista com segment control (grid/list) e filtros | 🟠 P1 | M |
| FE-11 | `EmpreendimentoDetailPage` — 3 tabs (Workflow filtrado, Unidades, Informações) | 🟠 P1 | L |
| FE-12 | `ProponenteDetailPage` — 4 tabs (Workflow, Cadastro, Documentos/checklist, Atividade) | 🟠 P1 | L |
| FE-13 | `ClientePortalPage` — lista de processos do cliente autenticado | 🔴 P0 | M |
| FE-14 | `LogsPage` — viewer de audit logs (dono only) | 🟠 P1 | S |
| FE-15 | `NovoProcessoDrawer` — criação e avanço de processo com restrição de transições | 🔴 P0 | L |
| FE-16 | `NovoEmpreendimentoWizard` — wizard multi-step de criação de empreendimento | 🟠 P1 | M |
| FE-17 | `axiosInstance.ts` — injeção automática de Bearer token em cada request | 🔴 P0 | XS |
| FE-18 | `AppRouter.tsx` — roteamento por role com redirect automático e `<Forbidden />` | 🔴 P0 | M |

### Qualidade & Testes

| ID | Item | Prioridade | Tamanho |
|---|---|---|---|
| QA-01 | Testes unitários: 12+ spec files (services, guards, webhook) | 🟠 P1 | XL |
| QA-02 | Testes e2e da cadeia completa de guards (SupabaseGuard → TenantGuard → RolesGuard) | 🟠 P1 | M |
| QA-03 | Gate de cobertura de testes no CI (cobertura mínima obrigatória no pipeline) | 🟠 P1 | S |
| QA-04 | Testes unitários: RN-04 gate de documentos + RN-05 MIP/DFI | 🔴 P0 | M |
| QA-05 | Testes unitários: hierarquia de criação de usuários | 🟠 P1 | S |

---

## 🔄 EM ANDAMENTO

| ID | Item | Responsável | Prioridade | Tamanho | Bloqueio |
|---|---|---|---|---|---|
| INFRA-14 | Configuração de domínio próprio `fluicontratos.com.br` (Azure Static Web App / CDN) | Gui | 🟠 P1 | S | DNS propagation |
| FE-19 | `ProponentesPage` global — lista completa de proponentes com filtros e busca | Gui | 🟠 P1 | M | — |
| FE-20 | Completar tabs do `ProponenteDetailPage`: `CadastroTab` (dados pessoais editáveis) + `FichaTab` (ficha cadastral completa) | Gui | 🟠 P1 | M | — |

---

## 📋 A FAZER

> Itens refinados, priorizados e prontos para serem iniciados.

### Segurança (pré-produção)

| ID | Item | Prioridade | Tamanho | Critério de Aceite |
|---|---|---|---|---|
| SEC-04 | **URGENTE** Revogar EXECUTE público na função `rls_auto_enable()` — qualquer `anon` pode chamá-la via `/rest/v1/rpc/rls_auto_enable` como SECURITY DEFINER | 🔴 P0 | XS | `REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;` aplicado; advisor Supabase não reporta mais o warning |
| SEC-01 | Senha inicial aleatória no `createAnalista` — substituir CPF por `crypto.randomBytes()` | 🔴 P0 | XS | Senha gerada com ≥ 12 chars alfanuméricos; `temporaryPassword` retornado na resposta para exibição na UI |
| SEC-02 | Estado de conta explícito: coluna `status` (`invited \| active \| disabled`) na tabela `users` + migração | 🔴 P0 | M | `disabled` nunca é auto-ativado no TenantGuard mesmo sem `onboardingCompleted`; requer migração TypeORM versionada |
| SEC-03 | Validação JWT local (verificar assinatura + `exp` + `aud` sem round-trip ao Supabase) | 🟠 P1 | M | `GET /health` e `GET /me` não fazem chamada de rede ao Supabase; latência do auth < 5 ms por request |

### Frontend — Funcionalidades Pendentes

| ID | Item | Prioridade | Tamanho | Critério de Aceite |
|---|---|---|---|---|
| FE-21 | `DocsTab` completo no `ProponenteDetailPage` — DocRow com upload inline, status de validação e download | 🟠 P1 | M | Analista faz upload; ícone muda para ✅ após validar; cliente vê status dos próprios docs |
| FE-22 | `AtividadeTab` no `ProponenteDetailPage` — timeline de eventos de audit log do processo | 🟡 P2 | S | Cada evento exibe ator, etapa anterior/nova, timestamp formatado em pt-BR |
| FE-23 | `FormsTab` no `ProponenteDetailPage` — formulários DPS e Financiamento (disponíveis apenas após `em_analise_banco`) | 🟡 P2 | M | Tab aparece somente a partir do status `em_analise_banco`; formulário salvo como documento no checklist |
| FE-24 | Drag-and-drop no Kanban (`WorkflowPage` + `EmpreendimentoDetailPage`) | 🟡 P2 | M | Card pode ser arrastado para coluna seguinte válida; gate RN-04 bloqueia com toast de erro se docs pendentes |
| FE-25 | Botão "Novo processo" (`.kb-add`) inline nas colunas do Kanban | 🟡 P2 | S | Abre `NovoProcessoDrawer` pré-preenchido com a etapa da coluna |
| FE-26 | `NewClienteDrawer` — criar processo a partir da tela de detalhe do empreendimento | 🟠 P1 | M | Processo criado vinculado à unidade e ao empreendimento; aparece imediatamente na aba Workflow |
| FE-27 | `TeamRow` no `EmpreendimentoDetailPage` — lista de analistas vinculados ao empreendimento | 🟡 P2 | S | Exibe avatar, nome e role; dono pode atribuir/remover analistas |
| FE-28 | Back-navigation funcional no Topbar (breadcrumb com link clicável) | 🟡 P2 | XS | Clique no crumb navega para o nível correto; histórico de breadcrumb atualiza com a rota atual |
| FE-29 | Painel de notificações real no Topbar (bell icon) | 🟢 P3 | M | Notificações de mudança de etapa e pendências de documentos; badge com contagem; mark-as-read |
| FE-30 | Busca global funcional na Topbar | 🟢 P3 | L | Busca por nome de proponente, empreendimento ou processo; resultado aparece em dropdown com link direto |

### Backend — Endpoints e Integrações Pendentes

| ID | Item | Prioridade | Tamanho | Critério de Aceite |
|---|---|---|---|---|
| BE-14 | Endpoint de analytics agregados `GET /dashboard/summary` — dados por período (default 30 dias) | 🟠 P1 | M | Retorna: processos por etapa, conversão (ativo → aprovado), tempo médio por etapa, valor total de unidades |
| BE-15 | Webhook n8n — 6 pontos obrigatórios mapeados e disparados conforme `fluxo_processo.md` | 🟠 P1 | M | Solicitação de docs, recusa de crédito, análise bancária, alertas duplos de pendência, assinatura, emissão |
| BE-16 | Assinatura HMAC nos webhooks n8n (proteção do payload com PII) | 🟠 P1 | S | Header `X-Flui-Signature: sha256=<hmac>` em todo webhook; n8n valida antes de processar |
| BE-17 | Endpoint de exportação de relatório CSV (`GET /processes/export`) — dono only | 🟡 P2 | M | CSV com todos os processos do tenant; campos: proponente, etapa atual, data de criação, analista, valor da unidade |

### Infraestrutura & Deploy

| ID | Item | Prioridade | Tamanho | Critério de Aceite |
|---|---|---|---|---|
| INFRA-15 | Configurar `FRONTEND_URL` de produção no App Service (CORS para domínio real) | 🔴 P0 | XS | `OPTIONS /me` retorna 200 com origem do domínio de produção |
| INFRA-16 | Migração versionada para coluna `status` (SEC-02) — gerada via TypeORM CLI | 🔴 P0 | S | `npm run typeorm migration:generate` gera o arquivo; `migrationsRun` aplica no boot sem perda de dados |
| INFRA-17 | Segredos de produção no Azure Key Vault (`SUPABASE_JWT_SECRET`, `BREVO_API_KEY`, etc.) | 🔴 P0 | S | App Service usa managed identity para ler o Key Vault; nenhum segredo em variável de ambiente manual |

---

## 📌 BACKLOG

> Itens identificados mas não refinados. Serão movidos para "A Fazer" conforme prioridade do projeto.

### Produto — Funcionalidades Futuras

| ID | Item | Área | Prioridade | Notas |
|---|---|---|---|---|
| PROD-01 | `TarefasPage` — gestão de tarefas por analista e processo | FE + BE | 🟡 P2 | Sem API hoje; definir modelo de dados (tarefa vinculada a processo, dueDate, assignee) |
| PROD-02 | `CalendárioPage` — visualização de tarefas e deadlines por data | FE + BE | 🟢 P3 | Depende de PROD-01; integração com FullCalendar ou similar |
| PROD-03 | `ReleatóriosPage` — relatórios estratégicos para CEO/Dono | FE + BE | 🟡 P2 | Funil de conversão, SLA por etapa, ranking de analistas, ticket médio |
| PROD-04 | `ConfiguraçõesPage` — configuração do tenant (nome, logo, webhooks, equipe) | FE + BE | 🟡 P2 | `PATCH /tenants/me`; upload de logo no Blob Storage |
| PROD-05 | Escalação automática de processos parados — alerta após N dias sem movimento | BE + n8n | 🟡 P2 | `cron` ou job agendado; webhook n8n para analista responsável |
| PROD-06 | Integração com API de CEP (auto-fill de endereço nos formulários) | FE | 🟢 P3 | ViaCEP ou BrasilAPI; sem custo, sem backend necessário |
| PROD-07 | Notificações push no browser (PWA Service Worker) | FE | 🟢 P3 | Requer HTTPS + manifest; substitui dependência de e-mail para alertas rápidos |
| PROD-08 | Wizard de onboarding de novo tenant (auto-serviço) | FE + BE | 🟢 P3 | Habilita crescimento sem operação manual; prioridade alta se escalar além de beta |
| PROD-09 | Tracking de success fee por contrato assinado | BE | 🟡 P2 | Campo `contrato_assinado_em` + valor da comissão (0,5%–1,5%); relatório de receita |
| PROD-10 | `AnalistaDashboard` refinado — métricas de SLA e produtividade individual | FE | 🟡 P2 | Tempo médio de análise, documentos pendentes, processos ativos |
| PROD-11 | Integração com WhatsApp via n8n (alternativa ao SMS) | n8n | 🟢 P3 | Configurável por tenant; templates de mensagem aprovados pelo Meta |
| PROD-12 | Histórico de documentos — versionamento de uploads (substituição sem delete) | BE + FE | 🟡 P2 | Blob com versioning habilitado; UI mostra versão atual e histórico |
| PROD-13 | Pesquisa global full-text (proponentes, empreendimentos, processos) | FE + BE | 🟢 P3 | `pg_trgm` no PostgreSQL; endpoint `GET /search?q=` com paginação |

### Fora do Escopo TCC (Registrado para Evolução Futura)

| ID | Item | Motivo do adiamento |
|---|---|---|
| OOT-01 | Assinatura digital ICP-Brasil | Requer certificadora homologada e custo alto |
| OOT-02 | API bancária real (simulação e upload de docs para bancos) | APIs proprietárias; requer acordo comercial |
| OOT-03 | App mobile React Native | Fora do stack definido; web app cobre o escopo do TCC |
| OOT-04 | Cache distribuído Redis (multi-instância App Service) | Complexidade operacional desnecessária para volume atual |
| OOT-05 | Criptografia AES-256 de documentos em trânsito adicional | Azure Blob já criptografa at-rest; camada extra é opcional |
| OOT-06 | Multi-idioma (i18n pt-BR + en) | Produto brasileiro com usuários pt-BR somente |
| OOT-07 | RabbitMQ / filas de mensagens para webhooks | n8n fire-and-forget suficiente para volume TCC |

---

## Métricas de Progresso

| Área | Total | Concluído | Em Andamento | A Fazer | Backlog |
|---|---|---|---|---|---|
| Infraestrutura & DevOps | 17 | 14 | 0 | 3 | 0 |
| Autenticação & Autorização | 9 | 9 | 0 | 0 | 0 |
| Backend — Módulos | 18 | 18 | 0 | 0 | 0 |
| Regras de Negócio (RN) | 6 | 6 | 0 | 0 | 0 |
| Frontend — Páginas | 18 | 18 | 2 | 10 | 0 |
| Qualidade & Testes | 5 | 5 | 0 | 0 | 0 |
| Segurança (pré-prod) | 3 | 0 | 0 | 3 | 0 |
| Backend — Pendentes | 4 | 0 | 0 | 4 | 0 |
| Produto — Funcionalidades | 13 | 0 | 0 | 0 | 13 |
| **Total** | **93** | **70** | **2** | **20** | **13** |

**Progresso geral: 70 / 93 itens concluídos (75%)**

---

*Método: Kanban com priorização MoSCoW adaptada (P0=Must, P1=Should, P2=Could, P3=Won't for TCC)*
