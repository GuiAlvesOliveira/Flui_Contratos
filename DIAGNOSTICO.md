# Flui Contratos — Diagnóstico de Segurança e Performance

> Auditoria estática (read-only) do código atual em `main`. Nenhum arquivo de
> aplicação foi alterado. Cada achado referencia `arquivo:linha`, classifica a
> severidade, descreve o impacto e propõe uma correção concreta.
>
> Data: 2026-06-10 · Escopo: `backend/`, `frontend/`, `infra/`, `.github/`

---

## 1. Sumário executivo

O projeto está bem estruturado para um TCC: guards globais, isolamento por
`tenant_id` na maioria das queries, uso de `ParseUUIDPipe`, container de blob
privado, SAS nunca exposto ao cliente, e validação por DTO na maior parte dos
endpoints. **Porém existe uma falha crítica de _mass assignment_ que permite
escalonamento de privilégio e quebra do isolamento entre tenants**, além de
alguns problemas sérios de regra de negócio e de confiabilidade.

### Achados por severidade

| ID | Severidade | Título | Área |
|----|-----------|--------|------|
| SEC-01 | 🔴 **Crítico** | _Mass assignment_ em 3 endpoints `PATCH` (escala privilégio, troca de tenant, burla o gate de etapa) | Segurança |
| SEC-02 | 🟠 Alto | Desativação de usuário é revertida automaticamente pelo `TenantGuard` | Segurança |
| SEC-03 | 🟠 Alto | `must_change_password` não é validado no servidor + senha previsível (= CPF) | Segurança |
| BR-01 | 🟠 Alto | `advanceStage` não valida transições e o gate RN-04 é pulado quando não há documentos | Regra de negócio |
| DB-01 | 🟠 Alto | Enum `ProcessStage` (código) diverge do `CHECK` da tabela `processes` (seed) | Banco de dados |
| DB-02 | 🟠 Alto | `seed.sql` falha em banco novo: `ALTER TABLE processes` roda antes do `CREATE TABLE` | Banco de dados |
| PERF-01 | 🟡 Médio | `getUser()` remoto ao Supabase em **toda** requisição (latência + SPOF) | Performance |
| SEC-04 | 🟡 Médio | Sem rate-limiting / sem `helmet` (cabeçalhos de segurança) | Segurança |
| SEC-05 | 🟡 Médio | `DevApiMenu` exposto em produção para o papel `dono` | Segurança |
| SEC-06 | 🟡 Médio | Download de documento sem `X-Content-Type-Options` e MIME confiado do cliente | Segurança |
| OBS-01 | 🟡 Médio | Application Insights provisionado mas **não instrumentado** no código | Observabilidade |
| BR-02 | 🟡 Médio | RN-05 (MIP/DFI obrigatórios) não é forçado | Regra de negócio |
| DB-03 | 🟡 Médio | Sem ferramenta de migração — schema gerido por `seed.sql` editado à mão | Banco de dados |
| REL-01 | 🟡 Médio | Webhook n8n é _fire-and-forget_ sem timeout, retry ou _outbox_ (RN-08/09) | Confiabilidade |
| SEC-07 | 🟢 Baixo | `createBulk` e `audit-logs` aceitam tamanho/paginação ilimitados | Segurança |
| SEC-08 | 🟢 Baixo | `analistaId`/`unidadeId` não validados contra o tenant ao criar/editar processo | Segurança |
| SEC-09 | 🟢 Baixo | Pasta `documents/` não está no `.gitignore` (risco de commitar PII) | Segurança |
| QA-01 | 🟢 Baixo | Cobertura de testes ~nula; logging misto (`console.*` vs `Logger`) | Qualidade |
| PERF-02 | 🟢 Baixo | Cache do `TenantGuard` é por instância (não escala horizontalmente) | Performance |

---

## 2. Segurança

### 🔴 SEC-01 — _Mass assignment_ / escalonamento de privilégio (CRÍTICO)

**Onde:**
- `backend/src/users/users.controller.ts:64` → `users.service.ts:175-199` (`updateProfile`)
- `backend/src/processes/processes.controller.ts:39` → `processes.service.ts:111-124` (`updateFields`)
- `backend/src/empreendimentos/empreendimentos.controller.ts:33` → `empreendimentos.service.ts:40-45` (`update`)

