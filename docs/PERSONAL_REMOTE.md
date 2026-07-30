# Personal remote service

`v0.6.0` adds a standard, product-shaped remote service without making the
core depend on one AI vendor.

This is not a shared hosted account system. One deployment has exactly one
owner, one encrypted NetEase session and its own OAuth/Personal Access Tokens.
Another person must deploy another instance.

## Client compatibility

| Client type | Integration |
| --- | --- |
| Claude and other remote-MCP clients | Add the single `/mcp` URL and complete OAuth in the browser |
| ChatGPT/Codex MCP clients | Use `/mcp` when remote MCP is available |
| ChatGPT Actions or similar tool systems | Import `/openapi.json` and use a personal Bearer token |
| DeepSeek-based or OpenAI-compatible frontends | Call `/api/v1`, or bridge the OpenAPI operations into native tool calls |
| Custom web/mobile frontend | Use OAuth for MCP, or a server-side REST adapter with a personal token |
| Local desktop client | Keep using stdio; OAuth is not required |

“Compatible” does not mean every vendor exposes the same connector UI. MCP,
OAuth and OpenAPI are the stable boundaries; product-specific adapters should
remain outside the music service.

## OAuth endpoints

- Protected Resource Metadata:
  `/.well-known/oauth-protected-resource/mcp`
- Authorization Server Metadata:
  `/.well-known/oauth-authorization-server`
- Dynamic Client Registration: `/oauth/register`
- Authorization: `/oauth/authorize`
- Token exchange and refresh: `/oauth/token`
- Token revocation: `/oauth/revoke`
- Protected MCP resource: `/mcp`

The authorization server supports Authorization Code with PKCE S256. Access
tokens are bound to the canonical `/mcp` resource and must be sent in the
`Authorization: Bearer …` header.

Available scopes:

- `music:read`
- `playlist:read`
- `playlist:write`
- `player:control`

The MCP endpoint requires `music:read`. Individual tools verify their own
additional scope before doing work.

## Owner credentials

The service has two different credential layers:

1. The owner account protects the instance dashboard.
2. OAuth/Personal Access Tokens authorize the owner's own clients.
3. The optional `MUSIC_U` / `__csrf` session authorizes the owner's playlist
   operations at music.163.com.

The service never asks for a NetEase password. The owner may paste only the
allowlisted session values in `/dashboard`. They are encrypted with
AES-256-GCM under the deployment master key. The key and auth database must be
backed up together, outside Git.

For a stricter privacy deployment, do not save a session on a VPS. Use only
read scopes remotely and keep account writes in the local stdio service.

## Initial deployment

Requirements:

- Node.js 20 or newer;
- a dedicated unprivileged operating-system user;
- a canonical HTTPS origin;
- Nginx, Caddy, Cloudflare Tunnel or another trusted reverse proxy;
- a state directory writable only by the service user.

```bash
sudo useradd --system --home /var/lib/netease-music-mcp --shell /usr/sbin/nologin netease-mcp
sudo install -d -m 700 -o netease-mcp -g netease-mcp /var/lib/netease-music-mcp
sudo -u netease-mcp npm run init:personal -- /var/lib/netease-music-mcp
```

Create `/etc/netease-music-mcp/personal.env` with mode `600`:

```dotenv
NETEASE_PERSONAL_ORIGIN=https://music.example.com
NETEASE_PERSONAL_HOST=127.0.0.1
NETEASE_PERSONAL_PORT=3304
NETEASE_PERSONAL_STORE_FILE=/var/lib/netease-music-mcp/auth.json
NETEASE_PERSONAL_MASTER_KEY_FILE=/var/lib/netease-music-mcp/master.key
NETEASE_PERSONAL_CORS_ORIGINS=https://frontend.example.com
```

Open `/setup` once to create the owner. After that, setup is locked and there
is no route for a second user to register.

The example systemd unit restricts filesystem writes to the state directory.
The example Nginx configuration keeps Node on loopback and disables proxy
buffering for MCP streaming responses.

## REST/OpenAPI adapter

The OpenAPI document is public, but every operation requires a Bearer token.
Generate a personal token in `/dashboard` and keep it on the server side of a
custom frontend. Never ship a write-capable token in browser JavaScript or a
distributed mobile application.

Current REST routes:

- `GET /api/v1/search`
- `POST /api/v1/song-details`
- `GET /api/v1/lyrics/{songId}`
- `GET|POST /api/v1/playlists`
- `POST|DELETE /api/v1/playlists/{playlistId}/tracks`

Playlist writes still require an explicit JSON `confirm: true`.

## Migration from secret URLs

The existing `npm run start:http` mode and
`/mcp/<64-character-secret>` URL remain available for private single-user
deployments. They are not automatically redirected to the personal OAuth
service.

Recommended migration:

1. Deploy personal OAuth mode on port `3304`.
2. Test discovery, registration, OAuth and read-only tools.
3. Connect the owner's session and test owned-playlist checks.
4. Change your personal hostname route from the old port to `3304`.
5. Reconnect clients using the stable `/mcp` URL.
6. Keep the legacy route private until every client has migrated.

Never share one personal instance or its owner credentials with unrelated
users.
