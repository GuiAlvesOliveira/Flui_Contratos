# VAL-05 — Walkthrough do gate de documentos com especialista de crédito

**Objetivo:** um especialista de crédito imobiliário (analista sênior de assessoria ou de banco) confirma ou ajusta a lista de documentos e a regra que trava o avanço do processo.

**Status:** material pronto · walkthrough **não realizado** (preencher abaixo).

## Como o sistema funciona hoje (para apresentar)

- **Regra RN-04 (na API):** o processo **não avança além da Análise de Crédito** enquanto houver documento do processo, ou documento pessoal do cliente, que não esteja **validado** pelo analista. Processo sem nenhum documento pedido também fica travado. Voltar a Pendência e retomar não contorna a regra.
- **Seguro (RN-05):** MIP e DFI precisam estar preenchidos antes de Cartório e Assinatura.
- **Lista de Documentos (por assessoria):** o gestor edita em Configurações; o analista escolhe dessa lista o que pedir em cada processo. Documentos pessoais valem para todos os processos do cliente.
- **Formulários (FE-23):** a partir da Análise de Crédito, DPS e Formulário de Financiamento entram no checklist como documentos a validar.

## Roteiro do walkthrough (≈ 45 min)

1. Mostrar um processo em Cadastro: pedir documentos pela lista, enviar um arquivo, validar, rejeitar.
2. Tentar avançar de Análise de Crédito para Crédito Aprovado com um documento pendente e mostrar a mensagem da trava, que lista os pendentes.
3. Percorrer a lista abaixo item a item.
4. Perguntar: "em que etapa cada documento é exigido de fato?" e "o que muda por banco, perfil de renda e estado civil?"

## Lista atual × avaliação do especialista (preencher)

| Documento (lista inicial) | Categoria | Exigido para | Especialista: manter / ajustar / remover | Observação (validade, quando pedir, por banco) |
|---|---|---|---|---|
| RG ou CNH | pessoal | todos |  |  |
| Comprovante de Endereço | pessoal | todos (até 90 dias?) |  |  |
| Certidão de Estado Civil | pessoal | todos (atualizada) |  |  |
| Holerite (mês 1, 2, 3) | renda | assalariado |  |  |
| Declaração de IRPF | renda | todos |  |  |
| Extrato Bancário (mês 1 a 6) | renda | não assalariado |  |  |
| DPS — Declaração Pessoal de Saúde | formulário | a partir da Análise de Crédito |  |  |
| Formulário de Financiamento | formulário | a partir da Análise de Crédito |  |  |

**Documentos que faltam na lista** (sugestões do especialista: matrícula do imóvel, certidões do vendedor, contrato de compra e venda, FGTS etc.):

| Documento | Categoria | Etapa em que é exigido | Por quê |
|---|---|---|---|
|  |  |  |  |

## Avaliação da regra (preencher)

| Pergunta | Resposta do especialista |
|---|---|
| Travar o avanço depois da Análise de Crédito até tudo estar validado é correto? |  |
| Algum documento deveria travar antes (ex.: no Cadastro)? |  |
| Algum documento pode ficar para depois sem travar (ex.: entregue só no cartório)? |  |
| Há casos em que o analista precisa avançar com pendência (exceção)? Quem autoriza? |  |

- **Data / especialista (anônimo, cargo):**
- **Decisões e ajustes para o backlog:**

**Critério de aceite:** checklist confirmado ou ajustado por especialista de crédito, registrado neste documento.