**Causa raiz.** O `ValidationPipe` global (`main.ts:8`) só aplica `whitelist`/validação
quando o tipo do `@Body()` é uma **classe** com metadados do `class-validator`.
Nesses três endpoints o corpo é tipado como tipo inline/genérico
(`Record<string, unknown>`, `Partial<{...}>`), que em runtime vira `Object` — o
pipe **ignora completamente** a validação e o _whitelist_. O corpo cru chega ao
service, que faz `Object.assign(entidade, dto)` (linhas `processes.service.ts:116`,
`empreendimentos.service.ts:43`, `users.service.ts:186`).

**Impacto.** Um usuário autenticado pode injetar campos arbitrários:

- `PATCH /users/{próprioId}/profile` com `{"role":"dono"}` ou `{"tenantId":"<outro-tenant>"}`
  → **um `cliente` vira `dono`** ou se move para outro tenant. Também é possível
  setar `active`, `onboarding_completed`, `external_id`. Isso **quebra o RN-01/RN-02**
  (isolamento total entre tenants) e toda a hierarquia de papéis.
- `PATCH /processes/{id}` com `{"stage":"cartorio"}` → **burla o gate de documentos
  RN-04** (avança a etapa sem passar por `advanceStage`). Também aceita `tenantId`,
  `clientId`, `active`, `mipValue`, etc.
- `PATCH /empreendimentos/{id}` com `{"tenantId":"...","active":true}` → escrita
  cross-tenant de campos.

**Correção.** Criar DTOs com `class-validator` e `forbidNonWhitelisted: true`:

```ts
// update-process.dto.ts
export class UpdateProcessDto {
  @IsOptional() @IsUUID()  analistaId?: string;
  @IsOptional() @IsUUID()  unidadeId?: string;
  @IsOptional() @IsNumber() valorUnidade?: number;
  @IsOptional() @IsNumber() valorEmAberto?: number;
  @IsOptional() @IsNumber() mipValue?: number;
  @IsOptional() @IsNumber() dfiValue?: number;
  @IsOptional() @IsIn(['assalariado','nao_assalariado']) fonteRenda?: string;
  @IsOptional() @IsIn(['casado','solteiro','divorciado']) estadoCivil?: string;
  // NUNCA expor: stage, tenantId, clientId, active
}
```

```ts
// main.ts
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,   // rejeita campos extras com 400
  transform: true,
}));
```

Trocar os `@Body() dto: Record<...>`/`Partial<...>` pelas classes DTO em cada
controller. `stage` deve ser alterado **apenas** por `PATCH /:id/stage`
(`advanceStage`), nunca por `updateFields`.

---

### 🟠 SEC-02 — Desativação de usuário é revertida no próximo login (ALTO)

**Onde:** `backend/src/common/guards/tenant.guard.ts:82-89`

```ts
// Auto-activate on first real login if user accepted the invite but active is still false
if (!found.active && found.externalId) {
  await this.userRepo.update(found.id, { active: true });
  found.active = true;
}
if (!found.active) { throw new ForbiddenException('Usuário inativo'); }
```

**Impacto.** A condição `!found.active && found.externalId` foi pensada para
auto-ativar convidados, mas também casa com qualquer usuário **que já logou antes
e foi deliberadamente desativado** (`PATCH /users/:id/activate {active:false}`).
Como esse usuário já tem `external_id`, o guard o **reativa automaticamente** na
requisição seguinte. Ou seja: **desligar um ex-funcionário ou conta comprometida
não tem efeito** — ele volta a ficar ativo ao apresentar um token válido.

**Correção.** Distinguir "convite ainda não aceito" de "desativado de propósito".
Ex.: só auto-ativar quando o onboarding ainda não foi concluído, ou usar um campo
de status explícito:

```ts
if (!found.active && found.externalId && !found.onboardingCompleted) {
  // primeiro login pós-convite
  await this.userRepo.update(found.id, { active: true });
  found.active = true;
}
```

---

### 🟠 SEC-03 — Troca de senha obrigatória só no frontend + senha previsível (ALTO)

