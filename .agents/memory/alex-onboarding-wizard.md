---
name: Alex arrival onboarding wizard
description: How freshly-installed workspaces set up their brand via web, and why brand input funnels through a single store.
---

# Alex arrival onboarding (post-install web wizard)

After OAuth install (Order A: install first, then onboard), the OAuth redirect sends the
installer to a token-gated web wizard instead of telling them to type `/alex-update`. The
wizard presents one explicit field per brand attribute (brand voice is the only required
one — the "minimum viable brand") and writes each filled field directly to the tenant
store. There is **no AI/derivation step**.

**Why explicit fields, not freeform:** an earlier version took freeform content samples and
ran a model to *guess* the brand files; the user rejected that and asked for fields that
mirror the Slack `/alex-update` steps. Prefer direct, predictable capture over inference
for brand setup.

**Single-store invariant — the slash command and the wizard are two doors to one store.**
Both write through the same tenant-file update path; input method is decoupled from storage.
Any new "way to set brand" must funnel through that same path, never a parallel writer.
**Why:** one source of truth + one validation point regardless of UI.

**Setup token:** authorizes the wizard to write a specific workspace's files. Same HMAC
scheme as the OAuth CSRF `state` (over `SESSION_SECRET`), purpose-tagged for setup, carries
the team id, ~60-min TTL, timing-safe compare. It is intentionally **replayable within its
TTL** so a user can re-run setup to refine — do not make it single-use without rethinking
that UX.

# SSRF rule (general — no user-URL fetch exists today)

There is currently no server-side fetch of a user-supplied URL in this app (an old
website-ingest feature that had one was removed). **If you ever re-add one** (website
ingest, link preview, webhook test, etc.), it MUST be SSRF-guarded: allow only http/https;
DNS-resolve and reject any private/loopback/link-local/CGNAT/reserved/multicast IP (incl.
cloud metadata `169.254.169.254` and IPv4-mapped IPv6); follow redirects manually and
re-validate every hop. **Why:** a user URL or redirect can otherwise reach internal/metadata
endpoints — flagged critical in a prior review. Residual gap to consider: DNS-rebinding
TOCTOU (connect-by-IP if it matters).
