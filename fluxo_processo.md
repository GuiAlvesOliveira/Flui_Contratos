# Flui Contratos — Especificação de Fluxo de Processo

Baseado no documento "Especificação Técnica - Sistema de Financiamento Imobiliário".
Este arquivo descreve o fluxo de negócio real e serve como referência para implementação das fases 4–6.

---

## Entidades Principais

### Empreendimento
Representa o projeto imobiliário (condomínio, edifício, loteamento).

| Campo | Tipo | Obrigatório |
|---|---|---|
| Matrícula-mãe | string | Sim |
| Certidão do IPTU | documento | Sim |
| Informações da construtora | text | Sim |
| Endereço completo (rua, número, CEP) | string | Sim |
| Banco financiador da obra | string | Sim |
| Contato da incorporadora | string | Sim |

### Unidade
Unidade vinculada ao empreendimento. Campos preenchidos após recebimento de dados da incorporadora.
- Relacionamento: `Empreendimento 1:N Unidade`

### Cliente (Ficha Cadastral)
Duas etapas de preenchimento:

**Cadastro inicial (dados básicos da incorporadora):**
- Nome completo
- Data de nascimento
- Telefone para contato
- E-mail para contato
- Valor da unidade
- Valor em aberto

**Ficha Cadastral completa (preenchida/conferida pelo analista/cliente):**
- Nome completo
- Data de nascimento
- Fonte de renda
- Endereço
- Composição de renda (sozinho ou compor renda)
- Estado civil (Casado, Solteiro, Divorciado)

---

## Fluxo de Processo Detalhado

### 3.1 Início do Processo
1. Cadastro do empreendimento (matrícula-mãe, IPTU, construtora)
2. Cadastro da unidade no sistema
3. Solicitação à incorporadora das informações básicas dos clientes
4. Cadastro inicial do cliente com informações básicas
5. Primeiro contato com o cliente

### 3.2 Decisão: Cliente Seguirá?

**SIM → Cliente Ativo:**
- Status: `cliente_ativo`
- Prosseguir para Ficha Cadastral

**NÃO → Cliente Inativo:**
- Status: `cliente_inativo`
- Motivo obrigatório (um dos quatro):
  - Quitará por recursos próprios
  - Seguirá com outra assessoria
  - Seguirá sozinho
  - Não atendeu

### 3.3 Ficha Cadastral e Documentação
Após preenchimento completo da Ficha Cadastral, o sistema executa **simultaneamente**:
1. Abertura de cadastro do cliente no app
2. Solicitação automática de documentação via N8N

**Documentos obrigatórios para todos:**
- RG ou CNH
- Comprovante de endereço do último mês
- Comprovante de estado civil ATUALIZADO

**Documentos de fonte de renda:**
| Tipo | Documentos |
|---|---|
| Assalariado | 3 holerites + IRPF |
| Não assalariado | 6 últimos extratos bancários + IRPF |

### 3.4 Simulação de Crédito
- Simulação automática de crédito nos bancos via API bancária
- Resultado positivo → Status: `aprovado`
- Integração: API bancária para simulação automática

### 3.5 Análise Bancária
- Status: `em_analise_banco`
- Sistema disponibiliza automaticamente formulários DPS e Financiamento no app
- **Formulários disponíveis apenas após este status:**
  - DPS (Declaração de Próprio Punho)
  - Financiamento

**Decisão — Aprovado ou Recusado?**

**RECUSADO:**
- Status: `credito_recusado`
- Tentativa de defesa obrigatória com o banco
- Registrar motivos da recusa
- N8N: Notificação automática de recusa ao cliente

**APROVADO:**
- Prosseguir para conferência e upload de documentos

### 3.6 Conferência e Upload de Documentos

**Caminho SIM (analista confere):**
1. Analista realiza conferência completa dos documentos
2. Analista sobe formulários e documentos no sistema do banco

**Caminho NÃO:**
1. Upload direto de formulários e documentos no sistema do banco

Ambos convergem para:
- Aguardar aprovação dos documentos e formulários pelo banco
- N8N: Atualização de status de análise bancária

### 3.7 Verificação de Pendências

**COM pendência:**
- Status: `processo_pendencia`
- N8N dispara alerta para cliente E analista simultaneamente
- Exibição de pendências no app
- Aguardar resolução

**SEM pendência:**
- Status: `em_emissao`
- N8N: Notificação de avanço
- Processo segue para emissão do contrato

### 3.8 Assinatura
- Status: `aguardando_assinatura`

**Assinado:**
- Status: `em_emissao` → Status Final: `juridico`

**Não assinado:**
- Mantém em `aguardando_assinatura`
- N8N: Notificações de solicitação e confirmação de assinatura

---

## Status do Sistema

### Progressão obrigatória

```
inicial
  ├── cliente_ativo
  │     └── aprovado
  │           └── em_analise_banco
  │                 ├── aguardando_assinatura
  │                 │     ├── processo_pendencia → (volta para aguardando_assinatura)
  │                 │     └── em_emissao
  │                 │           └── juridico
  │                 └── credito_recusado
  └── cliente_inativo (terminal — com motivo obrigatório)
```

### Todos os status disponíveis

| Status | Código |
|---|---|
| Cliente Ativo | `cliente_ativo` |
| Cliente Inativo | `cliente_inativo` |
| Aprovado | `aprovado` |
| Em análise do banco | `em_analise_banco` |
| Crédito Recusado | `credito_recusado` |
| Processo com pendência | `processo_pendencia` |
| Aguardando Assinatura | `aguardando_assinatura` |
| Em emissão | `em_emissao` |
| Jurídico | `juridico` |

