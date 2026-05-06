---
layout: home

hero:
  name: Trackarr
  text: Modern Private BitTorrent Tracker
  tagline: High-performance, security-first tracker with Zero-Knowledge Authentication and Panic Mode encryption.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/florianjs/trackarr
    - theme: alt
      text: Live Demo
      link: https://tracker.florianargaud.com/

features:
  - title: Zero-Knowledge Auth
    details: Your password never leaves your device. All cryptographic operations happen client-side with PBKDF2 and challenge-response.
  - title: Lightning Fast
    details: Redis-powered sub-millisecond peer lookups with PostgreSQL full-text search and optimized concurrent handling.
  - title: Panic Mode
    details: Instant AES-256-GCM encryption of all sensitive data. One click to protect everything, recoverable only with your password.
  - title: Security First
    details: Distributed rate limiting, auto IP bans, SQL/XSS detection, SHA-256 hashed IPs, and comprehensive attack pattern detection.
  - title: Private by design
    details: Passkey-gated HTTP announces, DHT/PEX disabled, SHA-256-hashed peer IPs with daily-rotating salt.
  - title: Hit-and-Run tracking
    details: Built-in seeding requirements, exemption controls and moderator dashboards keep the swarm healthy.
---

## Why Trackarr?

Trackarr is designed for communities that value **privacy** and **security** above all else. Unlike traditional trackers that store passwords and personal data in plaintext or with reversible encryption, Trackarr uses cryptographic proofs that make it mathematically impossible to recover user credentials—even for administrators.

### Tech Stack

| Layer    | Technology                          | Purpose                             |
| -------- | ----------------------------------- | ----------------------------------- |
| Frontend | Nuxt 4, Vue 3, Tailwind CSS         | SSR, Composition API                |
| Backend  | Nitro Server Engine                 | API routes, middleware              |
| Database | PostgreSQL 16 + Drizzle ORM         | Data persistence, full-text search  |
| Cache    | Redis 7                             | Peer lists, sessions, rate limiting |
| P2P      | bittorrent-tracker                  | HTTP announces (passkey-gated)      |
| Crypto   | Web Crypto API, scrypt, AES-256-GCM | ZKE auth, Panic encryption          |

---

## Need a Custom Setup?

Want a **custom installation**, specific features, or professional support for your private tracker?

I offer:

- **Custom Installation** — Turnkey setup on your infrastructure
- **Feature Development** — Custom features tailored to your community
- **Ongoing Maintenance** — Updates and backups
- **Performance Optimization** — Fine-tuning for high-traffic trackers

<div class="custom-cta">

**Let's talk:** [u68w37uj@exile.4wrd.cc](mailto:u68w37uj@exile.4wrd.cc) · [Discord](https://discord.gg/GRFu35djvz) · [argaudflorian.com](https://argaudflorian.com/)

</div>

<style>
:root {
  --vp-home-hero-name-color: transparent;
  --vp-home-hero-name-background: linear-gradient(135deg, #1f2937 0%, #6b7280 100%);
}

.dark {
  --vp-home-hero-name-background: linear-gradient(135deg, #f9fafb 0%, #9ca3af 100%);
}

.custom-cta {
  margin-top: 1.5rem;
  padding: 1.5rem 2rem;
  background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
  border-radius: 12px;
  text-align: center;
  border: none;
}

.dark .custom-cta {
  background: linear-gradient(135deg, #1f2937 0%, #374151 100%);
  /* border-color: #4b5563; */
}

.custom-cta a {
  color: #111827;
  font-weight: 600;
}

.dark .custom-cta a {
  color: #f9fafb;
}

.custom-cta a:hover {
  text-decoration: underline;
}
</style>
