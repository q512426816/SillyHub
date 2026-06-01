"""Symmetric credential encryption using libsodium secretbox (xchacha20-poly1305).

Master key (KEK) is loaded from ``SILLYSPEC_MASTER_KEY`` environment variable.
Key rotation is supported via ``key_id``: each ``CredentialCipher`` instance is
bound to a single key version, and old versions are kept around for decryption.
"""

from __future__ import annotations

import os

from nacl import secret, utils

from app.core.errors import AppError


class CipherKeyMismatch(AppError):
    """Raised when decryption is attempted with the wrong key version."""

    code = "CIPHER_KEY_MISMATCH"
    http_status = 500


class MasterKeyMissing(AppError):
    """Raised when the master encryption key is not configured."""

    code = "MASTER_KEY_MISSING"
    http_status = 503


def _load_master_key() -> tuple[bytes, str]:
    """Load the master key from ``SILLYSPEC_MASTER_KEY`` env var.

    The env var format is ``<key_id>:<hex-encoded 32-byte key>``.
    For backwards compatibility, a bare 32-byte hex string is treated as key_id ``v1``.
    """
    raw = os.environ.get("SILLYSPEC_MASTER_KEY", "")
    if not raw:
        raise MasterKeyMissing(
            "SILLYSPEC_MASTER_KEY environment variable is required.",
            details={"hint": "Generate one: python -c \"import secrets; print(f'v1:{secrets.token_hex(32)}')\""},
        )
    if ":" in raw:
        key_id, hex_key = raw.split(":", 1)
    else:
        key_id, hex_key = "v1", raw
    key_bytes = bytes.fromhex(hex_key)
    if len(key_bytes) != 32:
        raise MasterKeyMissing(
            f"SILLYSPEC_MASTER_KEY must be 32 bytes (got {len(key_bytes)}).",
            details={"key_id": key_id},
        )
    return key_bytes, key_id


class CredentialCipher:
    """Encrypts/decrypts credential blobs with a versioned master key."""

    def __init__(self, master_key: bytes, key_id: str) -> None:
        if len(master_key) != 32:
            raise ValueError(f"Master key must be 32 bytes, got {len(master_key)}")
        self._box = secret.SecretBox(master_key)
        self.key_id = key_id

    def encrypt(self, plaintext: str) -> tuple[bytes, str]:
        nonce = utils.random(secret.SecretBox.NONCE_SIZE)
        ct = self._box.encrypt(plaintext.encode("utf-8"), nonce)
        return bytes(ct), self.key_id

    def decrypt(self, ciphertext: bytes, key_id: str) -> str:
        if key_id != self.key_id:
            raise CipherKeyMismatch(
                f"Key mismatch: expected {self.key_id!r}, got {key_id!r}.",
                details={"expected_key_id": self.key_id, "actual_key_id": key_id},
            )
        return self._box.decrypt(ciphertext).decode("utf-8")


def get_cipher() -> CredentialCipher:
    """Create a ``CredentialCipher`` from the environment master key."""
    key, kid = _load_master_key()
    return CredentialCipher(key, kid)
