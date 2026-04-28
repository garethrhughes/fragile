# 0033 — CloudFront Distributions as the Public Entry Point for Both Services

**Date:** 2026-04-23
**Status:** Accepted (platform updated — see ADR-0043)
**Deciders:** Architect Agent

## Context

Both the backend (NestJS) and the frontend (Next.js) need to be reachable via stable
custom domain names (`fragile-api.<domain>` and `fragile.<domain>`). The services run on
ECS Fargate (ADR-0043) behind an internal ALB that is not reachable from the public
internet. A CDN layer is needed to terminate TLS with a customer-owned certificate, enforce
HTTPS, provide a stable hostname, and attach a WAF WebACL. CloudFront reaches the internal
ALB via a **CloudFront VPC Origin** (`aws_cloudfront_vpc_origin`), which allows CloudFront
edge nodes to connect directly to VPC resources without the ALB needing a public IP.

The previous DNS module pointed Route 53 directly at App Runner's ALIAS target. That
approach did not support ACM certificates, WAF attachment, or differential caching
behaviour for static vs dynamic content.

---

## Options Considered

### Option A — ECS Fargate ALB public endpoint without CloudFront

- Make the ALB internet-facing and point Route 53 directly at the ALB DNS name.
- **Pros:** No CloudFront resources; simpler Terraform.
- **Cons:** Cannot attach a CloudFront-scoped WAF WebACL; ACM certificate must be in the
  deployment region; no edge caching for static assets; ALB would be publicly reachable,
  requiring Network ACLs or SG rules for IP allowlisting instead of WAF. Ruled out.

### Option B — CloudFront VPC Origin in front of both services (selected)

- A `cdn` Terraform module creates two CloudFront distributions (one per service), issues
  ACM certificates in `us-east-1` (required by CloudFront), validates them via Route 53
  DNS records, and attaches the WAF WebACL ARN from the `waf` module.
- A single `aws_cloudfront_vpc_origin` resource is created pointing at the internal ALB
  ARN. Both distributions share this VPC Origin. Each distribution injects a custom
  `X-Fragile-Service` header (`backend` or `frontend`) that the ALB listener rules use
  to route to the appropriate target group.
- For the **backend**, caching is fully disabled via the `CachingDisabled` managed policy.
  The `AllViewerExceptHostHeader` origin request policy forwards all headers/query-strings/
  cookies but substitutes the ALB origin hostname as the `Host` header (the ALB returns
  404 for requests where the `Host` header doesn't match its configured hostname).
- For the **frontend**, static assets under `/_next/static/*` use the `CachingOptimized`
  managed policy (1-year TTL, gzip/brotli). All other paths use `CachingDisabled`.
- Route 53 ALIAS records point to the CloudFront distribution domain names.
- **Pros:** WAF attachment is supported; TLS configuration is fully controlled; static
  asset caching reduces ECS task load and improves page-load performance; the internal
  ALB does not need a public IP; stable entry point for all future edge-layer changes.
- **Cons:** ACM certificates must be in `us-east-1` regardless of the deployment region
  (`ap-southeast-2`); requires a second provider alias in Terraform. CloudFront adds a
  small amount of latency for non-cached requests (typically <5 ms from Australia to
  AWS edge PoPs).

### Option C — Application Load Balancer (public-facing)

- Make the existing ALB internet-facing.
- **Pros:** ALB WAF support in any region; familiar setup.
- **Cons:** The ALB is currently internal and managed by the ECS Express Gateway
  infrastructure; making it internet-facing would require significant networking changes
  and would bypass the CloudFront VPC Origin pattern. Ruled out.

---

## Decision

> Both the backend and frontend ECS Fargate services are fronted by CloudFront distributions
> managed by a `cdn` Terraform module. Both distributions share a single CloudFront VPC Origin
> (`aws_cloudfront_vpc_origin`) pointing at the internal ALB. Each distribution injects an
> `X-Fragile-Service` custom header that the ALB listener rules use to route to the correct
> target group. The backend distribution uses no caching and the `AllViewerExceptHostHeader`
> origin request policy to forward all request attributes while presenting the ALB origin URL
> as the `Host` header. The frontend distribution caches `/_next/static/*` with a 1-year TTL
> and disables caching for all other paths. Route 53 ALIAS records point to the CloudFront
> domain names.

---

## Rationale

CloudFront VPC Origin is the correct pattern for an internal ALB: it provides edge-layer TLS
termination, WAF attachment, and static-asset caching without requiring the ALB to be
internet-facing. The `AllViewerExceptHostHeader` policy is essential: the ALB returns 404
for requests where the `Host` header doesn't match its own hostname; this policy substitutes
the ALB origin hostname while preserving all other request attributes. The `X-Fragile-Service`
custom header is the routing discriminator that allows both services to share one ALB. Using
the `CachingDisabled` managed policy for API traffic means CloudFront is purely a pass-through
for dynamic requests, preserving API semantics.

The differential caching strategy for the frontend (cached statics, uncached pages) is
appropriate because Next.js includes a content hash in `/_next/static/` paths, making
long-lived caching safe, while server-rendered pages must never be served stale.

---

## Consequences

### Positive

- WAF IP allowlist (ADR-0034) can be attached to both distributions.
- TLS 1.2+ is enforced at the CloudFront layer; the ECS task containers do not terminate TLS.
- Static asset caching reduces origin requests and improves perceived performance for
  repeat visitors.
- The DNS module is simplified: it creates ALIAS records pointing to CloudFront
  domain names.
- The internal ALB has no public IP; all public internet traffic enters via CloudFront edge.

### Negative / Trade-offs

- ACM certificate issuance requires the `us-east-1` provider alias in Terraform. Any
  engineer applying Terraform must have IAM permissions in both `ap-southeast-2` and
  `us-east-1`.
- CloudFront distributions take 5–15 minutes to deploy globally; `terraform apply` runs
  will be slow during initial provisioning.
- CloudFront adds a per-request cost (approximately $0.009–$0.012 per 10k HTTPS requests
  from Australia). For an internal tool with low traffic this is negligible.

### Risks

- The `AllViewerExceptHostHeader` origin request policy is identified by a hardcoded AWS
  managed policy UUID (`b689b0a8-...`). If AWS ever changes this UUID, the Terraform
  configuration will fail to find the policy. This should be monitored at each Terraform
  upgrade cycle.
- CloudFront caches 5xx responses for a short period by default. If the backend enters an
  error state, cached error responses may briefly be served to users.

---

## Related Decisions

- [ADR-0034](0034-cloudfront-waf-ip-allowlist.md) — WAF WebACL attached to these
  CloudFront distributions as the sole access-control layer
- [ADR-0035](0035-nat-gateway-for-apprunner-outbound-internet.md) — NAT Gateway that
  allows ECS backend tasks in private subnets to reach Jira via the public internet
- [ADR-0043](0043-ecs-fargate-replaces-app-runner.md) — ECS Fargate as the compute
  platform that this CloudFront / VPC Origin topology fronts
