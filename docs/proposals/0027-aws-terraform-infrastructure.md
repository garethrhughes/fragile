# 0027 — AWS Terraform Infrastructure

**Date:** 2026-04-14
**Status:** Superseded by [0039](0039-migrate-from-app-runner-to-ecs-express.md)
**Author:** Architect Agent
**Supersedes:** [0019](0019-aws-hosting-low-cost.md) (AWS Hosting — Minimum Cost)
**Related ADRs:** None yet — will be created on acceptance

> **Historical note:** This proposal designed the initial Terraform infrastructure around
> AWS App Runner. That infrastructure was subsequently replaced by ECS Fargate in proposal
> 0039. The App Runner design documented here is preserved for historical reference.
> The live Terraform implementation is under `infra/terraform/modules/ecs/` and the
> `modules/apprunner/` module referenced throughout this proposal no longer exists.

---

## Problem Statement

Proposal 0019 established the target AWS architecture (App Runner + Aurora DSQL + SSM) and
identified the required application code changes. It recommended AWS CDK (TypeScript) as the
IaC tool. The owner has since specified **Terraform** instead of CDK. Additionally, a detailed
audit of the actual codebase against the 0019 design has surfaced several gaps that the
Terraform implementation must account for:

1. No `Dockerfile` exists in either `backend/` or `frontend/` — these must be specced.
2. `frontend/next.config.mjs` does **not** set `output: 'standalone'` — required for App Runner.
3. The backend reads `config/boards.yaml` and `config/roadmap.yaml` from the **local filesystem**
   at startup — this path must be resolved for containerised deployment.
4. The database connection uses static host/port/password env vars — no DSQL IAM token logic
   exists yet in `data-source.ts` or `app.module.ts`.
5. `migrationsRun: true` in `app.module.ts` means migrations run automatically on every
   container start — this interacts with DSQL's DDL/DML transaction isolation constraint.
6. CORS is configured via `FRONTEND_URL` — this env var must be set on the backend App Runner
   service to the frontend's service URL.
7. Aurora DSQL is a **Preview / limited-GA service** as of April 2026 and is only available in
   `us-east-1` and `us-east-2`. The owner must confirm region and DSQL availability before
   Terraform is written. An RDS Postgres fallback design is provided below.

This proposal translates the 0019 architecture into a concrete Terraform module structure,
resolves all gaps, and documents every open question that requires owner input.

---

## Assessment of Proposal 0019

### What remains valid

- App Runner for both services — still the right call for a low-traffic internal tool.
  No VPC, no ALB, no ECS cluster overhead.
- Aurora DSQL cost model — still the cheapest option **if** it is available in the target
  region and the required code changes (IAM token auth, 3 000-row batch limit) are acceptable.
- SSM Parameter Store for secrets — still appropriate; Standard parameters are free.
- ECR for container images — unchanged.
- Route 53 — unchanged.

### What has changed or needs refinement

| Topic | 0019 position | Revised position |
|---|---|---|
| IaC toolchain | AWS CDK (TypeScript) | **Terraform** (owner requirement) |
| DSQL availability | Assumed GA everywhere | **Limited GA; region must be confirmed** |
| YAML config files | Not addressed | Must mount config via SSM + init script, or bake into image |
| `migrationsRun: true` | Run migrations as a CI pre-deploy step | Auto-migration on start is fine for DSQL DDL isolation; see §Migration Strategy |
| Dockerfile | Described in prose | Specced in full below |
| CDK stack split | database / backend / frontend / dns | Terraform module split: `ecr`, `apprunner`, `rds` (or `dsql`), `dns`, `iam` |

### Aurora DSQL vs RDS — revised recommendation

0019 chose Aurora DSQL for scale-to-zero economics. That analysis is still correct **if** DSQL
is available in the target region. However, DSQL is in limited GA as of this writing and
carries meaningful implementation risk:

- IAM token refresh must be implemented in the NestJS `DataSource` factory.
- The 3 000-row per-transaction DML limit requires chunking in `SyncService`.
- No FK enforcement may mask data integrity bugs during development.
- DDL/DML transaction isolation is a subtle constraint that will affect future migrations.

