# Roteiro do vídeo de demonstração do MVP (DOC-05)

**Duração-alvo:** até 5 min · **Fluxo:** login → processo → documentos → portal do cliente.

**Status:** roteiro pronto · vídeo **não gravado**.

## Preparação (antes de gravar)

- Produção (https://fluicontratos.com.br) com **dados fictícios**:
  - conta de **gestor**, conta de **analista** e conta de **cliente** de teste;
  - empreendimento "Residencial Aurora" com 3 unidades;
  - processo da cliente fictícia "Helena" em Cadastro.
- Navegador em janela anônima, zoom 100%, 1920×1080, sem notificações do sistema.
- Gravar com OBS (tela + microfone) e cortar no editor. Arquivo final `flui-demo-mvp.mp4`; no repositório vai só o link (YouTube não listado ou Drive).
- Nunca usar dado real de cliente na gravação.

## Roteiro

| Tempo | Tela | O que fazer | Narração (sugestão) |
|---|---|---|---|
| 0:00–0:20 | Login | Abrir o site e entrar como **analista**. | "O Flui organiza os financiamentos imobiliários de uma assessoria do primeiro contato à assinatura." |
| 0:20–0:50 | Workflow (Kanban) | Mostrar as colunas; usar a busca (Ctrl+K) para achar a Helena. | "Cada coluna é uma etapa do financiamento. Cada assessoria só vê os próprios processos." |
| 0:50–1:30 | Processo da Helena → Documentos | "Solicitar documentos": escolher RG, comprovante de endereço e holerites na lista da assessoria. | "O analista pede os documentos da lista que o gestor configurou, e o cliente é avisado." |
| 1:30–2:00 | Kanban | Tentar avançar um processo com documento pendente e mostrar a mensagem que lista os pendentes. | "A regra fica na API: sem todos os documentos validados, o processo não passa da análise de crédito." |
| 2:00–2:50 | Portal do cliente | Entrar como **cliente** (outra janela anônima): ver a etapa, enviar o comprovante de endereço, mostrar "Recebido". | "O cliente acompanha o processo e envia os documentos pelo celular, sem WhatsApp." |
| 2:50–3:30 | Analista → Documentos | Visualizar o arquivo, **validar**; mostrar o sino de notificações e a aba Atividade. | "O analista valida, e tudo fica registrado: quem fez, o quê e quando." |
| 3:30–4:00 | Kanban | Arrastar o processo para a próxima etapa. | "Com os documentos validados, o processo avança; o cliente recebe a notificação." |
| 4:00–4:40 | Dashboard (gestor) | Entrar como **gestor**: funil, tempo médio por etapa e exportação CSV. | "O gestor vê onde cada processo está, quanto tempo passa em cada etapa e exporta o relatório." |
| 4:40–5:00 | Encerramento | Voltar ao Kanban. | "Flui Contratos — TCC FECAP, Guilherme e João Pedro." |

## Checklist depois da gravação

- [ ] Duração ≤ 5 min.
- [ ] Mostra login, processo, documentos e portal do cliente.
- [ ] Nenhum dado real (nome, CPF, e-mail) aparece.
- [ ] Link do vídeo registrado aqui e na issue DOC-05.

**Link do vídeo:** (a preencher)
