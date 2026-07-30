# Device guide

Every person deploys an independent instance. There is no shared MCP account,
shared NetEase cookie or shared token database.

## Fastest recommended path

Run the personal MCP once on a computer, NAS or VPS with Docker:

```bash
git clone https://github.com/tianyupaipai-cmd/netease-music-mcp.git
cd netease-music-mcp
export NETEASE_PERSONAL_ORIGIN=https://music.your-domain.example
docker compose run --rm netease-mcp npm run init:personal -- /data
docker compose up -d
```

Put HTTPS or a private tunnel in front of `127.0.0.1:3304`. Open `/setup`,
create the single owner, and then add `/mcp` to your AI client.

## macOS

### Install

- Option A: Docker Desktop; no local Node.js setup is required.
- Option B: Node.js 20 or newer plus the official NetEase Music client.

### Use

- Remote/general tools: run the personal OAuth service and connect `/mcp`.
- Local player control: run the stdio server on the Mac. macOS may ask for
  Automation or Accessibility permission.
- Playlist writes: import the owner's local session with
  `npm run import:session:macos`, or save the allowlisted session in the
  owner's private dashboard.

## Windows

### Install

- Option A: Docker Desktop.
- Option B: Node.js 20 or newer; Git is recommended.
- Install the official NetEase Music client only if you want to prepare for a
  future Windows player adapter.

### Use

- Search, details, lyrics and playlist tools work through stdio or `/mcp`.
- Windows local play/pause/next is not marked stable yet.
- The owner supplies only `MUSIC_U` and optional `__csrf`; never a password.

## Linux, VPS and NAS

### Install

- Docker Engine with Compose, or Node.js 20 or newer.
- A personal domain with HTTPS, or a private/zero-trust tunnel.

### Use

- Best location for the always-online personal `/mcp` endpoint.
- Keep port `3304` on loopback and expose only the HTTPS reverse proxy.
- Back up `/data/auth.json` and `/data/master.key` together and encrypt the
  backup.
- A server does not control a desktop or phone player without an on-device
  companion.

## Android, iPhone and iPad

### Install

- No Node.js or Docker is required on the phone.
- Use an AI client that supports remote MCP, or a self-hosted frontend.

### Use

1. Deploy your own instance on a computer, NAS or VPS.
2. Add your personal `https://…/mcp` address.
3. Complete owner login and OAuth in the browser.

Cloud code cannot press buttons inside the official mobile music app. Direct
phone playback control needs a separate on-device companion and explicit
operating-system permission.

## Claude, ChatGPT, Codex, DeepSeek and custom frontends

- Remote-MCP clients: add the personal `/mcp` URL and use browser OAuth.
- Clients with OpenAPI/Actions but no MCP: import `/openapi.json`.
- DeepSeek-based or OpenAI-compatible frontends: map `/openapi.json` to tool
  calls, or call `/api/v1` from the frontend's server.
- Custom frontend: create a scoped Personal Access Token in `/dashboard`.

Never embed a write-capable Personal Access Token in public browser
JavaScript. Keep it in the custom frontend's server environment.

## What each owner gets

- one owner login;
- one encrypted NetEase session;
- independently generated and revocable OAuth/Personal Access Tokens;
- one stable `/mcp` URL;
- no shared database, credentials or quota with any other person.
