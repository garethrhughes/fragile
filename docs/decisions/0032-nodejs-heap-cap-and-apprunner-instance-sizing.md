# 0032 — Node.js Heap Cap and ECS Fargate Task Sizing for Memory Management

**Date:** 2026-04-23
**Status:** Accepted (platform updated — see ADR-0043)
**Deciders:** Architect Agent

## Context

The backend service was originally configured with 512 mCPU / 1024 MB, first on App Runner
and subsequently on ECS Fargate (ADR-0043). During production operation, the process was
being killed with exit code 137 (SIGKILL from the OOM killer) when processing large boards.
The root cause is that Node.js / V8 does not trigger a garbage collection cycle until heap
usage approaches its internal limit, which defaults to ~1.5 GB on 64-bit systems. If the
process memory ceiling imposed by the container runtime (the Fargate task's hard limit) is
reached before V8's internal GC threshold, the process is killed rather than collecting and
reclaiming memory.

A second related issue is that sprint report generation was triggered concurrently for all
boards after each sync, creating a peak memory spike when multiple boards' reports were
computed simultaneously on a fresh deployment.

---

## Options Considered

### Option A — Raise instance memory only (no heap cap)

- Increase ECS Fargate task to 2 GB and rely on V8's default GC behaviour.
- **Pros:** No code change required.
- **Cons:** V8's default GC threshold may still lag behind actual memory usage on large
  boards; the OOM-kill race condition persists, just at a higher memory level. The 2 GB
  limit is also the maximum memory for the 1 vCPU Fargate task definition.

### Option B — Set `--max-old-space-size` below the container limit (selected for backend)

- Cap the Node.js old-generation heap at 1800 MB, leaving 248 MB headroom below the
  2048 MB container ceiling for OS overhead, off-heap buffers, and the new-generation heap.
- **Pros:** V8 is forced to garbage-collect before the process is killed by the OOM killer;
  the process degrades gracefully (slower, not dead); the heap cap is self-documenting in
  the Dockerfile `CMD`.
- **Cons:** If a single metric calculation genuinely requires more than 1800 MB of heap,
  the process will throw `JavaScript heap out of memory` instead of being SIGKILL'd —
  still a crash, but now with a meaningful error message and stack trace rather than a
  silent exit 137.

### Option C — Reduce per-query memory via TypeORM projection (selected as primary fix)

- Address the root cause: reduce the amount of data loaded into memory per query by
  omitting heavy columns (`summary`, `description`) that are not needed by metric
  calculations. See ADR-0037.
- **Pros:** Directly reduces heap pressure; the process uses less memory regardless of
  instance size.
- **Cons:** Requires auditing and changing every `issueRepo.find()` call in metric services.

---

## Decision

> The backend Dockerfile uses `CMD ["node", "--max-old-space-size=1800", "dist/main"]`
> to cap the V8 old-generation heap at 1800 MB. The ECS Fargate backend task is
> sized at 1024 mCPU / 2048 MB. Sprint report generation after sync is made sequential
> across boards (not concurrent) to avoid peak memory spikes at deployment time.

These three changes are applied together; the heap cap and instance sizing are defensive
measures, while query projection (ADR-0037) is the primary memory reduction.

---

## Rationale

Raising the task size from 1 vCPU/1 GB to 1 vCPU/2 GB provides the headroom needed
for large board syncs. Setting `--max-old-space-size=1800` ensures V8 GCs aggressively
before the container ceiling is hit, converting silent OOM kills into observable heap
errors. Making sprint report generation sequential after sync prevents the compounding
of memory pressure across all boards simultaneously, which was particularly dangerous on
first deployment when all boards' reports are generated in the same window.

---

## Consequences

### Positive

- OOM kills (exit 137) are replaced by in-process heap exhaustion errors with stack traces,
  making failures observable in ECS CloudWatch logs (`/ecs/fragile/backend`).
- Sequential post-sync report generation reduces peak RSS significantly on fresh deployments.
- The task sizing decision is encoded in Terraform (`ecs` module), making it
  reproducible and reviewable via version control.

### Negative / Trade-offs

- 1 vCPU / 2048 MB is the selected Fargate task size for the backend. Cost
  increases roughly 2× compared to the previous 512 mCPU / 1024 MB configuration.
- Sequential sprint report generation increases total post-sync wall time. For 5 boards
  this adds minutes compared to fully concurrent generation. Acceptable given the
  fire-and-forget nature of post-sync report generation.
- If memory usage genuinely exceeds 1800 MB of heap (e.g. a very large Kanban board
  with 10k+ issues), the process will crash with a heap OOM. ADR-0037 (query projection)
  is the mitigation for this scenario.

### Risks

- The 248 MB gap between the heap cap (1800 MB) and container limit (2048 MB) may be
  insufficient if off-heap native buffers (e.g. `pg` wire protocol buffers) are unusually
  large during a sync of many boards simultaneously. Monitor `MemoryUtilization`
  in ECS CloudWatch metrics for the backend service.

---

## Related Decisions

- [ADR-0037](0037-typeorm-column-projection-for-metric-queries.md) — TypeORM column
  projection as the primary memory-reduction technique in metric services
- [ADR-0036](0036-sync-endpoint-fire-and-forget-http-202.md) — Sync endpoint returns
  HTTP 202 and runs fire-and-forget, which is what allows sequential report generation
  without blocking the HTTP response
