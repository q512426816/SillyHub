"""多模态能力门控（D-9，FR-10）。

Change 2026-08-20-session-multimodal-attachments task-05。

用户指出并非所有模型都多模态（如 GLM-4.5 文本版）——向非多模态模型直发
ImageBlock 会被 Anthropic 兼容端点 400 或被中转站静默丢弃。判定按
``llm_providers.multimodal`` 三态：

- ``true`` / ``false``：手动覆盖（中转站别名的权威来源），直取；
- ``auto``：按生效模型名启发式表推断；**未命中一律不支持**（保守侧——
  宁降级不硬失败；别名命中不了启发式是常态，由用户手动覆盖纠正）。

不支持时图片/PDF 由 task-06 组装降级为文件落盘模式（turn 不失败）。
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.llm_provider.model import LlmProvider

# 启发式：模型名（小写）含任一模式 → 判支持。
# v 系（glm-4.6v / *-v / *-vl / *vision）、gpt-4o/4.1/5 系、o 系推理、
# claude 全系、gemini 全系、qwen-vl 系、doubao-seed 等。
_MULTIMODAL_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p)
    for p in (
        r"\d+v($|[^a-z0-9])",  # 视觉变体收尾 v：glm-4.6v / step-1v（v 前是数字；deepseek-v3 等版本号不命中）
        r"vision",  # *vision*
        r"[._-]vl",  # qwen-vl / *-vl-*
        r"glm-[34]\.\d+v",  # glm-4.5v / glm-4.6v（点号变体）
        r"gpt-4o",  # gpt-4o / gpt-4o-mini
        r"gpt-4\.1",  # gpt-4.1 系
        r"gpt-5",  # gpt-5 系
        r"gpt-[46]\.[0-9]+-mini",  # 4.x-mini 多模态系（4.7+）
        r"(^|[^a-z])o[134]",  # o1/o3/o4 推理系
        r"claude",  # claude 全系
        r"gemini",  # gemini 全系
        r"deepseek-vl",  # deepseek 视觉系
        r"doubao-seed",  # 豆包 seed 系
        r"kimi-latest",  # kimi 最新（多模态）
    )
)


def supports_multimodal_by_model_name(model_name: str | None) -> bool:
    """auto 态启发式：模型名未命中 → False（D-9 保守侧）。"""
    if not model_name:
        return False
    lowered = model_name.strip().lower()
    return any(p.search(lowered) for p in _MULTIMODAL_PATTERNS)


@dataclass(frozen=True)
class MultimodalGate:
    """inject 组装消费的判定产物（task-06 provides 契约）。"""

    supports_multimodal: bool
    effective_provider_id: uuid.UUID | None


def resolve_gate(provider: LlmProvider | None) -> MultimodalGate:
    """按 provider 行三态判定（无 provider → 保守不支持，daemon 本机凭证未知）。"""
    if provider is None:
        return MultimodalGate(supports_multimodal=False, effective_provider_id=None)
    if provider.multimodal == "true":
        return MultimodalGate(supports_multimodal=True, effective_provider_id=provider.id)
    if provider.multimodal == "false":
        return MultimodalGate(supports_multimodal=False, effective_provider_id=provider.id)
    # auto：生效模型名取 model ?? default_fallback_model
    model_name = provider.model or provider.default_fallback_model
    return MultimodalGate(
        supports_multimodal=supports_multimodal_by_model_name(model_name),
        effective_provider_id=provider.id,
    )


async def resolve_session_gate(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    session_llm_provider_id: uuid.UUID | None,
    agent_kind: str,
) -> MultimodalGate:
    """会话实际生效 provider 判定（lease 优先级链同源：会话绑定 > 用户默认）。

    - 会话显式绑定行（归属校验：仅 daemon 登记者本人）优先；
    - 为空回退用户 is_default 同 agent_kind 行；
    - 再无（本机凭证）→ 保守不支持（模型未知）。
    """
    provider: LlmProvider | None = None
    if session_llm_provider_id is not None:
        provider = (
            await session.execute(
                select(LlmProvider).where(
                    LlmProvider.id == session_llm_provider_id,
                    LlmProvider.user_id == user_id,
                )
            )
        ).scalar_one_or_none()
    if provider is None:
        provider = (
            (
                await session.execute(
                    select(LlmProvider)
                    .where(
                        LlmProvider.user_id == user_id,
                        LlmProvider.agent_kind == agent_kind,
                        LlmProvider.is_default.is_(True),
                    )
                    .limit(1)
                )
            )
            .scalars()
            .first()
        )
    return resolve_gate(provider)
