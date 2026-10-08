# ADR 0001 — Multi-tenant com `tenant_id` resolvido no banco

**Status:** Aceito · **Regras:** RN-01, RN-02

## Contexto
Cada assessoria é um tenant isolado num banco compartilhado. Toda requisição precisa saber o tenant e o papel do usuário. Colocar esses dados no JWT faria qualquer mudança de papel, desativação ou troca de tenant depender da reemissão do token.

## Decisão
- O JWT do Supabase carrega só a identidade (`sub`, `email`).
- O `TenantGuard` resolve `tenant_id`, `role` e o estado da conta no PostgreSQL pelo `external_id`, com cache em memória de 60 s, invalidado por usuário quando o gestor desativa a conta, o perfil muda ou o onboarding termina (AUTH-09).
- Toda tabela de negócio tem `tenant_id`, e toda consulta filtra por ele (isolamento por linha).

## Consequências
- Revogação e mudança de papel valem na requisição seguinte.
- Custo de uma consulta por requisição, mitigado pelo cache; toda chamada autenticada depende da disponibilidade do banco.
- Esquecer o filtro de `tenant_id` numa consulta vaza dados entre assessorias: por isso o isolamento é coberto por testes e pelo item RN-01.
