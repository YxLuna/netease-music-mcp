# Contributing

Issues and pull requests are welcome.

Before submitting a change:

1. Use Node.js 20 or later.
2. Run `npm ci` and `npm test`.
3. Do not commit cookies, MCP connector URLs, hostnames, IP addresses, SSH
   keys, local absolute paths, or logs.
4. Keep account mutations behind explicit user confirmation.
5. Describe the operating system and official NetEase client version when
   changing a local playback adapter.
6. Authentication changes must include tests for PKCE, token audience,
   independent-instance isolation and credential redaction.

Platform adapters must report unsupported capabilities honestly. A feature
should not be marked stable until it has been tested on the target device.