---

## Integrações Necessárias

### N8N — 6 pontos obrigatórios

| Evento | Trigger |
|---|---|
| Solicitação de documentos | Após preenchimento da Ficha Cadastral |
| Notificação de recusa | Crédito recusado pelo banco |
| Atualização de análise bancária | Status em progresso |
| Alertas de pendências | Disparo duplo: cliente + analista simultaneamente |
| Notificações de assinatura | Solicitação e confirmação |
| Triggers de emissão | Notificação de entrada no jurídico |

**Funcionalidades gerais do N8N:**
- Disparos de e-mail e SMS
- Webhooks para mudanças de status
- Lembretes automáticos
- Escalação de processos parados

### API Bancária (fora do escopo TCC — documentado para referência)
- Simulação automática em múltiplos bancos
- Upload de documentos
- Recebimento de status de aprovação/recusa
- Consulta automática de pendências
- Webhook para mudanças de status bancário

### App Mobile (fora do escopo TCC — web app cobre o escopo)
- Cadastro e login seguro
- Upload de documentos solicitados
- Preenchimento de formulários DPS e Financiamento
- Assinatura digital certificada (ICP-Brasil)
- Acompanhamento de status em tempo real
- Visualização de pendências
- Histórico de interações

---

## Regras de Negócio

| # | Regra | Impacto |
|---|---|---|
| RN-01 | Empreendimento deve existir antes do cadastro de unidades | Validação na criação de Unidade |
| RN-02 | Documentação completa antes da simulação de crédito | Gate antes de `aprovado` |
| RN-03 | Analista deve revisar todos os documentos antes do upload ao banco | Gate antes de `em_analise_banco` |
| RN-04 | Tentativa de defesa obrigatória em caso de recusa bancária | Campo obrigatório em `credito_recusado` |
| RN-05 | Motivo de desistência obrigatório para clientes inativos | Campo obrigatório em `cliente_inativo` |
| RN-06 | Alertas N8N em pendências para cliente E analista simultaneamente | Webhook duplo |
| RN-07 | Formulários DPS e Financiamento só disponíveis após `em_analise_banco` | Gate no app |
| RN-08 | Abertura de app e solicitação de docs ocorrem simultaneamente após Ficha Cadastral | Execução paralela |
| RN-09 | Status não retrocede sem justificativa registrada | Validação na mudança de status |
| RN-10 | Pendências notificam cliente e analista ao mesmo tempo | Webhook duplo via N8N |

---

## Schema de Banco Necessário (extensão do schema atual)

```sql
-- Empreendimento
CREATE TABLE empreendimentos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  matricula_mae     VARCHAR(100) NOT NULL,
  endereco          TEXT NOT NULL,
  cep               VARCHAR(10) NOT NULL,
  banco_financiador VARCHAR(255) NOT NULL,
  construtora_info  TEXT,
  incorporadora_contato VARCHAR(255),
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unidade
CREATE TABLE unidades (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  empreendimento_id   UUID NOT NULL REFERENCES empreendimentos(id),
  identificacao       VARCHAR(100) NOT NULL,  -- ex: "Apto 42 - Torre A"
  valor               DECIMAL(15,2),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Processos (extensão da tabela atual — alterar stage enum)
-- Status a substituir o enum atual:
-- 'cliente_ativo' | 'cliente_inativo' | 'aprovado' | 'em_analise_banco'
-- 'credito_recusado' | 'aguardando_assinatura' | 'processo_pendencia'
-- 'em_emissao' | 'juridico'

-- Adicionar à tabela processes:
ALTER TABLE processes ADD COLUMN unidade_id UUID REFERENCES unidades(id);
ALTER TABLE processes ADD COLUMN motivo_inatividade VARCHAR(100);
  -- CHECK: 'recursos_proprios' | 'outra_assessoria' | 'sozinho' | 'nao_atendeu'
ALTER TABLE processes ADD COLUMN fonte_renda VARCHAR(20);
  -- CHECK: 'assalariado' | 'nao_assalariado'
ALTER TABLE processes ADD COLUMN estado_civil VARCHAR(20);
  -- CHECK: 'casado' | 'solteiro' | 'divorciado'
ALTER TABLE processes ADD COLUMN data_nascimento DATE;
ALTER TABLE processes ADD COLUMN telefone VARCHAR(20);
ALTER TABLE processes ADD COLUMN endereco TEXT;
```

---

## Impacto no Kanban atual

O Kanban implementado usa stages: `cadastro → analise_credito → analise_juridica → vistoria → contrato → cartorio`

O fluxo real da assessoria usa uma progressão diferente e mais rica. **Decisão a tomar antes da Phase 5:**
- Alinhar os stages do Kanban com os status reais deste documento
- O enum `stage` na tabela `processes` precisará ser alterado

---

## Fora do Escopo TCC (registrado para evolução futura)

| Feature | Motivo |
|---|---|
| Assinatura digital ICP-Brasil | Requer certificadora homologada, custo alto |
| API bancária real | APIs proprietárias, requer acordo comercial |
| App mobile (React Native) | Fora do stack definido — web app substitui para o TCC |
| RabbitMQ/Redis | Complexidade operacional desnecessária para o volume TCC |
| Criptografia AES-256 de documentos | Azure Blob já criptografa at-rest; implementação adicional é opcional |
