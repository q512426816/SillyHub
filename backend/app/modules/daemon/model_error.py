"""模型调用失败的标准错误协议（三端同构）。

详见 .sillyspec/changes/2026-07-29-model-error-visibility/design.md §7.1。
字段与 sillyhub-daemon/src/model-error/types.ts 的 ModelError 同构，
靠 pnpm gen:types 在 frontend 侧对齐（CLAUDE.md 规则20）。
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, field_validator


class ModelErrorType(StrEnum):
    """模型错误类型（与 daemon ModelErrorType 同构）。"""

    AUTH_FAILED = "auth_failed"  # 凭证失效/无效（401/403）
    QUOTA_EXCEEDED = "quota_exceeded"  # 额度/配额耗尽（429，不可重试）
    RATE_LIMITED = "rate_limited"  # 瞬时限流（429，可重试）
    CONTEXT_OVERFLOW = "context_overflow"  # 上下文超窗（F1a，走原生压缩续跑编排）
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

    @field_validator("type", mode="before")
    @classmethod
    def _coerce_unknown_type(cls, value: object) -> object:
        """R-05 宽松校验（2026-10-12-session-defects task-07）：未知枚举值归
        UNKNOWN 而非 422 拒绝——error 挂在 close_interactive_run 请求体，硬拒
        会导致 run 无法收口（卡 running，比归因退化严重）。部署倒置窗口
        （新 daemon 先于 backend 发新枚举）据此安全降级为 unknown 归因。"""
        if isinstance(value, str):
            try:
                return ModelErrorType(value)
            except ValueError:
                return ModelErrorType.UNKNOWN
        return value

    code: str | None = None  # 原始错误码（如 "1310" / "429" / null）
    message: str  # 可读原因（中文）
    retryable: bool
    hint: str | None = None  # 针对性建议（中文）
    raw: str | None = None  # 原始错误文本（查看详情）
    # 2026-09-12-chat-turn-auto-recovery FR-1.3：额度重置时间（ISO-8601 含时区
    # 偏移；None=未解析到/非 quota 类）。daemon 侧由 GLM 中文「将在/将于 … 重置」
    # 解析（+08:00）；随 error_detail JSON 落库，前端与 close 钩子 quota 分支消费。
    reset_at: str | None = None
