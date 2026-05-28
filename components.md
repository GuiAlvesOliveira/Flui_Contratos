# Flui Contratos — Mapeamento de Componentes

Documento de rastreamento dos componentes identificados no protótipo HTML e seu status de implementação no frontend React + TypeScript + Tailwind CSS v4.

---

## Sistema de Design (Design Tokens)

| Elemento | Protótipo HTML | Status | Arquivo |
|---|---|---|---|
| CSS Variables (cores, fontes, radii, shadows) | `styles.css :root` | ✅ Implementado | `src/styles/design.css` |
| Classe `.ds-app` (grid layout) | `.app` | ✅ Implementado | `src/styles/design.css` |
| Fonte Geist / Geist Mono | Google Fonts via `index.html` | ✅ Implementado | `index.html` |
| Scrollbar customizado | `styles.css ::-webkit-scrollbar` | ✅ Implementado | `src/styles/design.css` |

---

## Layout / Shell

| Componente | Protótipo HTML | Status | Arquivo | Notas |
|---|---|---|---|---|
| **AppShell** | `App` em `app.jsx` | ✅ Implementado | `src/components/layout/AppShell.tsx` | Sidebar + Topbar + roteamento interno |
| **Sidebar** | `.sidebar`, `.sb-brand`, `.sb-nav`, `.sb-footer` | ✅ Implementado | dentro do `AppShell.tsx` | Incluí logout no footer |
| **Topbar** | `.topbar`, `.crumb`, `.tb-search`, `.tb-icon-btn` | ✅ Implementado | dentro do `AppShell.tsx` | Breadcrumb simples (sem back-nav ainda) |
| **Logo / Brand** | `.sb-logo`, `.sb-brand-name` | ✅ Implementado | dentro do `AppShell.tsx` | |
| **Nav Item** | `.sb-item`, `.sb-section-title` | ✅ Implementado | dentro do `AppShell.tsx` | |
| **User Footer** | `.sb-footer`, `.avatar`, `.sb-user-name` | ✅ Implementado | dentro do `AppShell.tsx` | Com botão logout |
| **Search Bar** | `.tb-search` com kbd shortcut | ✅ Implementado (UI only) | dentro do `AppShell.tsx` | Sem funcionalidade de busca ainda |
| **Notification / Help icons** | `.tb-icon-btn` com `.dot` | ✅ Implementado (UI only) | dentro do `AppShell.tsx` | Sem notificações reais ainda |

---

## Ícones

| Componente | Protótipo HTML | Status | Arquivo |
|---|---|---|---|
| **Icon set** (Lucide-style SVG) | `icons.jsx` | ✅ Implementado | `src/components/icons.tsx` |
| Home, Building, Users, Layout, CheckSquare | `icons.jsx` | ✅ | `src/components/icons.tsx` |
| FileText, Calendar, BarChart, Settings | `icons.jsx` | ✅ | `src/components/icons.tsx` |
| Bell, Search, Plus, ChevronRight, ChevronDown | `icons.jsx` | ✅ | `src/components/icons.tsx` |
| MoreH, ArrowUp, ArrowDown, Filter, Clock | `icons.jsx` | ✅ | `src/components/icons.tsx` |
| AlertTriangle, Info, Check, X | `icons.jsx` | ✅ | `src/components/icons.tsx` |
| Grid, List, TrendingUp, Activity, MapPin | `icons.jsx` | ✅ | `src/components/icons.tsx` |
| Mail, Banknote | `icons.jsx` | ✅ | `src/components/icons.tsx` |
| Pin, Gavel, Building2, Stamp, Paperclip | `icons.jsx` | ⏳ Pendente | — | Pode ser adicionado quando necessário |

---

## Componentes de UI (Primitivos)

