#!/usr/bin/env bash
# provision.sh — Provision all Azure resources for Flui Contratos
# Resource group: flui-dev | Region: Brazil South
#
# Prerequisites:
#   - Azure CLI installed and authenticated (az login)
#   - Subscription set: az account set --subscription <id>
#   - az extension add --name application-insights (one-time)
#   - .env.azure filled (copy from env.azure.template)
#
# Idempotent: safe to re-run; existing resources are skipped.
# Usage: bash infra/azure/provision.sh
#
# Notes:
#   - Azure Static Web Apps are NOT available in Brazil South. Deploy the
#     frontend via the Azure Portal (eastus2 or centralus) or GitHub Actions.
#   - The student subscription may restrict certain regions. If a resource
#     creation fails with RequestDisallowedByAzure, use the Azure Portal.

set -euo pipefail

# ── Config ────────────────────────────────────────────────────
RESOURCE_GROUP="flui-dev"
LOCATION="brazilsouth"
ENVIRONMENT="dev"

POSTGRES_SERVER_NAME="flui-postgres-${ENVIRONMENT}"
POSTGRES_DB_NAME="flui_contratos"
POSTGRES_ADMIN_USER="fluiadmin"
POSTGRES_SKU="Standard_B1ms"
POSTGRES_TIER="Burstable"
POSTGRES_VERSION="16"

STORAGE_ACCOUNT_NAME="fluigj2026${ENVIRONMENT}"
STORAGE_CONTAINER_NAME="documentos"

APP_SERVICE_PLAN_NAME="flui-asp-${ENVIRONMENT}"
APP_SERVICE_NAME="flui-api-${ENVIRONMENT}"
APP_SERVICE_SKU="B1"
APP_SERVICE_RUNTIME="NODE:22-lts"

INSIGHTS_WORKSPACE_NAME="flui-logs-${ENVIRONMENT}"
INSIGHTS_NAME="flui-insights-${ENVIRONMENT}"

KEY_VAULT_NAME="flui-kv-${ENVIRONMENT}-fecap"

# ── Helpers ───────────────────────────────────────────────────
log() { echo "[$(date '+%H:%M:%S')] $*"; }

# ── Resource Group ────────────────────────────────────────────
log "Ensuring resource group: ${RESOURCE_GROUP}"
az group create \
  --name "${RESOURCE_GROUP}" \
  --location "${LOCATION}" \
  --output none

# ── Key Vault ────────────────────────────────────────────────
log "Ensuring Key Vault: ${KEY_VAULT_NAME}"
if ! az keyvault show --name "${KEY_VAULT_NAME}" --resource-group "${RESOURCE_GROUP}" --output none 2>/dev/null; then
  az provider register --namespace Microsoft.KeyVault 2>/dev/null || true
  az keyvault create \
    --name "${KEY_VAULT_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --location "${LOCATION}" \
    --sku standard \
    --output none

  # Grant the current caller secrets access
  CALLER_OID=$(az ad signed-in-user show --query id -o tsv 2>/dev/null || true)
  KV_ID=$(az keyvault show --name "${KEY_VAULT_NAME}" --resource-group "${RESOURCE_GROUP}" --query id -o tsv)
  if [ -n "${CALLER_OID}" ]; then
    az role assignment create --assignee "${CALLER_OID}" --role "Key Vault Secrets Officer" --scope "${KV_ID}" --output none 2>/dev/null || true
  fi
else
  log "Key Vault already exists, skipping."
fi

# ── PostgreSQL Flexible Server ────────────────────────────────
log "Ensuring PostgreSQL server: ${POSTGRES_SERVER_NAME}"
POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')

if ! az postgres flexible-server show \
     --name "${POSTGRES_SERVER_NAME}" \
     --resource-group "${RESOURCE_GROUP}" \
     --output none 2>/dev/null; then

  az postgres flexible-server create \
    --name "${POSTGRES_SERVER_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --location "${LOCATION}" \
    --admin-user "${POSTGRES_ADMIN_USER}" \
    --admin-password "${POSTGRES_PASSWORD}" \
    --sku-name "${POSTGRES_SKU}" \
    --tier "${POSTGRES_TIER}" \
    --version "${POSTGRES_VERSION}" \
    --storage-size 32 \
    --public-access none \
    --output none

  log "Storing PostgreSQL password in Key Vault"
  az keyvault secret set \
    --vault-name "${KEY_VAULT_NAME}" \
    --name "postgres-admin-password" \
    --value "${POSTGRES_PASSWORD}" \
    --output none
else
  log "PostgreSQL server already exists, skipping creation."
fi

log "Ensuring database: ${POSTGRES_DB_NAME}"
az postgres flexible-server db create \
  --server-name "${POSTGRES_SERVER_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --database-name "${POSTGRES_DB_NAME}" \
  --output none 2>/dev/null || log "Database already exists, skipping."

# ── Storage Account + Blob Container ─────────────────────────
log "Ensuring storage account: ${STORAGE_ACCOUNT_NAME}"
if ! az storage account show \
     --name "${STORAGE_ACCOUNT_NAME}" \
     --resource-group "${RESOURCE_GROUP}" \
     --output none 2>/dev/null; then
  az storage account create \
    --name "${STORAGE_ACCOUNT_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --location "${LOCATION}" \
    --sku Standard_LRS \
    --kind StorageV2 \
    --allow-blob-public-access false \
    --min-tls-version TLS1_2 \
    --output none
