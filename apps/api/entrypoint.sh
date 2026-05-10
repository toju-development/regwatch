#!/bin/sh
# entrypoint.sh — apps/api production startup script.
# Runs inside the Cloud Run container before the HTTP server starts.
#
# Prisma migrations: run as a Cloud Run Job before this service is deployed
# (see DEPLOYMENT.md § "Running Migrations"). The entrypoint does NOT run
# migrations automatically to avoid blocking the service on a DB connection
# failure during rolling deployments.
set -e

exec tsx src/main.ts
