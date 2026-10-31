# Deployment guide (AWS · Azure · GCP)

The app is two stateless containers plus a managed PostgreSQL:

```
Browser ──HTTPS──> web (Next.js :3000) ──/api/* rewrite──> api (Express :4000) ──> PostgreSQL
```

Next.js proxies `/api/*` and `/ws` to the API, so the browser only ever talks to one origin (no CORS setup). The API address is baked in **at build time** via the `BACKEND_URL` build arg:

```bash
docker build -t auction-web --build-arg BACKEND_URL=http://<internal-api-address>:4000 ./frontend
docker build -t auction-api ./backend
```

If the API's internal address changes, rebuild the web image.

## WebSockets (the live auction room)

The live room uses a WebSocket at `/ws` on the API. Two things to get right in the cloud:

1. **Route `/ws` to the API.** Simplest is path-based routing at your load balancer (`/api/*` and `/ws` to the API service, everything else to web). The Next.js proxy also forwards `/ws` and worked in testing, but a direct route removes one hop.
2. **Allow long-lived connections.** Raise idle timeouts above the default (ALB: 120 s or more; Azure Container Apps and Cloud Run: set request timeout to 3600 s). The app pings every 30 s and the browser reconnects (with a 2 s polling fallback) if a connection drops.

Several API instances are fine: they share state through Postgres and fan out with `LISTEN/NOTIFY`. Use a direct (non-pooled) database connection for the API, because transaction-mode poolers such as PgBouncer break `LISTEN`.

## Environment variables (API)

| Var | Notes |
|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:5432/db` |
| `DB_SSL` | `true` for RDS / Azure / Cloud SQL public endpoints |
| `JWT_SECRET` | ≥ 32 random chars, from a secret manager |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Seeded on first start only; change the password immediately or seed a strong one |
| `SEED_TEAMS` | `false` if you want to create teams yourself |
| `PORT` | default 4000 |

Store `DATABASE_URL`, `JWT_SECRET`, `ADMIN_PASSWORD` in the platform's secret store, never in the image.

The API runs the idempotent schema (`db/schema.sql`) on startup. Run **one** API instance during the first deploy, or run `npm run migrate` as a release step.

---

## Option A: AWS (ECS Fargate + RDS)

1. **Registry**: create two ECR repos (`auction-web`, `auction-api`), push images.
2. **Database**: RDS PostgreSQL 16 (Multi-AZ for production), private subnets, security group allowing 5432 only from the API tasks.
3. **Secrets**: AWS Secrets Manager for `DATABASE_URL`, `JWT_SECRET`, `ADMIN_PASSWORD`; reference them in the task definition.
4. **Cluster**: one ECS Fargate cluster, two services:
   - `api`: port 4000, health check `/health`, desired count 2. Register with an internal service discovery name (Cloud Map), e.g. `api.auction.local`.
   - `web`: port 3000, desired count 2, **built with** `BACKEND_URL=http://api.auction.local:4000`.
5. **Ingress**: public Application Load Balancer → `web` target group; ACM certificate for HTTPS; Route 53 record.
6. **Ops**: CloudWatch Logs, RDS automated backups, an alarm on 5xx and on RDS CPU/connections.

Alternative: App Runner for `web` and `api` (simpler, but private service-to-service networking needs a VPC connector).

## Option B: Azure (Container Apps + PostgreSQL Flexible Server)

```bash
az group create -n auction-rg -l centralindia
az acr create -g auction-rg -n <acrName> --sku Basic
az acr build -r <acrName> -t auction-api:1 ./backend
az acr build -r <acrName> -t auction-web:1 --build-arg BACKEND_URL=http://auction-api ./frontend

az postgres flexible-server create -g auction-rg -n <pgName> --version 16 --tier Burstable --sku-name Standard_B1ms \
  --admin-user auction --admin-password '<strong>' --database-name auction

az containerapp env create -g auction-rg -n auction-env -l centralindia
az containerapp create -g auction-rg -n auction-api --environment auction-env --image <acr>.azurecr.io/auction-api:1 \
  --target-port 4000 --ingress internal --min-replicas 1 \
  --secrets dburl='postgres://auction:<pw>@<pg>.postgres.database.azure.com:5432/auction' jwt='<random>' adminpw='<pw>' \
  --env-vars DATABASE_URL=secretref:dburl DB_SSL=true JWT_SECRET=secretref:jwt ADMIN_PASSWORD=secretref:adminpw
az containerapp create -g auction-rg -n auction-web --environment auction-env --image <acr>.azurecr.io/auction-web:1 \
  --target-port 3000 --ingress external --min-replicas 1
```

Within a Container Apps environment, the internal API is reachable at `http://auction-api`, which matches the `BACKEND_URL` above. Add a custom domain + managed certificate on `auction-web`. Use Key Vault references for secrets in production and Log Analytics for logs.

## Option C: GCP (Cloud Run + Cloud SQL)

```bash
gcloud artifacts repositories create auction --repository-format=docker --location=asia-south1
gcloud builds submit ./backend --tag asia-south1-docker.pkg.dev/<proj>/auction/api:1

gcloud sql instances create auction-pg --database-version=POSTGRES_16 --tier=db-g1-small --region=asia-south1
gcloud sql databases create auction --instance=auction-pg
gcloud sql users create auction --instance=auction-pg --password='<strong>'

# Secrets
printf '<random>' | gcloud secrets create jwt-secret --data-file=-
printf '<pw>'     | gcloud secrets create admin-password --data-file=-

gcloud run deploy auction-api --image asia-south1-docker.pkg.dev/<proj>/auction/api:1 --region asia-south1 \
  --no-allow-unauthenticated --add-cloudsql-instances <proj>:asia-south1:auction-pg \
  --set-env-vars DATABASE_URL='postgres://auction:<pw>@/auction?host=/cloudsql/<proj>:asia-south1:auction-pg' \
  --set-secrets JWT_SECRET=jwt-secret:latest,ADMIN_PASSWORD=admin-password:latest
```

Cloud Run services have public `https://…run.app` URLs, and the web container proxies server-side to the API, so give the web service's runtime identity `roles/run.invoker` on the API and attach an ID token, **or** simply deploy the API with `--allow-unauthenticated` (it enforces its own JWT auth) and set `BACKEND_URL` to its `run.app` URL when building `auction-web`. For the second option, build the web image after the API URL is known. Map your domain with a Cloud Run domain mapping or a Global External Load Balancer.

---

## Go-live checklist

- [ ] Strong `JWT_SECRET` and admin password set via secret store
- [ ] HTTPS only; HSTS enabled at the edge
- [ ] DB not publicly reachable (or restricted by IP), backups on, restore tested
- [ ] ≥ 2 replicas per service; health checks on `/health`
- [ ] Registration deadline and auction date set in the admin dashboard
- [ ] Rehearse a live round: 10 team logins bidding at once, then pause, resume and sell from the admin screen
- [ ] Create team passcodes at `/admin/teams` and share them privately with each owner
- [ ] Load test the register endpoint (rate limit is 30 per hour per IP; raise it if many players register from one shared network such as a college)
- [ ] On auction day: close the window, approve players, verify team purses and limits, export a CSV backup

## CI/CD sketch

On push to `main`: run `npm ci && npm run build` for both apps → build and push images tagged with the commit SHA → update the service (ECS `update-service`, `az containerapp update`, `gcloud run deploy`). Add a manual approval step before production.
