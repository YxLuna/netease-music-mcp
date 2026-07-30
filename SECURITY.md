# Security

## Supported versions

Security fixes are applied to the latest release on the default branch.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature instead of opening
a public issue containing credentials or exploit details.

Never include `MUSIC_U`, `__csrf`, an MCP secret path, OAuth access/refresh
tokens, personal tokens, a connector URL, account screenshots, or server
access details in an issue.

## Credential model

- Account tools are disabled by default.
- The project never asks for an account password.
- Only the allowlisted `MUSIC_U` and `__csrf` cookies are read.
- Cookie files, `.env`, session files and secret files are ignored by Git.
- On POSIX systems the session file must not be readable by group or other
  users. On Windows, restrict the file ACL to the current user.
- A remote MCP URL contains a secret path and must be handled like a password.
- Personal remote mode stores the owner password verifier with scrypt, stores
  only token digests, binds access tokens to the MCP resource, and encrypts
  the owner's optional NetEase session with AES-256-GCM.
- `auth.json` and `master.key` must be mode `600`, owned by the service user,
  excluded from Git and backed up together. Losing the master key makes
  encrypted NetEase sessions unrecoverable.
- Keep Node on loopback behind HTTPS. The service has no public user signup:
  after the one-time owner setup, everyone else must deploy a separate
  instance.

This project does not provide audio downloading, DRM removal, membership
bypasses, or private chat API automation.
