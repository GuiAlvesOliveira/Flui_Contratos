#!/usr/bin/env bash
# keyvault-refs.sh — INFRA-17: move the API secrets from App Service settings to
# Azure Key Vault, read through the App Service system-assigned managed identity
# (Key Vault references). The API code does not change: it keeps reading the
# same environment variables, which App Service resolves from the vault.
#
# Usage:
#   bash infra/azure/keyvault-refs.sh            # dry run: shows the plan (names only)
#   bash infra/azure/keyvault-refs.sh --apply    # executes, with checks and automatic rollback
#   bash infra/azure/keyvault-refs.sh --apply --remove-unused
#                                                # also deletes settings the API no longer reads
#
# Safety:
#   - one low-risk secret (SMTP_USER) is migrated first; the rest only follow once
#     App Service reports that reference as Resolved (role propagation can take minutes);
#   - if any reference does not resolve, every setting goes back to its previous value;
#   - secret values are never printed; /health is checked at the end.

set -euo pipefail

RG="flui-dev"
APP="flui-api-dev"
VAULT="flui-kv-dev-fecap"
API_HEALTH="https://flui-api-dev.azurewebsites.net/health"
APPLY=false
REMOVE_UNUSED=false
for a in "$@"; do
  case "$a" in
    --apply) APPLY=true ;;
    --remove-unused) REMOVE_UNUSED=true ;;
    *) echo "argumento desconhecido: $a" >&2; exit 2 ;;
  esac
done

# App setting -> Key Vault secret name. SMTP_USER first (canary: e-mail only).
SETTINGS=(SMTP_USER SMTP_PASS SUPABASE_SERVICE_ROLE_KEY AZURE_STORAGE_CONNECTION_STRING DATABASE_PASSWORD WEBHOOK_SECRET)
declare -A SECRET_NAME=(
  [SMTP_USER]="smtp-username"
  [SMTP_PASS]="smtp-password"
  [SUPABASE_SERVICE_ROLE_KEY]="supabase-service-role-key"
  [AZURE_STORAGE_CONNECTION_STRING]="azure-storage-connection-string"
  [DATABASE_PASSWORD]="database-password"
  [WEBHOOK_SECRET]="webhook-secret"
)
# Present in production but no longer read by the API (and they hold secrets)
UNUSED=(SUPABASE_JWT_SECRET DATABASE_URL)

log() { printf '\n▶ %s\n' "$*"; }
ref() { printf '@Microsoft.KeyVault(VaultName=%s;SecretName=%s)' "$VAULT" "$1"; }
setting() { az webapp config appsettings list -g "$RG" -n "$APP" --query "[?name=='$1'].value | [0]" -o tsv; }
has_setting() { [ -n "$(az webapp config appsettings list -g "$RG" -n "$APP" --query "[?name=='$1'].name | [0]" -o tsv)" ]; }
ref_status() {
  local sub; sub=$(az account show --query id -o tsv)
  az rest --method get \
    --uri "https://management.azure.com/subscriptions/${sub}/resourceGroups/${RG}/providers/Microsoft.Web/sites/${APP}/config/configreferences/appsettings/$1?api-version=2022-03-01" \
    --query properties.status -o tsv 2>/dev/null || echo "?"
}

log "Plano (cofre ${VAULT}, app ${APP})"
for s in "${SETTINGS[@]}"; do
  if has_setting "$s"; then
    cur=$(az webapp config appsettings list -g "$RG" -n "$APP" --query "[?name=='$s'].value | [0]" -o tsv | grep -c '^@Microsoft.KeyVault' || true)
    [ "$cur" = "1" ] && echo "  $s: já é referência ao cofre" || echo "  $s -> segredo ${SECRET_NAME[$s]}"
  else
    echo "  $s: não existe no App Service (ignorado)"
  fi
done
for s in "${UNUSED[@]}"; do
  has_setting "$s" && echo "  $s: não é mais lido pela API — $( $REMOVE_UNUSED && echo 'será removido' || echo 'use --remove-unused para remover')"
done
$APPLY || { echo; echo "Simulação: nada foi alterado. Rode com --apply para executar."; exit 0; }

log "1/5 Identidade gerenciada do App Service"
PRINCIPAL=$(az webapp identity assign -g "$RG" -n "$APP" --query principalId -o tsv)
echo "  principalId: ${PRINCIPAL}"

log "2/5 Papel 'Key Vault Secrets User' no cofre (RBAC)"
KV_ID=$(az keyvault show -n "$VAULT" -g "$RG" --query id -o tsv)
az role assignment create --assignee-object-id "$PRINCIPAL" --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" --scope "$KV_ID" --output none 2>/dev/null || echo "  (papel já atribuído)"

declare -A OLD=()
rollback() {
  log "ROLLBACK: devolvendo os valores anteriores"
  for s in "${!OLD[@]}"; do
    az webapp config appsettings set -g "$RG" -n "$APP" --settings "$s=${OLD[$s]}" --output none
    echo "  $s restaurado"
  done
  exit 1
}

migrate() {
  local s=$1 name=${SECRET_NAME[$1]} val
  has_setting "$s" || return 0
  val=$(setting "$s")
  [[ "$val" == @Microsoft.KeyVault* ]] && { echo "  $s já referencia o cofre"; return 0; }
  OLD[$s]="$val"
  az keyvault secret set --vault-name "$VAULT" --name "$name" --value "$val" --output none
  az webapp config appsettings set -g "$RG" -n "$APP" --settings "$s=$(ref "$name")" --output none
  echo "  $s -> cofre (${name})"
}

wait_resolved() {
  local s=$1 st
  for _ in $(seq 1 30); do
    st=$(ref_status "$s")
    [ "$st" = "Resolved" ] && { echo "  $s: Resolved"; return 0; }
    sleep 20
  done
  echo "  $s: não resolveu (último status: ${st})"
  return 1
}

log "3/5 Canário: SMTP_USER"
migrate SMTP_USER
wait_resolved SMTP_USER || rollback

log "4/5 Demais segredos"
for s in "${SETTINGS[@]:1}"; do migrate "$s"; done
for s in "${!OLD[@]}"; do wait_resolved "$s" || rollback; done

if $REMOVE_UNUSED; then
  for s in "${UNUSED[@]}"; do
    has_setting "$s" && az webapp config appsettings delete -g "$RG" -n "$APP" --setting-names "$s" --output none && echo "  $s removido"
  done
fi

log "5/5 Saúde da API"
for _ in $(seq 1 30); do
  if curl -fsS -m 15 "$API_HEALTH" | grep -q '"ok"'; then echo "  /health ok"; exit 0; fi
  sleep 10
done
echo "  /health não respondeu — conferir os logs do App Service"; rollback
