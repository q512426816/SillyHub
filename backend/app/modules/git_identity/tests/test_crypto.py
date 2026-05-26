"""Tests for CredentialCipher."""

from __future__ import annotations

import os

import pytest

from app.core.crypto import (
    CipherKeyMismatch,
    CredentialCipher,
    MasterKeyMissing,
    _load_master_key,
)


class TestCredentialCipher:
    def test_encrypt_decrypt_roundtrip(self) -> None:
        key = os.urandom(32)
        cipher = CredentialCipher(key, "v1")
        ct, kid = cipher.encrypt("ghp_abcdef123456")
        assert kid == "v1"
        assert isinstance(ct, bytes)
        plain = cipher.decrypt(ct, "v1")
        assert plain == "ghp_abcdef123456"

    def test_key_mismatch_raises(self) -> None:
        key = os.urandom(32)
        cipher = CredentialCipher(key, "v1")
        ct, _ = cipher.encrypt("secret")
        with pytest.raises(CipherKeyMismatch):
            cipher.decrypt(ct, "v2")

    def test_invalid_master_key_length(self) -> None:
        with pytest.raises(ValueError, match="32 bytes"):
            CredentialCipher(b"short", "v1")

    def test_different_nonces_per_encrypt(self) -> None:
        key = os.urandom(32)
        cipher = CredentialCipher(key, "v1")
        ct1, _ = cipher.encrypt("same-input")
        ct2, _ = cipher.encrypt("same-input")
        assert ct1 != ct2

    def test_unicode_roundtrip(self) -> None:
        key = os.urandom(32)
        cipher = CredentialCipher(key, "v1")
        ct, kid = cipher.encrypt("中文密钥🔑")
        assert cipher.decrypt(ct, kid) == "中文密钥🔑"


class TestLoadMasterKey:
    def test_missing_env_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("SILLYSPEC_MASTER_KEY", raising=False)
        with pytest.raises(MasterKeyMissing):
            _load_master_key()

    def test_valid_key_with_version(self, monkeypatch: pytest.MonkeyPatch) -> None:
        hex_key = "ab" * 32
        monkeypatch.setenv("SILLYSPEC_MASTER_KEY", f"v2:{hex_key}")
        key, kid = _load_master_key()
        assert kid == "v2"
        assert len(key) == 32

    def test_valid_key_without_version(self, monkeypatch: pytest.MonkeyPatch) -> None:
        hex_key = "ab" * 32
        monkeypatch.setenv("SILLYSPEC_MASTER_KEY", hex_key)
        key, kid = _load_master_key()
        assert kid == "v1"

    def test_wrong_length_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SILLYSPEC_MASTER_KEY", "v1:abcd")
        with pytest.raises(MasterKeyMissing):
            _load_master_key()
