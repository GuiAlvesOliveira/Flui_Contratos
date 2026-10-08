# ADR 0002 — Autenticação com Supabase Auth e cadeia de guards global

**Status:** Aceito · **Itens:** AUTH-*, SEC-02, SEC-03, QA-02

## Contexto
O sistema precisa de login por e-mail e senha, convite de usuários, troca de senha obrigatória e recuperação de conta, sem que o time mantenha um serviço de identidade próprio.

## Decisão
- O Supabase Auth é o provedor de identidade: o frontend faz o login (`signInWithPassword`) e envia o access token como `Bearer` em cada chamada.
- A API registra uma cadeia global de guards, na ordem: `ThrottlerGuard` (limite de requisições) → `SupabaseGuard` (valida o token) → `TenantGuard` (tenant, papel e estado da conta, ver ADR 0001) → `RolesGuard` (`@Roles`). Rotas abertas usam `@Public()`.
- Contas têm estado explícito `invited | active | disabled`; conta desativada nunca é reativada nem vinculada automaticamente (SEC-02).
- A lista de guards fica num único lugar (`GLOBAL_GUARDS`), usada pelo AppModule e pelo teste e2e da cadeia.

## Consequências
- O `SupabaseGuard` valida o token **localmente** (SEC-03): assinatura pelas chaves públicas do projeto (JWKS, ES256, guardadas em cache por 10 minutos pelo `supabase-js`), expiração, `aud = authenticated` e `iss` do próprio projeto. Isso elimina a ida à rede por requisição e a dependência do Supabase a cada chamada. Token HS256, chave nova fora do cache ou JWKS fora do ar caem na validação pelo servidor (`auth.getUser`), como antes.
- Custo aceito: um logout não invalida o access token na hora (ele vale até expirar, 1 hora no padrão do Supabase). Conta desativada continua barrada na hora, porque o `TenantGuard` confere o estado no banco a cada requisição (SEC-02).
- Papel e tenant nunca vêm do token, então trocar de provedor de identidade não afeta a autorização.
