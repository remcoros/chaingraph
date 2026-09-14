# Security

Please report security issues privately. Do not open a public issue with
details that could be used to exploit someone else.

## Report a vulnerability

Use **Security → Report a vulnerability** in the
[Chaingraph GitHub repository](https://github.com/remcoros/chaingraph).

Please include:

- the affected version or commit;
- what happens and why it matters;
- steps to reproduce or a small proof of concept; and
- any configuration or access needed to reproduce it.

Use synthetic or public Bitcoin data. Never include RPC credentials, seeds,
private keys, workspace passwords, wallet exports, personal extended public
keys, tokens, private hostnames or private URLs.

Only test systems and data you own or are authorized to use. If a test exposes
real private data, stop and mention that in the report without sending the
data.

Chaingraph is watch-only software for one trusted user on a trusted machine.
Its backend is not an authenticated multi-user service and public hosting is
not supported. Reports about the browser app, backend proxy, encrypted storage,
network isolation, read-only RPC controls or release artifacts are in scope.
