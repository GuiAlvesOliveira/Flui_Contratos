# Flui Contratos — Checklist de Produção

> Itens **intencionalmente adiados** enquanto o projeto está em estágio de
> desenvolvimento (sem dados reais). **Devem ser revisados e aplicados antes de
> ir para produção com usuários e dados reais.**
>
> Os demais achados do `DIAGNOSTICO.md` estão sendo corrigidos nos lotes:
> Lote 1 (mass assignment), Lote 2 (guards de auth), Lote 3 (hardening),
> Lote 4 (banco/regras de negócio). Este arquivo lista **só o que fica para o
> deploy real**.
>
> Última atualização: 2026-06-16

---

## 1. Senha inicial previsível — SEC-03 🔴

**Onde:** `backend/src/users/users.service.ts:85` e `:94` (`createAnalista`).

**Hoje:** o analista é criado no Supabase com a senha = dígitos do CPF
(`createUser(dto.email, cpfDigits, ...)`), devolvida em `temporaryPassword`.

**Risco em produção:** CPF não é segredo no Brasil. Com e-mail + CPF, um atacante
pode **logar e trocar a senha antes do próprio usuário** (sequestro de conta). O
Lote 2 já bloqueia o uso da API antes da troca de senha
(`403 PASSWORD_CHANGE_REQUIRED`), o que limita o estrago, mas **não impede o login
inicial nem o sequestro**.

**Ação antes do prod:** gerar senha temporária **aleatória** (ex.:
`crypto.randomBytes(...)` → string alfanumérica) em vez do CPF, mantendo
`mustChangePassword = true` (já forçado no servidor). A entrega não muda — a UI já
exibe `temporaryPassword`; só o valor passa a ser aleatório.

---

## 2. Desativação de conta robusta — SEC-02 🟠

**Onde:** `backend/src/common/guards/tenant.guard.ts` (auto-ativação no login).

**Hoje:** o Lote 2 fez a desativação "grudar" para quem já concluiu o onboarding
(condição `!found.onboardingCompleted` na auto-ativação). Fecha o caso comum —
desligar um funcionário/cliente já ativo.

**Resíduo:** desativar via `PATCH /users/:id/activate {active:false}` um **convidado
que ainda não concluiu o onboarding** não gruda — ele reativa no próximo login.

**Ação antes do prod:** introduzir um estado de conta explícito (ex.: coluna
`status` = `invited | active | disabled`, ou `deactivated_at timestamptz`),
defini-lo em `updateStatus`/`remove` e **nunca** auto-ativar quem está `disabled`.
Requer migração de schema — fazer junto com a adoção de migrações versionadas
(DB-03, Lote 4).

---

## 3. Validação de JWT local / SPOF do Supabase — PERF-01 🟡

**Onde:** `backend/src/auth/supabase.guard.ts:57` (`supabase.auth.getUser(token)`).

**Hoje:** cada requisição faz uma ida de rede ao Supabase para validar o token.
Funciona bem em dev.

**Risco em produção:** latência somada em todo endpoint, ponto único de falha
(Supabase fora → API inteira em 401) e exposição a rate limits do Supabase sob
carga.

**Ação antes do prod:** validar o JWT **localmente** (assinatura + `exp` + `aud`).
⚠️ Conferir o algoritmo do projeto Supabase — se for **assimétrico (RS256/ES256)**,
usar a JWKS pública do Supabase (não o `SUPABASE_JWT_SECRET` HS256). Alternativa
mínima: cachear o resultado de `getUser` por alguns segundos por token.

---

## 4. Cache do TenantGuard ao escalar — PERF-02 🟢

**Onde:** `backend/src/common/guards/tenant.guard.ts` (Map em memória, TTL 60s).

**Hoje:** ok em instância única (caso atual).

**Risco em produção:** ao escalar para múltiplas instâncias do App Service, o cache
não é compartilhado — mudanças de papel/ativação levam até 60s para propagar por
instância. O `Map` também não tem teto de tamanho.

**Ação antes do prod (apenas se escalar horizontalmente):** mover para cache
distribuído (Redis) ou reduzir o TTL; adicionar limite de tamanho ao `Map`.

---

## Verificação rápida antes do deploy real

- [ ] **Senha inicial aleatória** no `createAnalista` (item 1)
- [ ] **Estado de conta explícito** + migração (item 2)
- [ ] **Validação de JWT local** ou cache do `getUser` (item 3)
- [ ] **Cache distribuído**, se houver mais de 1 instância (item 4)
- [ ] Variáveis de ambiente de produção conferidas (`FRONTEND_URL`, segredos no Key Vault)
- [ ] Assinatura HMAC no webhook do n8n (carrega PII — ver REL-01 no `DIAGNOSTICO.md`)
