# 0043 — ECS Fargate Replaces App Runner as Compute Platform

**Date:** 2026-04-28
**Status:** Accepted
**Deciders:** Architect Agent
**Proposal:** [0039 — Migrate from App Runner to ECS Express Mode](../proposals/0039-migrate-from-app-runner-to-ecs-express.md)
**Supersedes:** ADRs 0032, 0033, 0034, 0035, 0036, 0038 (platform references updated in-place; this ADR records the migration decision)

---

## Context

The project was originally deployed on AWS App Runner (proposed in infra proposal 0027).
App Runner was chosen for its operational simplicity: no VPC networking to configure,
no load balancer to manage, automatic scale-to-zero, and HTTPS termination built in.

Several constraints emerged during operation that App Runner could not satisfy:

1. **VPC connectivity** — The backend must reach RDS PostgreSQL inside a private VPC
   subnet. App Runner's VPC connector feature provides outbound VPC access but is an
   add-on, not the default. The connector also cannot easily be combined with a custom
   domain at CloudFront without additional workarounds.

2. **Memory isolation** — App Runner's instance sizing options are coarse (0.5–4 vCPU,
   1–12 GB RAM) and priced per second. The OOM kill problem (ADR-0040) required
   fine-grained control over task memory that App Runner did not surface cleanly through
   Terraform.

3. **Scale-to-zero latency** — App Runner's scale-to-zero means the first request after
   a cold period triggers a container start (10–30 seconds). With CloudFront's 60-second
   origin timeout (ADR-0033), this left a narrow margin that was routinely violated by
   heavy DORA computation requests.

4. **CloudFront routing** — Routing CloudFront to two App Runner services (backend and
   frontend) required custom domain names on each App Runner service, adding a DNS
   dependency and certificate management overhead.

5. **ECS Express Gateway** — The infrastructure team provisioned an ALB via ECS Express
   Gateway for the VPC. Migrating to ECS Fargate allowed the existing ALB and VPC wiring
   to be reused directly, eliminating the App Runner VPC connector and simplifying the
   network topology.

---

## Decision

> Both the backend (NestJS) and frontend (Next.js) services are deployed as ECS Fargate
> tasks in private VPC subnets. An internal Application Load Balancer routes traffic
> between them. CloudFront uses a **VPC Origin** (`aws_cloudfront_vpc_origin`) pointing
> at the internal ALB, discriminating between services via an `X-Fragile-Service`
> custom header (`backend` | `frontend`). The WAF IP allowlist (ADR-0034) remains on
> the CloudFront distribution and is unchanged.

### Implementation Details

- **ECS cluster** — `fragile-cluster`, provisioned in `infra/terraform/modules/ecs/`.
- **Task definitions** — one per service (`fragile-backend`, `fragile-frontend`). Both
  use `FARGATE` launch type, Linux/X86_64, and run in private subnets.
- **ALB** — looked up via `data "aws_lb"` by tags (`AmazonECSManaged=true`,
  `Project=fragile`) because it was provisioned by ECS Express Gateway infrastructure
  outside the Terraform state.
- **Listener rules** — `X-Fragile-Service: backend` → backend target group; default
  action → frontend target group. Rules placed on the ALB's HTTPS listener (port 443).
- **CloudFront VPC Origin** — `aws_cloudfront_vpc_origin` wraps the internal ALB. Both
  CloudFront cache behaviours (`/api/*` and default) use this single origin.
- **Security groups** — ALB security group allows inbound 443 from the CloudFront
  managed prefix list. ECS task security groups allow inbound from the ALB SG only.
  SG ingress rules are defined in `environments/prod/main.tf` to avoid a circular
  dependency between the `ecs` and `network` modules.
- **Task sizing** — backend: 1024 CPU / 2048 MB; frontend: 512 CPU / 1024 MB.
  `--max-old-space-size=1800` retained on the backend (ADR-0032).
