# Bitcoin RPC keepalive recovery

Investigated 2026-09-08 after independent UI reviews occasionally reported a
connection failure immediately after idle time.

A read-only probe used the application's `CoreClient` and its normal Node
HTTP/HTTPS agent against the configured testnet4 node. The process loaded the
existing environment file directly; it did not read or print that file, request
headers, credentials, endpoints or raw exception messages. Instrumentation emitted
only `ClientRequest.reusedSocket` and the transport error code.

| Idle interval | Result | Elapsed |
| --- | --- | --- |
| Initial request | Connected, height 151457 | 63 ms |
| 15 seconds | Connected | 7 ms |
| 30 seconds | `ECONNRESET`, reused socket | 4 ms |
| 1 second after failure | Connected on a fresh socket | 51 ms |
| 30 seconds | `ECONNRESET`, reused socket | 2 ms |

This reproduces stale connection reuse in this deployment. It does not establish
that every historical connection error had that cause.

[Node's HTTP request documentation](https://nodejs.org/docs/latest-v24.x/api/http.html#requestreusedsocket)
describes this keepalive race and identifying it with `reusedSocket` plus
`ECONNRESET`. The correction is restricted to one fresh-connection retry for a
read-only request that fails in that way before receiving a response. It retains
the original deadline and concurrency slot. Authentication failures, response
errors, parsing errors, cancellations and fresh-connection failures are outside
that retry. Final regression and live verification results belong in the validation
report after integration.


## Verified correction

The reviewed correction was integrated at main `a47123b`. Repeating the same
probe at testnet4 height 151458 produced:

| Idle interval | Result | Elapsed |
| --- | --- | --- |
| Initial request | Connected | 64 ms |
| 15 seconds | Connected | 9 ms |
| 30 seconds | Reused-socket reset recovered with one fresh request | 15 ms |
| 1 second | Connected | 55 ms |
| 30 seconds | Reused-socket reset recovered with one fresh request | 18 ms |

All five application calls succeeded. The probe observed both underlying resets,
so this exercises recovery rather than merely failing to reproduce the race.
Client shutdown subsequently aborted its remaining socket as expected. Nine
transport regressions also passed, including a held fresh retry closed by client
shutdown or external cancellation and preservation of the original timeout.
Certificate verification, system CA use and authentication were unchanged.