| Componente | Protótipo HTML | Status | Arquivo | Notas |
|---|---|---|---|---|
| **KpiCard** | `.kpi`, `.kpi-label`, `.kpi-value`, `.kpi-meta` | ✅ Implementado | `src/pages/DashboardPage.tsx` | Inline no Dashboard |
| **PhaseRow** | `.phase-row`, `.phase-dot`, `.phase-bar`, `.phase-count` | ✅ Implementado | `src/pages/DashboardPage.tsx` | Inline no Dashboard |
| **Badge** | `.badge`, `.badge.green/amber/red/blue/violet/neutral` | ✅ Implementado (classes CSS) | `src/styles/design.css` | Usar via className `ds-badge green` etc. |
| **Button** | `.btn`, `.btn.accent`, `.btn.ghost`, `.btn.sm` | ✅ Implementado (classes CSS) | `src/styles/design.css` | Usar via className `ds-btn` |
| **Card** | `.card`, `.card-hdr`, `.card-body` | ✅ Implementado (classes CSS) | `src/styles/design.css` | Usar via className `ds-card` |
| **Tabs / Tab** | `.tabs`, `.tab`, `.tab.active`, `.tab .count` | ✅ Implementado (classes CSS) | `src/styles/design.css` | Usar via className `ds-tabs`, `ds-tab` |
| **Table** | `.table`, `th`, `td` (estilos) | ✅ Implementado (classes CSS) | `src/styles/design.css` | Usar via className `ds-table` |
| **Input / Field** | `.input`, `.field`, `.field label`, `.section-label` | ✅ Implementado (classes CSS) | `src/styles/design.css` | Usar via className `ds-input`, `ds-field` |
| **Chip** | `.chip`, `.chip.active` | ✅ Implementado (classes CSS) | `src/styles/design.css` | Filtros de lista |
| **Segment Control** | `.seg`, `.seg-btn`, `.seg-btn.active` | ✅ Implementado | `src/pages/EmpreendimentosPage.tsx` | Grid/List toggle |
| **Alert** | `.alert`, `.alert.urgent/warn/info`, `.alert-icon` | ✅ Implementado (classes CSS) | `src/styles/design.css` | |
| **Timeline** | `.timeline`, `.tl-row`, `.tl-time`, `.tl-content` | ✅ Implementado (classes CSS) | `src/styles/design.css` | |
| **ProcRow** (late process) | `.proc-row`, `.pr-title`, `.pr-sub`, `.pr-days` | ✅ Implementado (classes CSS) | `src/styles/design.css` | |
| **Priority Item** | `.pri`, `.pri.hi`, `.pri-rank`, `.pri-title` | ✅ Implementado (classes CSS) | `src/styles/design.css` | |
| **DocRow** | `.doc-row`, `.doc-icon`, `.doc-title`, `.doc-sub` | ✅ Implementado (classes CSS) | `src/styles/design.css` | |
| **KV List** | `.kv` (grid key-value) | ✅ Implementado (classes CSS) | `src/styles/design.css` | |
| **Drawer** | `.drawer`, `.drawer-backdrop`, `.drawer-hdr`, `.drawer-body`, `.drawer-foot` | ✅ Implementado | `src/pages/WorkflowPage.tsx` + CSS | Usado no AdvanceDrawer |
| **Modal** | Overlay + `.card` centrado | ✅ Implementado (classes CSS) | `src/styles/design.css` | `.ds-modal-overlay`, `.ds-modal` |
| **Divider** | `.divider` | ✅ Implementado (classes CSS) | `src/styles/design.css` | |

---

## Páginas

| Página | Protótipo HTML | Status | Arquivo | Dados |
|---|---|---|---|---|
| **Dashboard** | `dashboard.jsx` | ✅ Implementado | `src/pages/DashboardPage.tsx` | Real (API `GET /processes`) |
| **Empreendimentos (lista)** | `empreendimentos.jsx` | ✅ Implementado | `src/pages/EmpreendimentosPage.tsx` | Real (API `GET /empreendimentos`) |
| **Empreendimento (detalhe)** | `empreendimento.jsx` | ✅ Implementado | `src/pages/EmpreendimentoDetailPage.tsx` | 3 tabs: Workflow (kanban filtrado), Unidades, Informações |
| **Workflow (global)** | `cliente.jsx → WorkflowGlobal` | ✅ Implementado | `src/pages/WorkflowPage.tsx` | Real (API `GET /processes`), click no card abre detalhe |
| **Proponente (detalhe)** | `cliente.jsx → ClienteDetail` | ✅ Implementado | `src/pages/ProponenteDetailPage.tsx` | 4 tabs: Workflow, Cadastro, Documentos (checklist), Atividade |
| **Tarefas** | — | ⏳ Pendente | — | Sem API ainda |
| **Calendário** | — | ⏳ Pendente | — | Sem API ainda |
| **Relatórios** | — | ⏳ Pendente | — | Sem API ainda |
| **Configurações** | — | ⏳ Pendente | — | |
| **Proponentes (global)** | `cliente.jsx → WorkflowGlobal` | ⏳ Pendente | — | Lista global de proponentes |

---

## Componentes de Kanban