**This proposal designs for RDS (`db.t4g.micro` PostgreSQL 16, Single-AZ) as the safe
default**, with Aurora DSQL retained as an alternative. At ~$13/mo vs ~$2–5/mo, the $8–11/mo
premium is a reasonable trade-off for eliminating four non-trivial code changes and a
GA-availability risk. The owner must make this call (see Open Questions).

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                           Internet                              │
└────────────────────────┬────────────────────────────────────────┘
                         │
                 ┌───────▼────────┐
                 │  Route 53 DNS  │  fragile.internal.example.com
                 └───────┬────────┘
                         │
           ┌─────────────┴──────────────┐
           │                            │
  ┌────────▼──────────┐      ┌──────────▼──────────┐
  │  App Runner        │      │  App Runner          │
  │  frontend          │      │  backend             │
  │  (Next.js 16)      │      │  (NestJS 11)         │
  │  Port 3000         │      │  Port 3001           │
  └────────────────────┘      └──────────┬──────────┘
                                         │
                              ┌──────────▼──────────┐
                              │  RDS PostgreSQL 16   │
                              │  db.t4g.micro        │
                              │  Single-AZ           │
                              │  (in VPC)            │
                              └──────────────────────┘

  ┌─────────────────────────────────────────────────┐
  │  Supporting services (no traffic path)           │
  │  ECR (backend repo + frontend repo)              │
  │  SSM Parameter Store (all secrets + config)      │
  │  IAM roles (App Runner task roles)               │
  │  CloudWatch Logs (both services)                 │
  │  AWS Budgets (cost alert)                        │
  └─────────────────────────────────────────────────┘
```

### Networking

RDS requires a VPC. The minimal viable VPC for this workload is:

- 1 VPC (`10.0.0.0/16`)
- 2 private subnets in 2 AZs (required for RDS subnet group, even for Single-AZ)
- No public subnets, no NAT Gateway (App Runner accesses RDS via VPC connector)
- 1 VPC connector attached to the **backend** App Runner service only
- Security group on RDS: inbound 5432 from the App Runner VPC connector security group only

> **Cost impact of the VPC:** No hourly charge for VPC, subnets, or security groups.
> The VPC connector for App Runner costs ~$0.01/hr (~$7/mo). This is the main additional
> cost vs the DSQL path, but it eliminates the IAM token auth complexity and removes the
> DSQL GA-availability risk.

The **frontend** App Runner service does **not** need a VPC connector — it calls the backend
over the public App Runner URL.

### Sizing

| Service | Config | Rationale |
|---|---|---|
| Backend App Runner | 0.25 vCPU / 0.5 GB RAM, min 0 instances | Handles sync cron + API; paused when idle |
| Frontend App Runner | 0.25 vCPU / 0.5 GB RAM, min 0 instances | SSR pages; cold start acceptable for internal tool |
| RDS | `db.t4g.micro`, 20 GB gp3, Single-AZ | ~5 GB data, low query volume; ~$13/mo |

### Cost Estimate (RDS path, us-east-1, no Free Tier)

| Service | Est. Cost/mo |
|---|---|
| App Runner — backend | ~$3–6 |
| App Runner — frontend | ~$2–4 |
| App Runner VPC connector | ~$7 |
| RDS db.t4g.micro Single-AZ | ~$13 |
| ECR (2 repos, ~300 MB each) | ~$0.06 |
| SSM Parameter Store (Standard) | $0 |
| Route 53 (1 zone + queries) | ~$1 |
| CloudWatch Logs | ~$0.50 |
| Data transfer | ~$1 |
| **Total** | **~$27–32/mo** |

This is roughly double the DSQL estimate ($9–16/mo) but eliminates all DSQL-specific
code changes and the GA-availability uncertainty.

---

## Environment Variables

### Complete variable inventory

Every variable the application reads, where it comes from in production, and how it is
injected into the App Runner service.

| Variable | Service | Source | Notes |
|---|---|---|---|
| `DB_HOST` | backend | SSM `/fragile/prod/DB_HOST` | RDS endpoint, e.g. `fragile.abc123.us-east-1.rds.amazonaws.com` |
| `DB_PORT` | backend | hardcoded `5432` in task env | Not a secret; set as App Runner plain env var |
| `DB_USERNAME` | backend | SSM `/fragile/prod/DB_USERNAME` | |
| `DB_PASSWORD` | backend | **Secrets Manager** `/fragile/prod/db-password` | Sensitive — use Secrets Manager, not SSM |
| `DB_DATABASE` | backend | hardcoded `fragile` in task env | Set as App Runner plain env var |
| `JIRA_BASE_URL` | backend | SSM `/fragile/prod/JIRA_BASE_URL` | e.g. `https://your-org.atlassian.net` |
| `JIRA_USER_EMAIL` | backend | SSM `/fragile/prod/JIRA_USER_EMAIL` | |
| `JIRA_API_TOKEN` | backend | **Secrets Manager** `/fragile/prod/jira-api-token` | Sensitive |
| `FRONTEND_URL` | backend | hardcoded to frontend App Runner URL | Set after frontend service is created; see §Circular Dependency |
| `PORT` | backend | hardcoded `3001` in task env | |
| `TIMEZONE` | backend | SSM `/fragile/prod/TIMEZONE` | e.g. `Australia/Sydney`; defaults to `UTC` |
| `BOARD_CONFIG_FILE` | backend | SSM `/fragile/prod/BOARD_CONFIG_FILE` | Absolute path inside container; see §YAML Config Files |
| `ROADMAP_CONFIG_FILE` | backend | SSM `/fragile/prod/ROADMAP_CONFIG_FILE` | Absolute path inside container |
| `NEXT_PUBLIC_API_URL` | frontend | hardcoded to backend App Runner URL | Set at build time or as App Runner env var |
| `NEXT_PUBLIC_API_BASE_URL` | frontend | hardcoded to backend App Runner URL | Same as above; both must be set (frontend reads either) |

