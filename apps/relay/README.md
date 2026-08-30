# Trackarr messaging relay (Go)

Fans out messaging frames to open SSE connections. That is the entire job.

## What it does not do

It never writes, never decides, and holds no rule. Permissions, rate
limits, moderation, the first-contact queue and every schema constraint
live in the API. The relay verifies one HMAC signature and copies bytes
from a Valkey channel to a socket.

That restraint is the design, not an omission. A delivery service that
knew about roles would need the session seal, the ban checks and the rate
limit policies — a thousand-odd lines of security logic in a second
language, where the copy that gets forgotten is the one with the hole.

## Why it is a separate process

Not throughput: Node holds ten thousand SSE connections for about 100 MB.
It is that the fan-out shares a thread of execution with whatever else
runs there. At the target load — ten thousand people online, twenty
thousand streams, several thousand writes a second when the room is
busy — that neighbour should not be the API serving uploads and announces.

## If it is down

The site keeps working. Private messages send and read; they stop
arriving live. `MESSAGING_SERVICE_URL` being unset is a supported
configuration, not a broken one — the admin toggle is then greyed out
with the reason shown rather than silently doing nothing.

## Configuration

| Variable | Required | Meaning |
| --- | --- | --- |
| `REDIS_URL` | yes | Valkey, shared with the API |
| `MESSAGING_TOKEN_SECRET` | yes, ≥32 bytes | HMAC key; must match the API's |
| `RELAY_ADDR` | no | listen address, default `:4100` |
| `RELAY_NODE_ID` | no | defaults to the hostname |

Everything that depends on the size of the fleet — the per-node connection
ceiling, the queue depth, the coalescing window — arrives at runtime from
the API. A node cannot know how many of itself there are.

## The fleet

Each node writes `messaging:node:<id>` with a TTL and refreshes it from
the same loop that reports its connection count. The API counts the live
keys, divides the target, and publishes on `messaging:config`.

The direction matters: nodes register, the API broadcasts. Nothing ever
connects *to* a node except a browser. That is what makes one container on
a laptop and a dozen pods across a cluster the same code, with no service
discovery.

A node that has heard no configuration serves with its built-in defaults.
Configuration is an optimisation; it is never an authorisation.

## Endpoints

- `GET /events?token=…` — the SSE stream.
- `GET /healthz` — pings Valkey.
- `GET /metrics` — `relay_connections`, which is the metric an autoscaler
  should use. Ten thousand idle connections cost almost no CPU while
  filling the node completely, so an HPA on CPU never fires and the node
  starts refusing instead.