**Onde:** `backend/src/users/users.service.ts:60-95` (`createAnalista`),
`backend/src/common/guards/tenant.guard.ts` (não bloqueia),
`frontend/src/router/AppRouter.tsx:44` (único ponto de bloqueio).

**Impacto.**
1. O analista é criado com senha = dígitos do CPF (`createUser(dto.email, cpfDigits, ...)`).
   CPF não é segredo forte no Brasil. O e-mail de login é conhecido. Credencial
   inicial previsível.
2. O `implementation_plan.md` previa o `TenantGuard` retornar
   `403 PASSWORD_CHANGE_REQUIRED`, mas **o guard atual não faz isso** — apenas
   evita cachear (`tenant.guard.ts:106`). A obrigatoriedade existe somente como
   redirect no React (`AppRouter.tsx`). Logo, quem fala direto com a API (curl,
   Postman) **autentica com a senha-CPF e usa todos os endpoints do papel sem
   nunca trocar a senha**.

**Correção.** Forçar no servidor. Em um guard global (ou no `TenantGuard`),
bloquear todas as rotas exceto `GET /me` e `PATCH /me/change-password` quando
`mustChangePassword === true`:

```ts
const path = request.route?.path;
if (fullUser.mustChangePassword &&
    !['/me', '/me/change-password'].includes(path)) {
  throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED' });
}
```

---

### 🟡 SEC-04 — Sem rate-limiting e sem cabeçalhos de segurança (MÉDIO)

**Onde:** `backend/src/main.ts` (ausência de `@nestjs/throttler` e `helmet`;
confirmado: nenhuma dependência desse tipo no `package.json`).

**Impacto.** Endpoints como `PATCH /me/change-password`, `POST /users` e os de
download ficam sem proteção contra força bruta/abuso. Faltam cabeçalhos
(`X-Content-Type-Options`, `X-Frame-Options`, HSTS, CSP) — relevante porque a API
serve arquivos inline (ver SEC-06).

**Correção.** Adicionar `helmet` no bootstrap e `@nestjs/throttler` global
(ex.: 100 req/min por IP, limite mais agressivo nos endpoints de senha/convite).

---

### 🟡 SEC-05 — `DevApiMenu` em produção (MÉDIO)

**Onde:** `frontend/src/components/layout/AppShell.tsx:393` e
`frontend/src/pages/KanbanPage.tsx:301` → renderizam `<DevApiMenu />` quando
`role === 'dono'`. O próprio arquivo diz "DEV ONLY — remover antes da produção"
(`DevApiMenu.tsx:1`).

**Impacto.** Painel flutuante que dispara chamadas brutas à API (criar usuário,
bulk, trocar senha, reenviar convite) e **exibe `temporaryPassword` (CPF) na tela**.
Não cria vulnerabilidade nova (usa as mesmas APIs autorizadas do `dono`), mas
expõe superfície interna e dados sensíveis no ambiente real.

**Correção.** Renderizar somente em dev: `{import.meta.env.DEV && role === 'dono' && <DevApiMenu />}`,
ou remover o componente antes do deploy final.

---

### 🟡 SEC-06 — Download de documentos: MIME confiado e sem `nosniff` (MÉDIO)

**Onde:** `backend/src/documents/documents.controller.ts:61-77` (download),
`documents.controller.ts:81-87` (`fileFilter`).

**Impacto.** O `fileFilter` valida `file.mimetype`, que é **o Content-Type
informado pelo cliente**, não o conteúdo real. Um arquivo HTML pode ser enviado
como `image/png`, ser aceito, e depois servido `inline`
(`Content-Disposition: inline`, linha 72) sem `X-Content-Type-Options: nosniff`.
Se a API e o frontend compartilharem origem, há risco de XSS armazenado via
_content sniffing_.

**Correção.** Adicionar `res.setHeader('X-Content-Type-Options', 'nosniff')` no
download; usar `Content-Disposition: attachment` para tipos não-imagem; e validar
a _magic number_ do arquivo no upload (ex.: `file-type`) em vez de confiar no
`mimetype` declarado.

---

### 🟢 SEC-07 — Entradas ilimitadas (`bulk`, paginação de auditoria) (BAIXO)

