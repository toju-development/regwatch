# Deployment Guide — RegWatch

This guide covers deploying all three RegWatch services to **Google Cloud Run** with **Cloud SQL (Postgres 15)** and **Secret Manager**.

---

## Prerequisites

| Tool         | Version   |
| ------------ | --------- |
| `gcloud` CLI | ≥ 500.0.0 |
| Docker       | ≥ 27      |
| pnpm         | 9.15.0    |

GCP services that must be enabled:

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com
```

---

## 1. GCP Project Setup

```bash
export PROJECT_ID=your-gcp-project-id
export REGION=us-central1
export AR_REPO=regwatch

gcloud config set project $PROJECT_ID
```

### Create Artifact Registry repository

```bash
gcloud artifacts repositories create $AR_REPO \
  --repository-format=docker \
  --location=$REGION
```

### Create Cloud SQL instance (Postgres 15)

```bash
gcloud sql instances create regwatch-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=$REGION \
  --no-assign-ip \
  --enable-google-private-path

gcloud sql databases create regwatch --instance=regwatch-db
gcloud sql users create regwatch \
  --instance=regwatch-db \
  --password=<strong-password>
```

> **Note**: The Cloud Run services connect via the built-in Cloud SQL connector (Unix socket). No Cloud SQL Auth Proxy is needed.

---

## 2. Secret Manager — All Variables

Create one secret per variable with:

```bash
echo -n "VALUE" | gcloud secrets create SECRET_NAME \
  --data-file=- --replication-policy=automatic
```

### regwatch-api secrets

| Secret name                    | Description                                                         | Required |
| ------------------------------ | ------------------------------------------------------------------- | -------- |
| `DATABASE_URL`                 | `postgresql://USER:PASS@/DB?host=/cloudsql/PROJECT:REGION:INSTANCE` | ✅       |
| `AUTH_SECRET`                  | ≥ 32-char random string (shared with web)                           | ✅       |
| `JWT_ISSUER`                   | e.g. `regwatch-web`                                                 | ✅       |
| `JWT_AUDIENCE`                 | e.g. `regwatch-api`                                                 | ✅       |
| `SCANNER_INTERNAL_SECRET`      | Random string; must match scanner                                   | ✅       |
| `RESEND_API_KEY`               | Resend.com API key                                                  | ✅       |
| `RESEND_FROM_EMAIL`            | Verified sender address                                             | ✅       |
| `APP_URL`                      | Public URL of regwatch-web service                                  | ✅       |
| `SCANNER_INTERNAL_URL`         | Internal URL of regwatch-scanner                                    | ✅       |
| `SENTRY_DSN`                   | Sentry DSN (leave empty to disable)                                 | ⬜       |
| `LOG_LEVEL`                    | `info` (default)                                                    | ⬜       |
| `EMAIL_TRANSPORT`              | Omit or set to `resend` for production                              | ⬜       |
| `MANUAL_INGEST_ENABLED`        | `true` to enable manual ingestion                                   | ⬜       |
| `EMAIL_INBOUND_ENABLED`        | `true` to enable email inbound                                      | ⬜       |
| `EMAIL_INBOUND_WEBHOOK_SECRET` | SendGrid ECDSA public key                                           | ⬜       |
| `WEB_URL`                      | Public URL of regwatch-web (invite emails)                          | ✅       |

### regwatch-scanner secrets

| Secret name               | Description                             | Required |
| ------------------------- | --------------------------------------- | -------- |
| `DATABASE_URL`            | Same Cloud SQL connection string as api | ✅       |
| `AUTH_SECRET`             | Same as api                             | ✅       |
| `JWT_ISSUER`              | Same as api                             | ✅       |
| `JWT_AUDIENCE`            | Same as api                             | ✅       |
| `SCANNER_INTERNAL_SECRET` | Must match api value                    | ✅       |
| `SENTRY_DSN`              | Sentry DSN (optional)                   | ⬜       |
| `LOG_LEVEL`               | `info` (default)                        | ⬜       |

### regwatch-web secrets