else
  log "Storage account already exists, skipping."
fi

STORAGE_KEY=$(az storage account keys list \
  --account-name "${STORAGE_ACCOUNT_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query "[0].value" --output tsv)

log "Ensuring blob container: ${STORAGE_CONTAINER_NAME}"
az storage container create \
  --name "${STORAGE_CONTAINER_NAME}" \
  --account-name "${STORAGE_ACCOUNT_NAME}" \
  --account-key "${STORAGE_KEY}" \
  --public-access off \
  --output none 2>/dev/null || log "Container already exists, skipping."

log "Enabling soft delete on blob container (30 days)"
az storage blob service-properties delete-policy update \
  --account-name "${STORAGE_ACCOUNT_NAME}" \
  --account-key "${STORAGE_KEY}" \
  --enable true \
  --days-retained 30 \
  --output none

# ── App Service Plan + Web App (backend) ─────────────────────
log "Ensuring App Service Plan: ${APP_SERVICE_PLAN_NAME}"
az appservice plan create \
  --name "${APP_SERVICE_PLAN_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --location "${LOCATION}" \
  --is-linux \
  --sku "${APP_SERVICE_SKU}" \
  --output none 2>/dev/null || log "App Service Plan already exists, skipping."

log "Ensuring Web App: ${APP_SERVICE_NAME}"
if ! az webapp show \
     --name "${APP_SERVICE_NAME}" \
     --resource-group "${RESOURCE_GROUP}" \
     --output none 2>/dev/null; then
  az webapp create \
    --name "${APP_SERVICE_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --plan "${APP_SERVICE_PLAN_NAME}" \
    --runtime "${APP_SERVICE_RUNTIME}" \
    --output none
else
  log "Web App already exists, skipping."
fi

# ── Application Insights ──────────────────────────────────────
log "Ensuring Log Analytics workspace: ${INSIGHTS_WORKSPACE_NAME}"
az monitor log-analytics workspace create \
  --workspace-name "${INSIGHTS_WORKSPACE_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --location "${LOCATION}" \
  --output none 2>/dev/null || log "Workspace already exists, skipping."

WORKSPACE_ID=$(az monitor log-analytics workspace show \
  --workspace-name "${INSIGHTS_WORKSPACE_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query "id" --output tsv)

log "Ensuring Application Insights: ${INSIGHTS_NAME}"
if ! az monitor app-insights component show \
     --app "${INSIGHTS_NAME}" \
     --resource-group "${RESOURCE_GROUP}" \
     --output none 2>/dev/null; then
  az feature register --name AIWorkspacePreview --namespace microsoft.insights --output none 2>/dev/null || true
  az provider register -n microsoft.insights 2>/dev/null || true
  az monitor app-insights component create \
    --app "${INSIGHTS_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --location "${LOCATION}" \
    --kind web \
    --workspace "${WORKSPACE_ID}" \
    --output none
else
  log "Application Insights already exists, skipping."
fi

INSIGHTS_CONNECTION_STRING=$(az monitor app-insights component show \
  --app "${INSIGHTS_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query "connectionString" --output tsv)

log "Wiring Application Insights to Web App"
az webapp config appsettings set \
  --name "${APP_SERVICE_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --settings "APPLICATIONINSIGHTS_CONNECTION_STRING=${INSIGHTS_CONNECTION_STRING}" \
  --output none

# ── Summary ───────────────────────────────────────────────────
log ""
log "──────────────────────────────────────────────────────────"
log "Provisioning complete."
log ""
POSTGRES_HOST=$(az postgres flexible-server show \
  --name "${POSTGRES_SERVER_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query "fullyQualifiedDomainName" --output tsv 2>/dev/null || echo "<error>")
log "PostgreSQL host:   ${POSTGRES_HOST}"
log "Storage account:   ${STORAGE_ACCOUNT_NAME}"
log "App Service URL:   https://${APP_SERVICE_NAME}.azurewebsites.net"
log "Key Vault:         ${KEY_VAULT_NAME} (postgres-admin-password stored)"
log "App Insights:      connection string wired to Web App settings"
log ""
log "Next steps:"
log "  1. Copy infra/azure/env.azure.template to .env.azure and fill all values"
log "  2. Get SUPABASE_JWT_SECRET from Supabase Dashboard → Project Settings → API"
log "     Store it: az keyvault secret set --vault-name ${KEY_VAULT_NAME} --name supabase-jwt-secret --value <secret>"
log "  3. Seed the database:"
log "     docker run --rm -e PGPASSWORD=<password> -v \$(pwd)/infra/db/seed.sql:/seed.sql \\"
log "       postgres:16 psql 'host=${POSTGRES_HOST} port=5432 dbname=${POSTGRES_DB_NAME} user=${POSTGRES_ADMIN_USER} sslmode=require' -f /seed.sql"
log "  4. Static Web App: not available via CLI in this subscription — use Azure Portal."
log "──────────────────────────────────────────────────────────"