> **Secrets Manager vs SSM:** Only `DB_PASSWORD` and `JIRA_API_TOKEN` are placed in Secrets
> Manager. All other values are non-sensitive and use free SSM Standard Parameters. App Runner
> supports pulling from both services natively via its `secrets` configuration block.

### YAML Config Files — container strategy

`YamlConfigService` reads `config/boards.yaml` and `config/roadmap.yaml` from the filesystem
at `process.cwd()` (i.e. `/app/config/` inside the container). There are two viable approaches:

**Option A — Bake YAML files into the Docker image (recommended)**
Copy `config/boards.yaml` and `config/roadmap.yaml` into the image during `docker build`.
Pros: zero runtime complexity; files are version-controlled. Cons: updating config requires
a new image build and deploy.

**Option B — Store YAML content in SSM and write to filesystem at container start**
Add an entrypoint script that fetches the YAML content from SSM parameters and writes the
files before `node dist/main` is executed.
Pros: config changes without a full redeploy. Cons: requires an entrypoint wrapper and
the backend IAM task role needs `ssm:GetParameter` on two extra parameters.

Both options are consistent with the existing application design. **Option A is recommended
for the initial implementation** — the YAML files are already committed to the repository
and are effectively part of the deployment artefact. Option B can be added later if the
owner needs zero-downtime config updates without image rebuilds.

### Circular dependency: FRONTEND_URL / NEXT_PUBLIC_API_URL

The backend needs the frontend's URL (for CORS) and the frontend needs the backend's URL
(for API calls). App Runner service URLs are generated at creation time and are not known
in advance.

**Resolution:** Use custom domain names via Route 53 from the outset. The Terraform plan
creates both App Runner services with custom domains before either service needs to reference
the other. The env vars are set to the custom domain names, which are stable.

If Route 53 / custom domains are not being used, the workaround is a two-pass deploy:
1. Create both services with placeholder URLs.
2. Update env vars once both service URLs are known.
This is operationally awkward and is the primary reason to use custom domains.

---

## Required Application Changes (pre-Terraform)

These changes must be merged before the Terraform infrastructure is provisioned. They are
implementation tasks, not Terraform tasks, but they gate the deployment.