| Secret name                      | Description                                                      | Required |
| -------------------------------- | ---------------------------------------------------------------- | -------- |
| `AUTH_SECRET`                    | Same as api                                                      | ✅       |
| `DATABASE_URL`                   | Same Cloud SQL connection string                                 | ✅       |
| `NEXT_PUBLIC_API_URL`            | Public URL of regwatch-api                                       | ✅       |
| `API_URL`                        | Internal Cloud Run URL of regwatch-api                           | ✅       |
| `AUTH_URL`                       | Public URL of regwatch-web (e.g. `https://regwatch.example.com`) | ✅       |
| `AUTH_GOOGLE_ID`                 | Google OAuth client ID                                           | ✅       |
| `AUTH_GOOGLE_SECRET`             | Google OAuth client secret                                       | ✅       |
| `AUTH_RESEND_KEY`                | Resend API key for magic link                                    | ✅       |
| `AUTH_EMAIL_FROM`                | Magic link sender address                                        | ✅       |
| `JWT_ISSUER`                     | Same as api                                                      | ✅       |
| `JWT_AUDIENCE`                   | Same as api                                                      | ✅       |
| `AUTH_MICROSOFT_ENTRA_ID`        | Azure App Registration client ID (optional — Entra SSO)          | ⬜       |
| `AUTH_MICROSOFT_ENTRA_SECRET`    | Azure client secret (optional — Entra SSO)                       | ⬜       |
| `AUTH_MICROSOFT_ENTRA_TENANT_ID` | Azure tenant ID; use `common` for multi-tenant (optional)        | ⬜       |

---

## 3a. Microsoft Entra ID Setup (Optional)

Microsoft Entra ID (Azure AD) enables enterprise SSO for your users. The feature is **off by default** — the app starts normally with no Entra vars set.

### When to enable

Set all three `AUTH_MICROSOFT_ENTRA_*` secrets when you want to allow sign-in with Microsoft / Azure AD accounts.

> **All-or-nothing**: you must set all three vars together. Setting one or two will cause the app to throw at startup (`INV-ENTRA-1`). Rollback = remove all three vars.

### Azure App Registration

1. Go to [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) and click **New registration**.
2. Name: e.g. `RegWatch`; supported account types: _Accounts in any organizational directory and personal Microsoft accounts_ (multi-tenant) or restrict to your tenant.
3. Under **Redirect URIs**, add:
   ```
   https://<your-domain>/api/auth/callback/microsoft-entra-id
   ```
4. After creation, copy the **Application (client) ID** → `AUTH_MICROSOFT_ENTRA_ID`.
5. Go to **Certificates & secrets → New client secret**, copy the **Value** → `AUTH_MICROSOFT_ENTRA_SECRET`.
6. For **Tenant ID**:
   - Multi-tenant / personal accounts: use `common`
   - Single Azure AD directory: use your Directory (tenant) ID

### Secrets to create

```bash
echo -n "<App client ID>"     | gcloud secrets create AUTH_MICROSOFT_ENTRA_ID     --data-file=- --replication-policy=automatic
echo -n "<Client secret>"     | gcloud secrets create AUTH_MICROSOFT_ENTRA_SECRET  --data-file=- --replication-policy=automatic
echo -n "common"              | gcloud secrets create AUTH_MICROSOFT_ENTRA_TENANT_ID --data-file=- --replication-policy=automatic
```

Then mount in `regwatch-web`:

```bash
gcloud run services update regwatch-web \
  --region=$REGION \
  --update-secrets=AUTH_MICROSOFT_ENTRA_ID=AUTH_MICROSOFT_ENTRA_ID:latest,\
AUTH_MICROSOFT_ENTRA_SECRET=AUTH_MICROSOFT_ENTRA_SECRET:latest,\
AUTH_MICROSOFT_ENTRA_TENANT_ID=AUTH_MICROSOFT_ENTRA_TENANT_ID:latest
```

### Rollback

Remove all three env vars from the Cloud Run service — the provider is absent when vars are unset, no code deploy needed.

Mount secrets as environment variables in each service. Example for `regwatch-api`:

