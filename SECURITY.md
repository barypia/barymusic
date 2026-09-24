# Security Policy

## Supported Versions

Security updates are provided only for the latest released version of BaryMusic.

| Version | Supported |
| --- | --- |
| Latest release | ✅ |
| Older releases | ❌ |
| Development builds | ❌ |

Please upgrade to the latest release before reporting an issue, unless doing so would expose data or disrupt a production deployment.

## Reporting a Vulnerability

Please **do not report security vulnerabilities through public GitHub issues, discussions, or pull requests**.

Use [GitHub's Security Advisories feature in this repository](https://github.com/barypia/barymusic/security/advisories).

You can also email [barymusic.app@gmail.com](mailto:barymusic.app@gmail.com).

Include:

- a clear description of the issue and its potential impact;
- affected version and deployment method (Docker or Windows portable);
- steps to reproduce or a minimal proof of concept;
- whether authentication, administrator access, or local network access is required;
- any suggested mitigation, if known.

You should receive an initial acknowledgement within **7 days**. We will investigate the report, assess severity and impact, and keep you updated on the planned resolution.

If the report is accepted, we will prepare a fix and coordinate disclosure before publishing details. We may ask you to validate the fix. Reports that are out of scope or cannot be reproduced may be closed with an explanation.

## Scope

Examples of security-relevant areas include:

- authentication, sessions, authorization, and administrator access;
- data exposure in songs, setlists, uploaded audio, notes, exports, or backups;
- import/export archive handling and file uploads;
- REST API and WebSocket access;
- Docker and Windows portable distribution paths;
- denial-of-service issues with realistic impact.

BaryMusic is designed as a self-hosted, single-instance application. Findings that require full administrator or host-level access are generally lower priority, but are still welcome when they demonstrate a meaningful security impact.

## Disclosure

Please give us reasonable time to investigate and release a fix before publicly disclosing the vulnerability. We will credit reporters in release notes or a security advisory unless they prefer to remain anonymous.