- **CI/CD** — GitHub Actions calls `ecs:UpdateService` with `--force-new-deployment`
  after pushing new images to ECR. ECS rolling deployment handles zero-downtime updates.
- **IAM roles** — `fragile-ecs-execution-role` (pulls ECR, writes CloudWatch Logs),
  `fragile-ecs-task-role` (reads Secrets Manager, invokes Lambda), and
  `fragile-ecs-infrastructure-role` (required by ECS Express Gateway ALB management).
- **Auto-scaling** — not configured in the initial migration. `desired_count = 1` with
  `lifecycle { ignore_changes = [desired_count] }` to allow manual scaling without
  Terraform drift.
- **NAT Gateway** — two public subnets added to support both the NAT Gateway (AZ-a)
  and ALB multi-AZ placement (AZ-a + AZ-b). Private subnet route tables updated to
  route `0.0.0.0/0` through the NAT Gateway (ADR-0035).

---

## Rationale

ECS Fargate on a shared ALB eliminates the scale-to-zero latency problem, provides
fine-grained CPU/memory control, and integrates naturally with the existing VPC and ALB
provisioned by ECS Express Gateway. The CloudFront VPC Origin feature allows CloudFront
to reach the internal ALB directly without any public IP or custom domain on the ALB,
preserving the security posture from the original App Runner design.

The choice of standard `aws_ecs_task_definition` / `aws_ecs_service` resources (rather
than the community ECS Express module proposed in proposal 0039) was made because the
community module's API was not stable at the time of implementation and the standard
resources provide full visibility into all configuration parameters.

---

## Consequences

### Positive

- No scale-to-zero cold-start latency. The CloudFront 60-second origin timeout is no
  longer at risk from container startup.
- Fine-grained task CPU and memory sizing via ECS task definitions.
- The internal ALB is not internet-facing; the only public ingress point is CloudFront.
- ECS rolling deployments provide zero-downtime deploys with automatic health-check
  gating.
- The NAT Gateway's EIP provides a stable, predictable egress IP for Jira API calls.

### Negative / Trade-offs

- ECS Fargate tasks run continuously (`desired_count = 1`), incurring ~$25–35/month
  per task in `ap-southeast-2` even with zero traffic. This is higher than App Runner's
  scale-to-zero cost at low utilisation.
- The Terraform configuration is more complex than App Runner: separate ECS cluster,
  task definitions, services, ALB listener rules, and CloudFront VPC Origin resources
  must all be maintained.
- ALB (`aws_lb`) is looked up by data source rather than owned by this Terraform state,
  creating a soft external dependency. If the ALB is reprovisioned with different tags,
  the `data "aws_lb"` lookup will fail at plan time.

### Risks

- If the ECS Express Gateway ALB is decommissioned by the infrastructure team, all
  traffic routing will break. The long-term mitigation is to provision an owned ALB
  within the Terraform state.
- Auto-scaling is not yet configured. Under sustained load, a single backend task may
  saturate. `desired_count` should be increased manually or auto-scaling added before
  public launch.

---

## Related Decisions

- [ADR-0032](0032-nodejs-heap-cap-and-apprunner-instance-sizing.md) — Node.js heap cap
  and ECS Fargate task sizing
- [ADR-0033](0033-cloudfront-as-public-entry-point.md) — CloudFront + VPC Origin + ALB
  topology
- [ADR-0034](0034-cloudfront-waf-ip-allowlist.md) — WAF IP allowlist unchanged by this
  migration
- [ADR-0035](0035-nat-gateway-for-apprunner-outbound-internet.md) — NAT Gateway enabling
  outbound internet from private ECS tasks
- [ADR-0040](0040-lambda-post-sync-dora-snapshot-computation.md) — Lambda for out-of-
  process DORA computation; memory isolation addressed by ECS task boundaries
- [ADR-0041](0041-postgres-advisory-lock-for-sync-serialisation.md) — Distributed sync
  lock across ECS task instances