**Onde:** `backend/src/users/users.service.ts:135-147` (`createBulk` itera o array
sem limite), `backend/src/audit/audit.controller.ts:14-17` (`+limit`/`+offset`
sem teto nem validação).

**Impacto.** `POST /users/bulk` com um array enorme dispara N chamadas ao Supabase
em sequência (custo/abuso). `GET /audit-logs?limit=99999999` pode pesar no banco.

**Correção.** Limitar o array (`@ArrayMaxSize`), e aplicar `ParseIntPipe` + teto
(ex.: `Math.min(limit, 100)`) na auditoria.

---

### 🟢 SEC-08 — `analistaId`/`unidadeId` não validados contra o tenant (BAIXO)

**Onde:** `backend/src/processes/processes.service.ts:43-63` (`create` usa
`dto.analistaId`/`dto.unidadeId` direto) e `updateFields`.

**Impacto.** O `clientId` é validado (tenant + role `cliente`, linha 44-47), mas
`analistaId` e `unidadeId` não. Um `dono` poderia associar um processo a um
`analista_id`/`unidade_id` de outro tenant. Baixo (exige papel confiável), mas
fere o RN-01.

**Correção.** Validar que `analistaId` (role analista, mesmo tenant) e `unidadeId`
(mesmo tenant) pertencem ao tenant do chamador antes de salvar.

---

### 🟢 SEC-09 — Pasta `documents/` fora do `.gitignore` (BAIXO)

**Onde:** `git status` mostra `?? documents/`; o `.gitignore` raiz não a ignora.

**Impacto.** Se a pasta guarda uploads locais (PII de clientes — RG, holerite,
extratos), um `git add .` distraído comita documentos sensíveis no histórico.

**Correção.** Adicionar `documents/` ao `.gitignore` raiz (ou confirmar que é
apenas documentação e renomear).

---

### ℹ️ Notas informativas de segurança

- **JWT no `localStorage`** (padrão do Supabase em `supabaseClient.ts`): exposto a
  XSS. Aceitável para o escopo, mas reforça a importância de CSP/`nosniff` (SEC-06).
- **CORS** (`main.ts:9-13`): em produção usa `FRONTEND_URL` exato (bom); o
  _fallback_ regex `localhost` só vale em dev. Sem `credentials: true` — coerente
  com auth via Bearer.
- **Container de blob privado** e **SAS gerado no backend**: corretos. O SDK
  Azure faz _stream_ pelo backend, a URL nunca vaza (`azure-storage.service.ts`).

---

## 3. Regras de negócio / Corretude

### 🟠 BR-01 — `advanceStage` sem máquina de estados e gate RN-04 furado (ALTO)

**Onde:** `backend/src/processes/processes.service.ts:126-202`;
`process.entity.ts:41-53` define `ALLOWED_TRANSITIONS` **que nunca é usado**.

**Dois problemas:**

1. **Transições não validadas.** O service só checa o gate de documentos e os
   motivos obrigatórios; não consulta `ALLOWED_TRANSITIONS`. Um `dono`/`analista`
   pode pular de `inicial` direto para `cartorio`/`assinatura`. (E, via SEC-01,
   qualquer um burla até isso escrevendo `stage` direto.)

2. **Gate RN-04 pulado sem documentos.** Em `processes.service.ts:156`:
   ```ts
   if (Number(counts.total) > 0 && Number(counts.pending) > 0) { ...bloqueia... }
   ```
   Se o checklist nunca foi inicializado (`total === 0`), o gate é **no-op** e o
   processo avança livremente. Como `initChecklist` só roda quando `fonteRenda` é
   definido (`updateFields`, linha 119-121), é trivial ter `total = 0`. **RN-04
   ("não avança sem documentos obrigatórios validados") não é garantido.**

**Correção.**
- Validar `ALLOWED_TRANSITIONS[fromStage].includes(dto.toStage)` no início de
  `advanceStage`; senão `422`.
- Tornar o gate _fail-closed_: nas etapas que exigem documentos, exigir que o
  checklist exista **e** esteja todo validado (tratar `total === 0` como
  pendência, não como liberação).

