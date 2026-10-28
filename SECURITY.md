# Security Policy

## Supported versions

Only the latest release on `main` gets fixes.

## Reporting a vulnerability

Please do **not** open a public issue. Report it privately through [GitHub security advisories](https://github.com/a0x0h/airport-twin/security/advisories/new).

Include what you found, how to reproduce it and the impact you expect. You should hear back within a week.

## Secrets

The app runs fully in the browser and ships no keys. The optional `fetch:mhd` script reads `RAPIDAPI_KEY` from `.env.local`, which is git-ignored. Never commit it. Use [.env.example](.env.example) as the template.
