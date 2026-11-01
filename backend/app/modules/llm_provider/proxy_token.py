"""限域 LiteLLM 代理令牌（2026-10-31-share-openai-chat-proxy-token）。

背景：llm-proxy 归属断言的认证主体是守护进程属主（子进程 Bearer = daemon
apiKey），而共享/借出场景下会话级 openai_chat 供应商的模型名 uid 是供应商
属主——代理层拿不到「真正选择供应商的会话属主」身份。本模块把该身份以
短期 HMAC 令牌形式随 provider_config 下发（``litellm_proxy_token``），子进程
以它作 Bearer，代理端验签后按令牌 (o, p) 严格断言模型名。

令牌形态：``shlp_<b64url(payload_json)>.<b64url(hmac_sha256)>``；payload 键
``v``=版本 / ``u``=会话属主 / ``o``=供应商属主 / ``p``=供应商 id / ``exp``=unix
秒。签名密钥 = ``settings.secret_key``（与 JWT/access token 同源，不新增部署
前提）。验签纯无状态（不查 DB）、常量时间比较；过期/篡改/形态不符一律
None（fail-closed）。

撤销语义：令牌不吊销——撤销共享后新 claim 不再铸造（provider_usable_by
拒绝 → 回落默认链），已下发令牌存活至 exp，对齐 anthropic 分支「撤销只
影响后续 claim、在途 turn 继续用已下发凭证」的既有语义。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from dataclasses import dataclass

from app.core.config import get_settings

#: 令牌前缀（区别于 shk_live_ apiKey 与 eyJ JWT，代理端据此短路验签分支）。
PROXY_TOKEN_PREFIX = "shlp_"

#: 默认有效期：覆盖多轮 claim 间隔 + 长轮次余量；每次 claim 重铸，正常流量
#: 远早于 TTL 刷新。与 anthropic 分支下发凭证的时效语义同量级。
PROXY_TOKEN_TTL_SECONDS = 24 * 3600


@dataclass(frozen=True)
class ProxyTokenGrant:
    """验签产物：令牌授权的三元组 + 过期时刻（代理端断言用）。"""

    session_user_id: uuid.UUID
    owner_user_id: uuid.UUID
    provider_id: uuid.UUID
    expires_at: int

    @property
    def expected_model_name(self) -> str:
        """令牌唯一允许的 usr 模型名（单一真相源 litellm_model_name）。"""
        from app.modules.llm_provider.litellm_client import litellm_model_name

        return litellm_model_name(self.owner_user_id, self.provider_id)


def mint_llm_proxy_token(
    *,
    session_user_id: uuid.UUID,
    owner_user_id: uuid.UUID,
    provider_id: uuid.UUID,
    ttl_seconds: int = PROXY_TOKEN_TTL_SECONDS,
) -> str:
    """铸造限域令牌（lease 解析链调用；ttl_seconds 仅供测试注入）。"""
    payload = {
        "v": 1,
        "u": str(session_user_id),
        "o": str(owner_user_id),
        "p": str(provider_id),
        "exp": int(time.time()) + int(ttl_seconds),
    }
    payload_b64 = _b64url(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    return f"{PROXY_TOKEN_PREFIX}{payload_b64}.{_sign(payload_b64)}"


def verify_llm_proxy_token(token: str) -> ProxyTokenGrant | None:
    """验签（代理端调用）：任何不完整/篡改/过期形态一律 None，fail-closed。"""
    if not isinstance(token, str) or not token.startswith(PROXY_TOKEN_PREFIX):
        return None
    payload_b64, sep, sig = token[len(PROXY_TOKEN_PREFIX) :].partition(".")
    if not sep or not payload_b64 or not sig:
        return None
    if not hmac.compare_digest(_sign(payload_b64), sig):
        return None
    try:
        raw = base64.urlsafe_b64decode(payload_b64 + "=" * (-len(payload_b64) % 4))
        payload = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, dict) or payload.get("v") != 1:
        return None
    try:
        grant = ProxyTokenGrant(
            session_user_id=uuid.UUID(str(payload["u"])),
            owner_user_id=uuid.UUID(str(payload["o"])),
            provider_id=uuid.UUID(str(payload["p"])),
            expires_at=int(payload["exp"]),
        )
    except (KeyError, ValueError, TypeError):
        return None
    if grant.expires_at <= int(time.time()):
        return None
    return grant


def _sign(payload_b64: str) -> str:
    key = get_settings().secret_key.encode("utf-8")
    return _b64url(hmac.new(key, payload_b64.encode("ascii"), hashlib.sha256).digest())


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