---

### 🟠 DB-01 — Enum de etapas do código diverge do `CHECK` do banco (ALTO)

**Onde:** `backend/src/processes/process.entity.ts:14-25` vs `infra/db/seed.sql:71-76`.

| Fonte | Valores de `stage` |
|-------|--------------------|
| Entidade (`ProcessStage`) | `inicial, cadastro, analise_credito, credito_aprovado, analise_juridica, juridico_aprovado, cartorio, assinatura, cliente_inativo, credito_recusado, processo_pendencia` |
| `CHECK` no `seed.sql` | `inicial, cliente_ativo, cliente_inativo, aprovado, em_analise_banco, credito_recusado, processo_pendencia, aguardando_assinatura, em_emissao, juridico` |
| `fluxo_processo.md` | ainda outro conjunto (`cliente_ativo`, `em_analise_banco`, ...) |

Só coincidem `inicial`, `cliente_inativo`, `credito_recusado`, `processo_pendencia`.
**Avançar para `cadastro`, `analise_credito`, `credito_aprovado`, `analise_juridica`,
`juridico_aprovado`, `cartorio` ou `assinatura` viola o `CHECK` da tabela** e
estoura erro `23514` no Postgres — a menos que o banco em produção tenha sido
alterado manualmente (caso em que o `seed.sql` está desatualizado e enganoso).

**Correção.** Eleger **uma** fonte da verdade para os estágios (recomendo o enum
da entidade, que é o que o Kanban usa hoje), reescrever o `CHECK` para batê-lo, e
atualizar `fluxo_processo.md`. Idealmente via migração versionada (DB-03).

---

### 🟠 DB-02 — `seed.sql` quebra em banco novo (ordem das instruções) (ALTO)

**Onde:** `infra/db/seed.sql:69-105`. Os `ALTER TABLE processes ...` (linhas
69-88) aparecem **antes** do `CREATE TABLE IF NOT EXISTS processes` (linha 90).

**Impacto.** Em um banco realmente vazio, a linha 70
(`ALTER TABLE processes DROP CONSTRAINT IF EXISTS ...`) falha com
`relation "processes" does not exist`. O script só funciona hoje porque a tabela
já existia de uma versão anterior. Isso **contradiz o critério "psql executa
seed.sql sem erros"** (Phase 1) e o comentário "Safe to re-run" no topo do arquivo.
Além disso, o `CREATE TABLE processes` (linha 95-99) recria o `CHECK` com os
**estágios antigos** (`cadastro, vistoria, contrato...`), reforçando o DB-01.

**Correção.** Reordenar: criar todas as tabelas-base primeiro, depois rodar os
`ALTER`/migrações idempotentes. Melhor ainda, migrar para TypeORM migrations
(DB-03) e aposentar o `seed.sql` como gestor de schema.

---

### 🟡 BR-02 — RN-05 (MIP/DFI obrigatórios) não é forçado (MÉDIO)

**Onde:** `process.entity.ts:75-79` (`mipValue`/`dfiValue` nullable),
`seed.sql:100-101` (colunas nullable), `create-process.dto.ts` (não pede MIP/DFI).

**Impacto.** O RN-05 diz "todo financiamento deve incluir MIP e DFI", mas nada
impede um processo de chegar a `assinatura`/`cartorio` com esses campos nulos.

**Correção.** Exigir MIP/DFI como pré-condição (gate) para entrar nas etapas
finais, ou torná-los obrigatórios no momento adequado do fluxo.

---

### 🟡 DB-03 — Schema gerido por `seed.sql` editado à mão (MÉDIO)

**Onde:** `infra/db/`, `app.module.ts:46` (`synchronize: false`, correto).

**Impacto.** Sem migrações versionadas (TypeORM tem suporte nativo), cada mudança
de schema é um `ALTER ... IF NOT EXISTS` empilhado no `seed.sql`. Isso gera drift
(DB-01), ordem frágil (DB-02) e dificulta rollback/reprodutibilidade — exatamente
o tipo de coisa que um avaliador de TCC nota.

**Correção.** Adotar `typeorm migration:generate`/`migration:run`; manter o
`seed.sql` só para dados de _seed_, não para DDL.

