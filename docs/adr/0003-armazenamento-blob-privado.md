# ADR 0003 — Documentos em Azure Blob Storage privado, servidos só pela API

**Status:** Aceito · **Itens:** BE-10, SEC-04, SEC-06, BE-03, PROD-12

## Contexto
Os clientes enviam documentos pessoais (RG, comprovantes de renda, certidões). São dados pessoais protegidos pela LGPD e não podem ficar acessíveis por link público.

## Decisão
- Arquivos ficam num container **privado** do Azure Blob Storage (Azurite no ambiente local). A URL do blob nunca sai do backend.
- Upload e download passam pela API, que confere tenant e papel a cada acesso; não há link SAS. O upload aceita só PDF, JPEG e PNG, conferindo o conteúdo real do arquivo (assinatura) e não só o tipo declarado (SEC-06).
- O download responde com `nosniff`, e tipos que não sejam imagem ou PDF são forçados a baixar.
- Exclusão definitiva (LGPD): apaga o arquivo e o registro, remove o nome original do arquivo dos logs antigos e registra a exclusão sem dado pessoal (BE-10).
- Histórico de versões (PROD-12): cada envio grava um blob novo (`<tenant>/<processo>/<documento>/<uuid>.<ext>`) e uma linha em `document_versions` com quem enviou, quando e o resultado da validação; reenviar nunca sobrescreve. O documento aponta para a versão atual, que é a única que a trava do RN-04 considera. O versionamento é da aplicação, não o *Blob versioning* da Azure: assim cada versão tem o seu controle de acesso e o seu resultado, e funciona igual no Azurite. A exclusão LGPD apaga os arquivos de todas as versões e, em cascata, os registros.

## Consequências
- Todo download consome banda da API, em troca de controle de acesso completo e auditável.
- A conta de produção tem a lixeira (soft delete) do Azure ligada por 30 dias: o arquivo excluído some do sistema na hora, mas fica recuperável por um administrador da conta Azure nesse prazo.