| Componente | Protótipo HTML | Status | Arquivo | Notas |
|---|---|---|---|---|
| **KanbanColumn** | `.kb-col`, `.kb-hdr`, `.kb-title`, `.kb-count` | ✅ Implementado | `src/pages/WorkflowPage.tsx` | |
| **KanbanCard** | `.kb-card`, `.kb-card-hdr`, `.kb-card-name`, `.kb-card-foot` | ✅ Implementado | `src/pages/WorkflowPage.tsx` | |
| **KanbanCard — Docbar** | `.docbar`, `.pill`, `.pill.ok/.miss` | ✅ Implementado | `src/pages/WorkflowPage.tsx` | Mostra analista + banco |
| **KanbanCard — Progress** | `.kb-progress`, `.kb-avatar` | ✅ Implementado | `src/pages/WorkflowPage.tsx` | Progresso baseado em etapa |
| **Stage Summary Bar** | `.stage-bar`, `.stg`, `.stg-num/.name/.count/.dot` | ✅ Implementado | `src/pages/WorkflowPage.tsx` | |
| **Side Status Banner** | `.side-banner`, `.side-pill` | ✅ Implementado | `src/pages/WorkflowPage.tsx` | |
| **Side Status Cards** | Colunas extras abaixo do kanban | ✅ Implementado | `src/pages/WorkflowPage.tsx` | Toggle mostra/oculta |
| **Drag-and-drop** | `draggable`, `onDragOver`, `onDrop` em `empreendimento.jsx` | ⏳ Pendente | — | A implementar na fase de Empreendimento Detalhe |
| **Add Card Button** | `.kb-add` | ⏳ Pendente | — | Para criar novo processo diretamente no kanban |

---

## Componentes de Formulário / Fluxo

| Componente | Protótipo HTML | Status | Arquivo | Notas |
|---|---|---|---|---|
| **AdvanceDrawer** | Modal em `KanbanPage` → agora Drawer | ✅ Implementado | `src/pages/WorkflowPage.tsx` | Substituiu o modal simples pelo drawer de design |
| **NewClienteDrawer** | `NewClienteDrawer` em `empreendimento.jsx` | ⏳ Pendente | — | Para criar processo a partir do empreendimento |
| **TeamRow** | `TeamRow` em `empreendimento.jsx` | ⏳ Pendente | — | Lista de equipe no detalhe do empreendimento |

---

## Componentes de Detalhe (Cliente/Proponente)

| Componente | Protótipo HTML | Status | Arquivo |
|---|---|---|---|
| **ClienteHero** | `.cli-hero`, `.cli-avatar`, `.cli-summary` | ⏳ Pendente | — |
| **StageProgressBar** | `.cli-stages`, `.cli-stage`, `.cli-stage-node` | ⏳ Pendente | — |
| **WorkflowEventList** | `.wf-event`, `.wf-event-node.done`, `.wf-event-hdr` | ⏳ Pendente | — |
| **IntegrationRow** | `.intg-row` (API banco / N8N / App mobile) | ⏳ Pendente | — |
| **CadastroTab** | `CadastroTab` em `cliente.jsx` | ⏳ Pendente | — |
| **FichaTab** | `FichaTab` em `cliente.jsx` | ⏳ Pendente | — |
| **DocsTab** | `DocsTab` em `cliente.jsx` | ⏳ Pendente | — |
| **FormsTab** | `FormsTab` em `cliente.jsx` | ⏳ Pendente | — |
| **AtividadeTab** | `AtividadeTab` em `cliente.jsx` | ⏳ Pendente | — |

---

## Variações e Reutilizações Previstas

| Componente | Contexto atual | Reutilizações previstas |
|---|---|---|
| **Badge** (`.ds-badge`) | WorkflowPage, DashboardPage, EmpreendimentosPage | Detalhe de cliente, status de documentos, status de integrações |
| **Timeline** | DashboardPage (atualizações recentes) | Detalhe do empreendimento (aba Atividade), detalhe do cliente (aba Atividade) |
| **KV List** (`.ds-kv`) | — (CSS disponível) | Cadastro do cliente, Ficha cadastral, Informações do empreendimento |
| **Drawer** | WorkflowPage (AdvanceDrawer) | NewClienteDrawer, formulários futuros |
| **DocRow** | WorkflowPage (side status cards) | DocsTab no detalhe do cliente |
| **Tabs** | EmpreendimentoDetail, ClienteDetail (protótipo) | Qualquer página com sub-seções |
| **KpiCard** | DashboardPage | Relatórios, detalhe do empreendimento |
| **PhaseRow** | DashboardPage | Relatórios por etapa |
| **Alert** | DashboardPage | Centro de notificações, topbar (painel de alertas) |
| **EmpCard** | EmpreendimentosPage | Dashboard (cards rápidos) |
| **KanbanCard** | WorkflowPage | Empreendimento detalhe (aba Workflow) |
| **StageBar** | WorkflowPage | Empreendimento detalhe, dashboard mini-kanban |
| **AppShell** | Analista e Dono | Mesmo shell para todas as roles autorizadas |

---

## Legenda

- ✅ **Implementado** — Componente implementado e utilizável
- ⏳ **Pendente** — Identificado no protótipo, aguarda implementação
- 🔌 **API pendente** — Componente implementado mas aguarda endpoint no backend

---

*Gerado em: 2026-05-10 | Fase 7 do projeto Flui Contratos*
