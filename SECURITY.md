# Security Overview — SOC File Portal

## Purpose
This document explains security design decisions for the demo secure file portal and guidance for production hardening.

## Threat model
- Untrusted uploader (anyone with API token)
- Man-in-the-middle while in transit
- Compromise of server disk
- Key disclosure or weak key management

## Confidentiality & Integrity
- **Encryption:** AES-GCM (authenticated encryption) used for all files.
- **Keying:** Per-file symmetric key derived from a master key using HKDF + per-file random salt.
- **Nonce/Tag:** Random 12-byte nonce + 16-byte tag stored with ciphertext. Tag is verified during decryption to ensure integrity.

## Key management
- **Demo:** MASTER_KEY is provided via environment variable (base64).
- **Production recommendation:** Use a managed KMS (AWS KMS, GCP KMS, Azure Key Vault, or HashiCorp Vault). Implement envelope encryption: KMS issues short-lived data keys; encrypt file with data key and wrap/unwrap with KMS.

## Transport security
- **Require TLS** in front of the Flask app (terminate TLS at reverse proxy: Nginx/Cloud Load Balancer). Never expose plaintext HTTP in production.

## Authentication & Authorization
- **Demo:** X-API-Token header.
- **Production:** Use strong authentication (OAuth 2.0 / JWT). Implement RBAC so only authorized users can download specific files.

## Input validation & content handling
- Limit maximum upload size.
- Use `secure_filename` to sanitize filenames.
- Scan uploads with AV (ClamAV) before storing.
- Enforce MIME type checks and optionally content scanning for sensitive data (DLP).

## Storage & backups
- Store only encrypted blobs on disk.
- Secure backups (encrypted) and rotate backup keys in KMS.
- Minimize metadata stored; do not log plaintext content.

## Logging & monitoring
- Log upload/download events (no plaintext).
- Monitor abnormal patterns: burst uploads, many downloads, failed auth attempts.
- Enable alerting for suspicious activity.

## Key rotation & recovery
- Implement key versioning and re-encryption flow built with KMS.
- Maintain an offline key recovery plan and audit access to keys.

## Limitations
- Demo uses env var MASTER_KEY — acceptable for training only.
- No user auth or quotas in demo; add these before production.

## Recommended next steps (production)
1. Deploy behind TLS-terminating reverse proxy and WAF.
2. Integrate with enterprise KMS/HSM.
3. Add authentication (OIDC/OAuth) and user-level ACL.
4. Add antivirus and content scanning pipelines.
5. Run security code review and pen test.
