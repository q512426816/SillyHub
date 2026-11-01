"""proxy_token 单测（2026-10-31-share-openai-chat-proxy-token / FR-01）。

纯函数面：铸造→验签往返 / 签名与载荷篡改 / 过期 / 前缀与形态不符。
安全语义：任何不完整/篡改/过期形态必须 fail-closed 返回 None。
"""

from __future__ import annotations

import base64
import json
import uuid

from app.modules.llm_provider.litellm_client import litellm_model_name
from app.modules.llm_provider.proxy_token import (
    PROXY_TOKEN_PREFIX,
    mint_llm_proxy_token,
    verify_llm_proxy_token,
)


def _ids() -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    return uuid.uuid4(), uuid.uuid4(), uuid.uuid4()


def test_mint_verify_roundtrip() -> None:
    session_user, owner, provider = _ids()
    token = mint_llm_proxy_token(
        session_user_id=session_user, owner_user_id=owner, provider_id=provider
    )
    assert token.startswith(PROXY_TOKEN_PREFIX)
    grant = verify_llm_proxy_token(token)
    assert grant is not None
    assert grant.session_user_id == session_user
    assert grant.owner_user_id == owner
    assert grant.provider_id == provider
    assert grant.expires_at > 0


def test_expected_model_name_is_owner_scoped() -> None:
    session_user, owner, provider = _ids()
    token = mint_llm_proxy_token(
        session_user_id=session_user, owner_user_id=owner, provider_id=provider
    )
    grant = verify_llm_proxy_token(token)
    assert grant is not None
    # 模型名仍以供应商属主为 uid（LiteLLM 路由键零改动）。
    assert grant.expected_model_name == litellm_model_name(owner, provider)
    assert str(session_user) not in grant.expected_model_name


def test_tampered_signature_rejected() -> None:
    _, owner, provider = _ids()
    token = mint_llm_proxy_token(
        session_user_id=uuid.uuid4(), owner_user_id=owner, provider_id=provider
    )
    payload_b64, sig = token[len(PROXY_TOKEN_PREFIX) :].split(".")
    flipped = ("A" if not sig.startswith("A") else "B") + sig[1:]
    assert verify_llm_proxy_token(f"{PROXY_TOKEN_PREFIX}{payload_b64}.{flipped}") is None


def test_tampered_payload_rejected() -> None:
    session_user, owner, provider = _ids()
    token = mint_llm_proxy_token(
        session_user_id=session_user, owner_user_id=owner, provider_id=provider
    )
    payload_b64, sig = token[len(PROXY_TOKEN_PREFIX) :].split(".")
    raw = base64.urlsafe_b64decode(payload_b64 + "=" * (-len(payload_b64) % 4))
    payload = json.loads(raw)
    payload["o"] = str(uuid.uuid4())  # 换属主：签名不再匹配
    forged = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    assert verify_llm_proxy_token(f"{PROXY_TOKEN_PREFIX}{forged}.{sig}") is None


def test_expired_token_rejected() -> None:
    _, owner, provider = _ids()
    token = mint_llm_proxy_token(
        session_user_id=uuid.uuid4(),
        owner_user_id=owner,
        provider_id=provider,
        ttl_seconds=-60,
    )
    assert verify_llm_proxy_token(token) is None


def test_non_proxy_prefix_not_recognized() -> None:
    assert verify_llm_proxy_token("shk_live_not_a_proxy_token") is None
    assert verify_llm_proxy_token("eyJhbGciOi.example.jwt") is None
    assert verify_llm_proxy_token("") is None


def test_malformed_body_rejected() -> None:
    _, owner, provider = _ids()
    token = mint_llm_proxy_token(
        session_user_id=uuid.uuid4(), owner_user_id=owner, provider_id=provider
    )
    # 无分隔点 / 空段 / 损坏 base64 均拒绝。
    assert (
        verify_llm_proxy_token(
            PROXY_TOKEN_PREFIX + token[len(PROXY_TOKEN_PREFIX) :].replace(".", "")
        )
        is None
    )
    assert verify_llm_proxy_token(PROXY_TOKEN_PREFIX + ".") is None
    assert verify_llm_proxy_token(PROXY_TOKEN_PREFIX + "%%%." + "AAAA") is None
