# Zero-Knowledge Authentication

Trackarr uses a **Zero-Knowledge** authentication system where the server **never sees or stores your password**. All cryptographic operations happen client-side in your browser.

## How It Works

### Registration Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        REGISTRATION FLOW                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐                              ┌─────────────────┐  │
│  │   CLIENT    │                              │     SERVER      │  │
│  └──────┬──────┘                              └────────┬────────┘  │
│         │                                              │           │
│         │ 1. Solve PoW Challenge (anti-spam)           │           │
│         │ ◄────────────────────────────────────────────┤           │
│         │                                              │           │
│         │ 2. Generate random salt (32 bytes)           │           │
│         │ 3. Derive key = PBKDF2(password, salt)       │           │
│         │ 4. Compute verifier = SHA256(key)            │           │
│         │                                              │           │
│         │ 5. Send {username, salt, verifier} ─────────►│           │
│         │    Password NEVER leaves client           │           │
│         │                                              │           │
│         │                              6. Store salt + │           │
│         │                                 verifier     │           │
│         │                              7. Create session           │
│         │ ◄──────────────────────────────── 8. OK ─────┤           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Login Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                          LOGIN FLOW                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐                              ┌─────────────────┐  │
│  │   CLIENT    │                              │     SERVER      │  │
│  └──────┬──────┘                              └────────┬────────┘  │
│         │                                              │           │
│         │ 1. Request challenge ───────────────────────►│           │
│         │                                              │           │
│         │ ◄──────── 2. Return {salt, challenge} ───────┤           │
│         │                                              │           │
│         │ 3. Derive key = PBKDF2(password, salt)       │           │
│         │ 4. Compute verifier = SHA256(key)            │           │
│         │ 5. Generate proof = SHA256(verifier+challenge)           │
│         │                                              │           │
│         │ 6. Send {username, proof, challenge} ───────►│           │
│         │    Password NEVER leaves client           │           │
│         │                                              │           │
│         │                       7. Compute expected =  │           │
│         │                          SHA256(storedVerifier+challenge)│
│         │                       8. Verify proof == expected        │
│         │ ◄──────────────────────────────── 9. Session ┤           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Security Properties

### Password Never Transmitted

Your password never leaves your device. Only cryptographic proofs derived from your password are sent to the server. Even if an attacker intercepts the network traffic, they cannot recover your password.

### PBKDF2 with 100k Iterations

Password-Based Key Derivation Function 2 (PBKDF2) with 100,000 iterations makes brute-force attacks computationally expensive. Each password guess requires significant CPU time.

### Unique Challenge Per Login

Every login attempt receives a unique, time-limited challenge. This prevents:

- **Replay attacks** — Captured login data cannot be reused
- **Pre-computation attacks** — Attackers cannot pre-calculate proofs

### Proof of Work

Registration requires solving a computational puzzle (Proof of Work). This:

- Prevents automated account creation
- Stops spam registrations
- Makes bot attacks expensive

The puzzle asks for five leading hex zeros: about a million SHA-256 hashes on average, some six seconds in a desktop browser (measured at ~175,000 WebCrypto hashes/s) and several times that on a phone — and the count is luck, so some take much longer. The browser keeps at it for up to four minutes, inside the challenge's five-minute life; it used to give up after one, which a slow phone could miss.

## What the Server Stores

The server only stores:

| Data | Purpose |
|------|---------|
| Username | Account identification |
| Salt | Random bytes for key derivation |
| Verifier | SHA-256 hash of the derived key |

::: tip
Even with full database access, an attacker cannot recover passwords. The verifier is a one-way hash that cannot be reversed.
:::

## Comparison with Traditional Auth

| Aspect | Traditional | Zero-Knowledge |
|--------|-------------|----------------|
| Password storage | Hashed on server | Never reaches server |
| Network exposure | Password sent over TLS | Only proof sent |
| Database breach risk | Password hashes exposed | Only verifiers exposed |
| Server trust required | High | Minimal |
