# Registros de decisão de arquitetura (ADR)

Cada ADR registra uma decisão técnica relevante: o contexto, o que foi decidido e as consequências. Uma decisão substituída não é apagada: o ADR antigo passa a "Substituído" e aponta para o novo.

| ADR | Decisão | Status |
|---|---|---|
| [0001](0001-multi-tenant-tenant-no-banco.md) | Multi-tenant com isolamento por `tenant_id`, resolvido no banco e nunca no JWT | Aceito |
| [0002](0002-autenticacao-supabase.md) | Autenticação com Supabase Auth e cadeia de guards global na API | Aceito |
| [0003](0003-armazenamento-blob-privado.md) | Documentos em Azure Blob Storage privado, servidos só pela API | Aceito |
| [0004](0004-maquina-de-estados-do-processo.md) | Enum de etapas unificado, com constraint no banco como fonte da verdade | Aceito |
| [0005](0005-gate-de-documentos-na-api.md) | Gate de documentos (RN-04) aplicado na API, não só na interface | Aceito |
| [0006](0006-automacao-n8n-webhooks.md) | Automação desacoplada via n8n, com webhooks *fire-and-forget* | Aceito |
| [0007](0007-migrations-idempotentes.md) | Migrations idempotentes + seed como contrato de "banco recriável" | Aceito |

Modelo para um ADR novo: copie qualquer arquivo desta pasta, numere em sequência e preencha **Contexto**, **Decisão** e **Consequências**.
