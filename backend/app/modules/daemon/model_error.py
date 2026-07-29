"""模型调用失败的标准错误协议（三端同构）。

详见 .sillyspec/changes/2026-07-29-model-error-visibility/design.md §7.1。
字段与 sillyhub-daemon/src/model-error/types.ts 的 ModelError 同构，
靠 pnpm gen:types 在 frontend 侧对齐（CLAUDE.md 规则20）。
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel


class ModelErrorType(StrEnum):
    """模型错误类型（与 daemon ModelErrorType 同构）。"""

    AUTH_FAILED = "auth_failed"  # 凭证失效/无效（401/403）
    QUOTA_EXCEEDED = "quota_exceeded"  # 额度/配额耗尽（429，不可重试）
    RATE_LIMITED = "rate_limited"  # 瞬时限流（429，可重试）
    TIMEOUT = "timeout"
    MODEL_NOT_FOUND = "model_not_found"
    NETWORK = "network"  # 连接失败/DNS
    PROVIDER_ERROR = "provider_error"  # 供应商其他错误（5xx）
    UNKNOWN = "unknown"  # 兜底


class ModelErrorDTO(BaseModel):
    """模型层错误详情（存 AgentRun.error_detail JSON 列）。

    与既有 AgentRun.error_code（调度层/系统错误，如 no_online_daemon）正交，
    不互相覆盖（D-009）。仅当 run 因模型调用失败时由 daemon 归类回传。
    """

    type: ModelErrorType
    code: str | None = None  # 原始错误码（如 "1310" / "429" / null）
    message: str  # 可读原因（中文）
    retryable: bool
    hint: str | None = None  # 针对性建议（中文）
    raw: str | None = None  # 原始错误文本（查看详情）
