# Security Overview

Trackarr is built with security as a foundational principle, not an afterthought. This page provides an overview of the security architecture.

## Security Layers

| Layer | Protection |
|-------|------------|
| **Authentication** | Zero-Knowledge proofs, PoW anti-abuse, session encryption, CSRF protection |
| **Database** | SCRAM-SHA-256 auth, TLS, prepared statements, connection pool limits |
| **Redis** | Password auth, command restrictions, memory limits |
| **Network** | Rate limiting, auto IP bans, attack pattern detection |
| **Privacy** | SHA-256 hashed IPs, no raw IP persistence, minimal logging |

## Rate Limits

Trackarr implements distributed rate limiting to prevent abuse:

| Endpoint | Limit | Action on Abuse |
|----------|-------|-----------------|
| Public API | 100/min | 100+ req/10s → auto-block |
| Mutations | 10/min | Progressive penalties |
| Auth | 5/5min | IP blacklisted after violations |
| Tracker | 200/min | Distributed sliding window |

## IP Privacy

User IP addresses are **never stored in plaintext**. Instead:

1. IPs are hashed using SHA-256 with a secret salt
2. Only the hash is stored for rate limiting and abuse detection
3. Hashes cannot be reversed to obtain the original IP
4. Logs are minimal and do not contain identifying information

## Attack Detection

The system automatically detects and blocks:

- SQL injection attempts
- XSS (Cross-Site Scripting) attacks
- Path traversal attempts
- Brute force authentication attempts
- Automated scraping and enumeration

## Learn More

- [Zero-Knowledge Authentication](/guide/zero-knowledge-auth) — How passwords are never transmitted
- [Panic Mode](/guide/panic-mode) — Emergency data encryption

---

## Login history

Every attempt to open a session is recorded — successful or not — with the
method that was used, the browser, and a hash of the address.

Members read their own at **Settings → Security → Login history**. Staff read
any member's from that member's profile page.

### Failures are the interesting half

There is **no per-account lockout** on this site. Throttling is entirely per IP,
so an attempt spread across addresses meets nothing at all. This table is what
makes such an attempt visible afterwards even though nothing stopped it at the
time — a run of refusals against one account, from addresses that differ, is a
shape worth recognising.

### What the address hash can and cannot tell you

It goes through the same daily-rotating salt as every other IP in this system,
which means **two rows are comparable only within the same day**. Two different
hashes a week apart may well be the same address.

That is enough for the question staff actually ask — "is this account being used
from several places right now", the shape of account sharing on an invite-only
tracker — and not enough for a long-range history. Both views say so rather than
letting a reader draw a conclusion from noise. The moderator view computes the
count of distinct addresses **on the most recent day only**, for the same
reason.

### Retention

`login_event_retention_days` — **default 90**, `0` keeps them indefinitely.
Shorter than the [audit log](./audit-log.md)'s year because this is a
high-volume table and the questions it answers are about the recent past. The
period is published on the public `/privacy` page.