| Change | File(s) | Complexity |
|---|---|---|
| Add `frontend/Dockerfile` | new file | Small |
| Add `backend/Dockerfile` | new file | Small |
| Add `output: 'standalone'` to `next.config.mjs` | `frontend/next.config.mjs` | Trivial |
| Confirm YAML config bake-in works from `/app/config/` inside container | `backend/Dockerfile` | Trivial |
| (If DSQL chosen) Replace static DB password with IAM token factory | `backend/src/data-source.ts`, `app.module.ts` | Small |
| (If DSQL chosen) Add `@aws-sdk/dsql-signer` dependency | `backend/package.json` | Trivial |
| (If DSQL chosen) Chunk bulk upserts ≤500 rows in `SyncService` | `backend/src/sync/sync.service.ts` | Small |

---

## Terraform Module Structure

All Terraform lives under `infra/terraform/`. No CDK. No SAM.

```
infra/
└── terraform/
    ├── main.tf                  # Root module: calls child modules, sets providers
    ├── variables.tf             # Input variables (region, domain name, image tags, etc.)
    ├── outputs.tf               # Root outputs (service URLs, ECR repo URIs)
    ├── terraform.tfvars.example # Example values file — committed; actual .tfvars gitignored
    ├── versions.tf              # required_providers, terraform version constraint
    │
    ├── modules/
    │   ├── ecr/                 # ECR repositories (backend + frontend)
    │   │   ├── main.tf
    │   │   ├── variables.tf
    │   │   └── outputs.tf
    │   │
    │   ├── iam/                 # IAM roles and policies
    │   │   ├── main.tf          # App Runner task roles, ECR access role, build role
    │   │   ├── variables.tf
    │   │   └── outputs.tf
    │   │
    │   ├── network/             # VPC, subnets, security groups, VPC connector
    │   │   ├── main.tf
    │   │   ├── variables.tf
    │   │   └── outputs.tf
    │   │
    │   ├── rds/                 # RDS PostgreSQL instance + subnet group + parameter group
    │   │   ├── main.tf
    │   │   ├── variables.tf
    │   │   └── outputs.tf
    │   │
    │   ├── secrets/             # Secrets Manager secrets + SSM parameters
    │   │   ├── main.tf          # Creates secret resources; values set out-of-band
    │   │   ├── variables.tf
    │   │   └── outputs.tf
    │   │
    │   ├── apprunner/           # Both App Runner services
    │   │   ├── main.tf          # backend service + frontend service
    │   │   ├── variables.tf
    │   │   └── outputs.tf
    │   │
    │   └── dns/                 # Route 53 zone + A records + App Runner custom domains
    │       ├── main.tf
    │       ├── variables.tf
    │       └── outputs.tf
    │
    └── environments/
        ├── prod/
        │   ├── main.tf          # env-level module composition
        │   ├── variables.tf
        │   ├── outputs.tf
        │   └── backend.tf       # S3 + DynamoDB remote state config
        └── staging/             # optional — mirror of prod with smaller sizing
            └── ...
```

### Module responsibilities

**`ecr/`**
- One ECR private repository: `fragile/backend`
- One ECR private repository: `fragile/frontend`
- Lifecycle policy: expire untagged images after 7 days
- Output: both repository URIs (consumed by `apprunner/` module)

**`iam/`**
- `fragile-apprunner-build-role` — trusted by `build.apprunner.amazonaws.com`; used by App
  Runner to pull images from ECR on service creation/update
- `fragile-backend-task-role` — trusted by `tasks.apprunner.amazonaws.com`; grants
  `ssm:GetParameters` on `/fragile/prod/*` and `secretsmanager:GetSecretValue` on the two
  Secrets Manager secrets; also grants `logs:CreateLogGroup`, `logs:PutLogEvents`
- `fragile-frontend-task-role` — trusted by `tasks.apprunner.amazonaws.com`; grants
  `logs:*` only (frontend has no AWS service dependencies)
- Output: all role ARNs

