# Security Policy

## Supported version

Only the latest release is actively maintained.

## Reporting a vulnerability

Please do not include passwords, cookies, signed media URLs, personal data, or other secrets in a public issue. Open a GitHub issue containing only a minimal, non-sensitive reproduction and clearly mark it as a security report. If the report itself would expose users, contact the repository owner privately through their GitHub profile before publishing details.

## Security design

- No `<all_urls>` or `webRequest` permission;
- No cookie, history, identity, clipboard-read, or tabs permission;
- No remote executable code, analytics, advertisements, or backend API;
- Amazon media URLs are validated before use;
- Video URLs are isolated by tab and stored only in Chrome session storage;
- HLS encryption and DRM are intentionally not bypassed.
