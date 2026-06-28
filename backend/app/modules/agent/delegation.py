"""Coordinator delegation planning (Wave 2, 2026-06-19-multi-agent-orchestration).

The Coordinator's【dispatch / planning phase】is a plain text-generation call to
GLM — NOT an agentic claude CLI run (spike 04 finding: claude CLI's agentic
system prompt makes GLM refuse to emit pure delegation JSON). This module turns
a Mission objective into a validated list of Worker delegations.

The prompt / parse / validate here are distilled from ``spikes/04-delegate-task``
which proved H1 (parseable) / H2 (valid) = 100% over N=10 via the direct
messages API.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.logging import get_logger

log = get_logger(__name__)

# Worker roles (brainstorm-decisions D7 / spike 04 schema)
WORKER_ROLES = frozenset({"arch", "code_style", "test", "integration", "risk", "impl", "verify"})

MAX_WORKERS = 5  # Wave 1 硬约束 (proposal §5)


# auto 路由启发式关键词（D-002@v1：四因子量化阈值待 plan 细化，v1 用关键词+长度）
_TEAM_HINT_KEYWORDS = frozenset(
    {"扫描", "架构", "多模块", "重构", "scan", "bootstrap", "全面", "整体", "multiple"}
)


def route(objective: str, constraints: dict[str, Any] | None = None) -> str:
    """single/team/auto 三档路由（D-002@v1，2026-06-28-team-mainline-integration）。

    第一版接 bootstrap + execute 入口（其他 stage 保持 single）。``auto`` 按启发式
    （objective 长度 + 关键词）选 single/team；显式 ``constraints['mode']`` 优先。
    四因子（任务数/模块跨度/风险/预计上下文）量化阈值待 plan 阶段细化。
    """
    if constraints:
        forced = constraints.get("mode")
        if forced in ("single", "team"):
            return forced
    # auto 启发式（v1 简化）
    if len(objective) > 200 or any(k in objective for k in _TEAM_HINT_KEYWORDS):
        return "team"
    return "single"


_SYSTEM = (
    "你是多 Agent 编排的 Coordinator。把用户的任务拆解为 Worker 委派，"
    "只输出一个 JSON 对象，不要有任何多余解释或 markdown 代码块。\n"
    "JSON 格式："
    '{"summary": "对任务的一句话理解", "delegations": [{'
    '"worker_id": "arch_analyzer", "role": "arch", "objective": "具体目标", '
    '"expected_artifact": "arch.md", "read_only": true}]}\n'
    f"约束：delegations 1-{MAX_WORKERS} 个；role ∈ arch|code_style|test|integration|risk|impl|verify；"
    "read_only 布尔；worker_id/objective 非空。"
)


class DelegationError(Exception):
    """Raised when GLM output cannot be parsed into valid delegations."""


@dataclass(frozen=True)
class Delegation:
    """A single Worker delegation produced by the Coordinator."""

    worker_id: str
    role: str
    objective: str
    expected_artifact: str
    read_only: bool


@dataclass(frozen=True)
class GLMConfig:
    """GLM Anthropic-compatible endpoint credentials."""

    base_url: str
    token: str
    model: str

    @classmethod
    def from_env(cls) -> "GLMConfig | None":
        """Build from ANTHROPIC_* env (None if unconfigured)."""
        token = os.environ.get("ANTHROPIC_AUTH_TOKEN") or os.environ.get("ANTHROPIC_API_KEY")
        base = os.environ.get("ANTHROPIC_BASE_URL")
        if not token or not base:
            return None
        model = os.environ.get("ANTHROPIC_DEFAULT_SONNET_MODEL", "glm-5.2")
        return cls(base_url=base, token=token, model=model)


def _extract_json(text: str) -> dict[str, Any] | None:
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    candidate = m.group(0)
    for attempt in (candidate, re.sub(r",\s*([}\]])", r"\1", candidate)):
        try:
            data = json.loads(attempt)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict):
            return data
    return None


def parse_delegations(data: dict[str, Any]) -> list[Delegation]:
    """Validate a parsed dict into Delegations; raise DelegationError on bad shape."""
    dels = data.get("delegations")
    if not isinstance(dels, list):
        raise DelegationError("delegations_not_list")
    if not (1 <= len(dels) <= MAX_WORKERS):
        raise DelegationError(f"n={len(dels)}_out_of_1..{MAX_WORKERS}")
    out: list[Delegation] = []
    for i, d in enumerate(dels):
        if not isinstance(d, dict):
            raise DelegationError(f"del[{i}]_not_dict")
        role = d.get("role")
        if role not in WORKER_ROLES:
            raise DelegationError(f"del[{i}]_bad_role_{role!r}")
        read_only = d.get("read_only")
        if not isinstance(read_only, bool):
            raise DelegationError(f"del[{i}]_read_only_not_bool")
        wid = d.get("worker_id")
        objective = d.get("objective")
        if not wid or not objective:
            raise DelegationError(f"del[{i}]_missing_fields")
        out.append(
            Delegation(
                worker_id=str(wid),
                role=str(role),
                objective=str(objective),
                expected_artifact=str(d.get("expected_artifact", "")),
                read_only=read_only,
            )
        )
    return out


class CoordinatorPlanner:
    """Plans Worker delegations for a Mission via a direct GLM messages call.

    Direct API (not claude CLI) per spike 04: avoids the agentic system prompt
    that makes GLM refuse pure delegation JSON output.
    """

    def __init__(self, config: GLMConfig, *, timeout: float = 120) -> None:
        self._config = config
        self._timeout = timeout

    async def plan(
        self, objective: str, constraints: dict[str, Any] | None = None
    ) -> tuple[str, list[Delegation]]:
        """Returns ``(summary, delegations)`` — ``summary`` is the Coordinator's
        one-line understanding of the task (2026-06-28: surfaced to the UI so
        the 拆解 is no longer a black box)."""
        user = f"任务：{objective}\n\n输出委派清单 JSON："
        payload = {
            "model": self._config.model,
            "max_tokens": 2048,
            "system": _SYSTEM,
            "messages": [{"role": "user", "content": user}],
        }
        headers = {
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            "x-api-key": self._config.token,
            "authorization": f"Bearer {self._config.token}",
        }
        endpoint = self._config.base_url.rstrip("/") + "/v1/messages"
        # trust_env=False: GLM endpoint (open.bigmodel.cn) is domestic; don't inherit
        # the env SOCKS proxy (spike 04 — it's for anthropic.com and lacks socksio).
        async with httpx.AsyncClient(trust_env=False, timeout=self._timeout) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
        text = "".join(
            b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"
        )
        parsed = _extract_json(text)
        if parsed is None:
            raise DelegationError("unparseable")
        delegations = parse_delegations(parsed)
        summary = str(parsed.get("summary", "")).strip()
        log.info(
            "coordinator_plan_ok",
            model=self._config.model,
            workers=len(delegations),
            roles=[d.role for d in delegations],
            has_summary=bool(summary),
        )
        return summary, delegations