**`network/`**
- VPC `10.0.0.0/16`
- Private subnet A: `10.0.1.0/24` (AZ a)
- Private subnet B: `10.0.2.0/24` (AZ b)
- Security group `fragile-rds-sg`: inbound TCP 5432 from `fragile-apprunner-connector-sg`
- Security group `fragile-apprunner-connector-sg`: used by App Runner VPC connector
- App Runner VPC connector (associated with both private subnets)
- Output: VPC ID, subnet IDs, security group IDs, VPC connector ARN

**`rds/`**
- `aws_db_subnet_group` spanning both private subnets
- `aws_db_parameter_group`: PostgreSQL 16 family, default parameters
- `aws_db_instance`: engine `postgres`, version `16.x`, `db.t4g.micro`, `allocated_storage = 20`,
  `storage_type = gp3`, `multi_az = false`, `deletion_protection = true`,
  `skip_final_snapshot = false` (final snapshot on destroy)
- Database credentials sourced from Secrets Manager (Terraform data source, not plain text)
- Output: RDS endpoint hostname

**`secrets/`**
- `aws_secretsmanager_secret` for `DB_PASSWORD` (value set out-of-band, not in Terraform state)
- `aws_secretsmanager_secret` for `JIRA_API_TOKEN` (value set out-of-band)
- `aws_ssm_parameter` for all non-sensitive variables: `DB_HOST`, `DB_USERNAME`, `JIRA_BASE_URL`,
  `JIRA_USER_EMAIL`, `TIMEZONE`, `BOARD_CONFIG_FILE`, `ROADMAP_CONFIG_FILE`
- Output: secret ARNs, parameter ARNs

> **Important:** Secret *values* are **not** stored in Terraform. The `aws_secretsmanager_secret`
> resource creates the secret shell with `lifecycle { ignore_changes = [secret_string] }`.
> The operator sets the actual secret value via the AWS console or AWS CLI after `terraform apply`.
> This ensures secrets never appear in Terraform state files.

**`apprunner/`**
- Backend App Runner service:
  - Image: ECR URI (passed as variable; updated by CI, not Terraform)
  - CPU: `256` (0.25 vCPU), Memory: `512` MB
  - `auto_scaling_configuration`: `min_size = 0`, `max_size = 3`
  - Health check: HTTP GET `/health` on port 3001
  - VPC connector: attached (for RDS access)
  - Environment variables: `PORT=3001`, `DB_PORT=5432`, `DB_DATABASE=fragile`
  - Secrets (from SSM + Secrets Manager): `DB_HOST`, `DB_USERNAME`, `DB_PASSWORD`,
    `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_TOKEN`, `TIMEZONE`,
    `BOARD_CONFIG_FILE`, `ROADMAP_CONFIG_FILE`, `FRONTEND_URL`
- Frontend App Runner service:
  - Image: ECR URI (passed as variable)
  - CPU: `256`, Memory: `512` MB
  - `auto_scaling_configuration`: `min_size = 0`, `max_size = 3`
  - Health check: HTTP GET `/` on port 3000
  - No VPC connector
  - Environment variables: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_API_BASE_URL`
    (set to backend custom domain URL)
- Output: both service ARNs and default service URLs

**`dns/`**
- `aws_route53_zone` (or data source if zone already exists)
- `aws_route53_record` for `dashboard.example.com` → frontend App Runner custom domain
- `aws_route53_record` for `dashboard-api.example.com` → backend App Runner custom domain
- `aws_apprunner_custom_domain_association` for both services
- Output: DNS validation records (if new zone), final service URLs

### Terraform state

Remote state in S3 + DynamoDB locking:

```
# environments/prod/backend.tf
terraform {
  backend "s3" {
    bucket         = "fragile-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "fragile-terraform-locks"
    encrypt        = true
  }
}
```

The S3 bucket and DynamoDB table are bootstrapped once manually (or via a `bootstrap/`
Terraform configuration) before the first `terraform apply`.

### Provider versions (in `versions.tf`)

```hcl
terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }
}
```

---

## Migration Strategy

`app.module.ts` sets `migrationsRun: true`, which means TypeORM automatically runs pending
migrations on every container start-up. This is convenient and **works correctly with
standard RDS PostgreSQL** — TypeORM wraps each migration in its own transaction.

For the RDS path: no change required. Migrations run on every cold start; they are idempotent
and fast once all migrations have been applied.

For the DSQL path: the DDL/DML transaction isolation constraint is automatically satisfied
because each TypeORM migration runs in its own `queryRunner` transaction. The only risk is
a migration that manually mixes DDL and DML in a single `queryRunner` transaction — this
must be audited before DSQL deployment.

---

## CI/CD Integration (not Terraform, but necessary context)

The Terraform modules provision infrastructure. Image deployment is a CI concern. The
recommended GitHub Actions flow:

```
On push to main:
  1. Build backend Docker image → push to ECR with tag = git SHA
  2. Build frontend Docker image → push to ECR with tag = git SHA
  3. Update App Runner backend service image to new ECR tag
     (aws apprunner update-service or terraform apply -var image_tag=<sha>)
  4. Update App Runner frontend service image to new ECR tag