```bash
gcloud run services update regwatch-api \
  --region=$REGION \
  --update-secrets=DATABASE_URL=DATABASE_URL:latest,\
AUTH_SECRET=AUTH_SECRET:latest,\
JWT_ISSUER=JWT_ISSUER:latest,\
JWT_AUDIENCE=JWT_AUDIENCE:latest,\
SCANNER_INTERNAL_SECRET=SCANNER_INTERNAL_SECRET:latest,\
RESEND_API_KEY=RESEND_API_KEY:latest,\
RESEND_FROM_EMAIL=RESEND_FROM_EMAIL:latest,\
APP_URL=APP_URL:latest,\
SCANNER_INTERNAL_URL=SCANNER_INTERNAL_URL:latest,\
SENTRY_DSN=SENTRY_DSN:latest,\
WEB_URL=WEB_URL:latest \
  --add-cloudsql-instances=$PROJECT_ID:$REGION:regwatch-db
```

Repeat equivalently for `regwatch-scanner` and `regwatch-web` with their respective secret lists.

### Service account permissions

Each Cloud Run service needs:

- `roles/cloudsql.client` — Cloud SQL connection
- `roles/secretmanager.secretAccessor` — Secret Manager reads

```bash
for SVC in regwatch-api regwatch-scanner regwatch-web; do
  SA="${SVC}-sa@${PROJECT_ID}.iam.gserviceaccount.com"
  gcloud iam service-accounts create ${SVC}-sa --display-name="$SVC runtime"
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SA" --role=roles/cloudsql.client
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
done
```

---

## 4. Running Migrations

Prisma migrations are **not** run automatically at container startup. Run them before deploying a new revision that requires schema changes:

```bash
# Option A: Cloud Run Job (recommended for CI/CD)
gcloud run jobs create regwatch-migrate \
  --image=$REGION-docker.pkg.dev/$PROJECT_ID/$AR_REPO/regwatch-api:latest \
  --region=$REGION \
  --set-cloudsql-instances=$PROJECT_ID:$REGION:regwatch-db \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest \
  --command="node_modules/.bin/prisma,migrate,deploy"

gcloud run jobs execute regwatch-migrate --region=$REGION --wait

# Option B: Local (requires Cloud SQL Auth Proxy running locally)
DATABASE_URL="postgresql://regwatch:PASS@localhost:5432/regwatch" \
  pnpm -F @regwatch/db exec prisma migrate deploy
```

---

## 5. GitHub Actions Authentication

The deploy job uses **Workload Identity Federation** (keyless — no long-lived service account keys).

### Setup

```bash
# Create Workload Identity Pool
gcloud iam workload-identity-pools create github-pool \
  --location=global --display-name="GitHub Actions"

# Create provider
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository"

# Allow the GitHub repo to impersonate the deploy SA
gcloud iam service-accounts add-iam-policy-binding deploy-sa@$PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/attribute.repository/YOUR_ORG/regwatch"
```

### Required GitHub Secrets / Variables

| Name                             | Type     | Value                                          |
| -------------------------------- | -------- | ---------------------------------------------- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Secret   | Full provider resource name                    |
| `GCP_SERVICE_ACCOUNT`            | Secret   | `deploy-sa@PROJECT_ID.iam.gserviceaccount.com` |
| `GCP_PROJECT_ID`                 | Variable | Your GCP project ID                            |

---

## 6. Rollback

Cloud Run keeps all previous revisions. To roll back:

```bash
# List recent revisions
gcloud run revisions list --service=regwatch-api --region=$REGION

# Roll back traffic to a specific revision
gcloud run services update-traffic regwatch-api \
  --region=$REGION \
  --to-revisions=REVISION_NAME=100
```

> **Important**: Database migrations are forward-only. Design them to be additive and non-breaking so any revision can be rolled back without a schema revert.

---

## 7. Health Checks

Both backend services expose a public health endpoint:

```
GET /health
→ 200 { "status": "ok", "service": "api", "uptime": 123.4, "version": "0.0.0" }
```

Configure Cloud Run health checks via the console or:

```bash
gcloud run services update regwatch-api \
  --region=$REGION \
  --startup-cpu-boost \
  --http-health-check-path=/health
```