---

### 🟢 Observação — RN-06 (composição de renda) parcialmente implementado

A tabela `process_participants` e o `ParticipantsService` existem, mas **não há
cálculo da soma das rendas** no backend (nenhum endpoint agrega `declared_income`).
O RN-06 ("renda = soma de todos os participantes") fica a cargo do frontend.
Considere expor a soma calculada no servidor para garantir consistência.

---

## 4. Performance e escalabilidade

### 🟡 PERF-01 — `getUser()` remoto ao Supabase em toda requisição (MÉDIO)

**Onde:** `backend/src/auth/supabase.guard.ts:57`
(`await this.supabase.auth.getUser(token)`).

**Impacto.** Cada chamada à API faz **uma ida e volta de rede ao servidor de auth
do Supabase** para validar o token. Consequências: latência somada em todo
endpoint, ponto único de falha (Supabase fora → API toda em `401`), e exposição a
_rate limits_ do Supabase sob carga. Note que o `CLAUDE.md` descreve "valida JWT
via `SUPABASE_JWT_SECRET` (HS256)" — verificação **local** — mas o código faz a
verificação **remota**. As dependências para validar localmente já existem
(`@nestjs/jwt`, `SUPABASE_JWT_SECRET` no `.env`).

**Correção.** Validar o JWT **localmente** (assinatura + `exp` + `aud`) com a
chave do Supabase, sem chamada de rede. Se preferir manter `getUser()`, ao menos
cachear o resultado por alguns segundos por token (como o `TenantGuard` já faz com
o lookup de tenant).

---

### 🟢 PERF-02 — Cache do `TenantGuard` é por instância (BAIXO)

**Onde:** `backend/src/common/guards/tenant.guard.ts:17-21`
(`Map` em memória, TTL 60s).

**Impacto.** Funciona bem em instância única (o caso do TCC). Ao escalar para
múltiplas instâncias do App Service, o cache não é compartilhado e mudanças de
papel/ativação levam até 60s para propagar por instância. Sem teto de tamanho no
`Map` (limpeza só por expiração na requisição seguinte) — vazamento de memória
teórico sob muitos usuários distintos.

**Correção.** Aceitável agora; se escalar, mover para cache distribuído (Redis) ou
reduzir o TTL. Hoje, basta documentar o trade-off.

---

### 🟢 REL-01 — Webhook n8n sem garantia de entrega (MÉDIO p/ a regra, baixo técnico)

**Onde:** `backend/src/common/services/webhook.service.ts:13-25`.