```

App Runner handles rolling deployment — it will not cut traffic to the new version until
its health check passes.

---

## Alternatives Considered

### Alternative A — Keep CDK (TypeScript)

0019 proposed CDK because it is TypeScript-consistent with the rest of the codebase. The
owner has specified Terraform. CDK would still be a valid technical choice but this proposal
does not pursue it.

### Alternative B — ECS Fargate + ALB instead of App Runner

ECS Fargate gives more control (sidecar containers, task placement, target tracking scaling)
but adds: ALB (~$16/mo), ECS cluster management, and task definition management. For a
low-traffic internal tool this is over-engineered. App Runner is the right call.

### Alternative C — Single EC2 instance (t4g.small)

Run both services + PostgreSQL on one `t4g.small` (~$12/mo). Zero cold starts, simplest
possible setup. Rejected because: no managed database (backups, patching), manual deployment
process, no horizontal scale path, single point of failure.

### Alternative D — Aurora DSQL (as proposed in 0019)

Still viable if: (a) DSQL is available in the target region, and (b) the owner is willing
to implement the required code changes (IAM token auth, batch chunking). This proposal
retains RDS as the default and documents DSQL as an explicit alternative that requires owner
confirmation (see Open Questions §1).

### Alternative E — Aurora Serverless v2

Costs ~$10–20/mo at minimum ACU floor (0.5 ACU always running). More expensive than both
`db.t4g.micro` and DSQL for this workload. No meaningful advantage over RDS for a
single-writer, low-query-volume application. Ruled out.

---

## Impact Assessment

| Area | Impact | Notes |
|---|---|---|
| Database | New RDS instance in VPC | Requires network module; no schema changes |
| API contract | None | No application code changes for RDS path |
| Frontend | New Dockerfile required | `output: 'standalone'` config change |
| Backend | New Dockerfile required | YAML files baked into image |
| Tests | No change | Infra is isolated from application tests |
| Jira API | No new calls | No change |
| Cost | ~$27–32/mo (RDS) or ~$9–16/mo (DSQL) | Excludes one-time setup costs |
| Ops complexity | Low | App Runner manages container lifecycle |

---

## Open Questions

These must be answered by the owner before Terraform implementation begins.

### 1. Aurora DSQL or RDS PostgreSQL?

**Decision needed:** Which database to use.

- **RDS `db.t4g.micro`** — ~$27–32/mo total, no code changes, works today, proven.
- **Aurora DSQL** — ~$9–16/mo total, requires 4 non-trivial code changes, limited GA
  availability (confirm `us-east-1` / `us-east-2` only), carries some GA-stability risk.

This is a $15–20/mo saving vs ~2–3 days of additional engineering work plus ongoing
operational novelty. For an internal tool the RDS path is recommended, but the owner
decides.

### 2. Target AWS region?

Affects: RDS AZ selection, App Runner availability, DSQL availability (if chosen),
Route 53 latency routing (if ever added). Likely `us-east-1` based on 0019, but confirm.

### 3. Domain name for custom domains?

The `dns/` module needs a Route 53 zone and two hostnames. Examples:
- `dashboard.internal.example.com` (frontend)
- `dashboard-api.internal.example.com` (backend)

If no custom domain is wanted, the circular dependency between frontend and backend URLs
must be resolved manually (two-pass deploy). Custom domains are strongly recommended.

### 4. Is a Route 53 hosted zone already provisioned for the target domain?

If yes, the `dns/` module uses a `data "aws_route53_zone"` lookup instead of creating a
new one. If no, a new zone is created (~$0.50/mo).

### 5. YAML config file strategy — bake-in or SSM-injected?

Option A (bake-in, recommended): `boards.yaml` and `roadmap.yaml` are copied into the
Docker image at build time. Config changes require a new image build.

Option B (SSM-injected): An entrypoint script writes the YAML from SSM parameters before
the app starts. Config changes can be applied via AWS console without a redeploy.

The current `config/boards.yaml` and `config/roadmap.yaml` files are already committed to
the repository, making Option A natural. Confirm if the owner needs Option B.

### 6. Terraform state bootstrap — new S3 bucket or existing?

A `fragile-terraform-state` S3 bucket and `fragile-terraform-locks` DynamoDB table are
needed before the first apply. Should these be created manually, or should a `bootstrap/`
Terraform configuration be included in scope?

### 7. Should a `staging` environment be provisioned?

The module structure supports it (`environments/staging/`). A staging environment roughly
doubles cost. For a small internal tool a single `prod` environment is usually sufficient.

### 8. AWS account and credential management

How does the CI pipeline authenticate to AWS? Options: IAM user with long-lived keys (not
recommended), OIDC-based GitHub Actions role (recommended), or existing CI credentials.
The Terraform IAM module will create the App Runner roles but the CI assume-role ARN must
be known.

---

## Acceptance Criteria

The Terraform implementation is complete when all of the following are true:

### Infrastructure
- [ ] `terraform init && terraform plan` executes without error in `environments/prod/`
- [ ] `terraform apply` from a clean account creates all resources without manual steps
- [ ] Both App Runner services are reachable at their custom domain names (or default URLs)
- [ ] Frontend successfully calls backend API (CORS configured correctly)
- [ ] Backend successfully connects to the database (health check passes at `/health`)
- [ ] Terraform state is stored in S3 with DynamoDB locking
- [ ] `terraform destroy` tears down all resources cleanly (RDS final snapshot is created)

### Security
- [ ] No secrets (DB password, Jira API token) appear in Terraform state or `.tfvars` files
- [ ] RDS is not publicly accessible (`publicly_accessible = false`)
- [ ] RDS security group only allows inbound 5432 from the App Runner VPC connector SG
- [ ] App Runner task roles follow least-privilege (backend role cannot access frontend secrets and vice versa)
- [ ] `.tfvars` files containing real values are listed in `.gitignore`

### Observability
- [ ] Both App Runner services write logs to CloudWatch Log Groups
- [ ] An AWS Budget alert is configured at $40/mo (20% above expected maximum)

### Documentation
- [ ] `infra/terraform/README.md` documents: prerequisites, first-time apply steps, how to update image tags, how to set secret values
- [ ] `terraform.tfvars.example` is committed with placeholder values for all required variables

### Application
- [ ] Backend Dockerfile builds successfully and passes health check at `/health`
- [ ] Frontend Dockerfile builds successfully with `output: 'standalone'` in `next.config.mjs`
- [ ] YAML config files (`boards.yaml`, `roadmap.yaml`) are present inside the backend container at the expected path
- [ ] TypeORM migrations run successfully on first container start against the RDS instance

---

## Appendix: Dockerfile Specifications

These are implementation-ready specs for the Dockerfiles that must be added before
Terraform provisioning. They are not Terraform, but they are required artefacts.

### `backend/Dockerfile`

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
# Bake YAML config into the image (Option A)
COPY config/ ./config/
EXPOSE 3001
CMD ["node", "dist/main"]
```

### `frontend/Dockerfile`

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# next.config.mjs must have output: 'standalone' for this to produce server.js
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

> The frontend Dockerfile requires `output: 'standalone'` in `next.config.mjs`. Without it,
> `.next/standalone/` is not produced and the image build will fail at the `COPY` step.