**Impacto.** `fireAndForget` faz um único `fetch` sem `timeout`, sem retry e sem
persistência. Se o n8n estiver fora, a notificação (RN-08/09 — "deve ser
confiável") é **silenciosamente perdida** (só um `logger.warn`). Sem `timeout`, um
n8n lento pode segurar sockets.

**Correção.** Adicionar `AbortController` com timeout; padrão _outbox_ (gravar o
evento numa tabela e reprocessar) se a confiabilidade for requisito real;
assinar o payload (HMAC) já que ele carrega PII (e-mail/telefone do cliente).

---

## 5. CI/CD e infraestrutura

Pontos **positivos**: deploy backend via `WEBSITE_RUN_FROM_PACKAGE` com SAS,
storage com `allow-blob-public-access false` e `min-tls-version TLS1_2`,
PostgreSQL com `public-access none`, soft-delete 30 dias no blob, segredos em
GitHub Secrets e Key Vault. Bom para um TCC.

Pontos de atenção (baixo):

- **`deploy-backend.yml:63`** — SAS de **1 ano** para o pacote de deploy. Como é
  regravado a cada deploy, o blob fica acessível por quem tiver a URL por muito
  tempo. Reduzir a validade (ex.: 7 dias) já que o `appsetting` é atualizado a
  cada push.
- **Runtime divergente** — `provision.sh:40` cria o Web App com `NODE:22-lts`, mas
  o workflow e o `CLAUDE.md` usam Node 20. Alinhar para evitar surpresas de
  runtime.
- **`OBS-01` (Application Insights)** — `provision.sh:218-223` injeta
  `APPLICATIONINSIGHTS_CONNECTION_STRING`, mas o backend **não importa o SDK
  `applicationinsights`** (ausente do `package.json`) nem o inicializa em
  `main.ts`. Resultado: telemetria custom/rastreamento distribuído não são
  coletados — só o pouco que o App Service captura sozinho. Para "Monitoring:
  Application Insights" valer, adicionar o SDK e `appInsights.setup().start()` no
  topo do `main.ts`.

---

## 6. Qualidade de código e observabilidade

- **QA-01 — Testes.** Só existe o `app.e2e-spec.ts` de scaffold; `npm run test`
  praticamente não cobre nada. Para o TCC, valeria ao menos testar os guards
  (isolamento de tenant), o gate RN-04 e a hierarquia de criação de usuários — são
  justamente as partes críticas.
- **Logging misto.** Convivem `console.error`/`console.warn`
  (`users.service.ts:89,126,236`) e o `Logger` do Nest. Padronizar no `Logger`
  (integra com o App Insights quando instrumentado).
- **Pinos de versão suspeitos no frontend** (`frontend/package.json`):
  `typescript ~6.0.2`, `eslint ^10`, `vite ^8`, `@eslint/js ^10` são versões
  muito à frente do convencional — confirmar que resolvem e travar versões
  conhecidas (evita _build_ quebrado no CI).
- **`me.service.completeOnboarding`** confia em `dto` validado (bom), mas o
  `updateProfile` de `users` permite que `analista`/`dono` editem o perfil de
  **qualquer** usuário do tenant (inclusive o do `dono`). Após corrigir o SEC-01,
  restrinja também os campos e o alvo (autorização horizontal).

---

## 7. Conformidade com as Regras de Negócio

| Regra | Situação | Observação |
|-------|----------|------------|
| RN-01/02 Isolamento de tenant | ⚠️ **Comprometido** | Queries filtram por `tenant_id`, **mas** SEC-01 permite trocar `tenant_id`/`role` via _mass assignment_ |
| RN-04 Gate de documentos | ⚠️ **Não garantido** | BR-01: gate pulado quando `total = 0`; e SEC-01 permite escrever `stage` direto |
| RN-05 MIP/DFI obrigatórios | ❌ Não forçado | BR-02: colunas nullable, sem gate |
| RN-06 Composição de renda | 🟡 Parcial | Participantes existem; soma não é calculada no backend |
| RN-07 Trilha de auditoria | ✅ Implementado | `audit_logs` gravado em `advanceStage`/upload/profile; bom |
| RN-08/09 Webhook n8n | 🟡 Frágil | REL-01: _fire-and-forget_ sem retry/timeout/assinatura |

---

## 8. Plano de ação priorizado

**Quick wins de segurança (fazer primeiro):**
1. **SEC-01** — DTOs + `forbidNonWhitelisted: true` nos 3 `PATCH`; remover `stage`
   do `updateFields`. _(corrige a falha crítica e restaura RN-01/02 e RN-04)_
2. **SEC-02** — Ajustar a condição de auto-ativação no `TenantGuard`.
3. **SEC-03** — Bloquear rotas no servidor quando `mustChangePassword === true`.
4. **SEC-05** — Esconder `DevApiMenu` fora de `import.meta.env.DEV`.

**Corretude / dados:**
5. **DB-01 + DB-02** — Unificar os estágios e corrigir a ordem do `seed.sql`.
6. **BR-01** — Validar `ALLOWED_TRANSITIONS` e tornar o gate RN-04 _fail-closed_.
7. **BR-02** — Forçar MIP/DFI no ponto certo do fluxo.

**Robustez / produção:**
8. **PERF-01** — Verificação local de JWT (ou cache do `getUser`).
9. **SEC-04** — `helmet` + `@nestjs/throttler`.
10. **OBS-01** — Instrumentar o Application Insights no código.
11. **REL-01** — Timeout + retry/outbox + assinatura no webhook.
12. **DB-03 / QA-01** — Migrações versionadas e testes dos guards/gates.

---

*Diagnóstico gerado por análise estática read-only. Nenhuma alteração foi feita no
código da aplicação. As linhas citadas referem-se ao estado de `main` na data
acima.*
