"""group 子域群级设置（task-09 拆分，原 group/service.py 纯搬移段）。

互@护栏常量（链 TTL / 限频滑窗 / 深度字段 / 同链触发上限——mentions 的
run_cross_mention_detection / _register_chain_members 经 from .settings import
消费）+ settings_json 读写四件套：``_group_guardrail_settings`` /
``_group_typing_preview_enabled``（读，脏数据防御回落）与
``_validate_guardrail_overrides`` / ``_merge_group_settings_json``（写，fail-loud
校验，quick 群 P1/P2）。
"""

from __future__ import annotations

from app.modules.agent.model import AgentGroupChat

from .helpers import GroupChatInvalid

# ── 互@协作护栏常量（task-04，design §4.4——状态只存 Redis 带 TTL，不建表）──
# 协作链 Hash TTL（30min：链跨多轮互@，超时自清理不留死键）。
GROUP_CHAIN_TTL_SECONDS = 30 * 60
# 限频滑动窗口（60s）与窗口内被触发上限（design §9.3 首版保守值 6）。
GROUP_RATE_WINDOW_SECONDS = 60
GROUP_RATE_LIMIT_PER_MINUTE = 6
# 链 Hash 内深度计数字段名（其余 field=成员 id → 互@触发次数计数）。
GROUP_CHAIN_DEPTH_FIELD = "depth"
# 同链同成员互@触发上限（ql-20260902 讨论场景修复：直接触发占位计数 0 不占名额，
# 互@每触发一次 HINCRBY；达上限不再触发——防 A↔B 快速死循环的第一道兜底，
# 总跳数仍由 cross_mention_depth 与限频控制）。
GROUP_CROSS_MEMBER_TRIGGER_LIMIT = 2


def _group_guardrail_settings(group: AgentGroupChat) -> tuple[int, int, int]:
    """群级互@护栏参数（quick 群 P1，2026-09-02：settings_json 启用）。

    优先读 ``group.settings_json`` 的 ``guardrails`` 键（``rate_limit_per_minute``
    / ``member_trigger_limit`` / ``chain_ttl_seconds``），缺省字段回落模块常量
    （默认 6/2/1800，design §9.3 保守值）——存量群 settings_json NULL 与未
    覆盖字段全部走默认，**行为零变化**。写入侧（``_validate_guardrail_overrides``）
    已校验范围；此处对脏数据（手改库/迁移残留）再防御一层：非 int（含 bool）
    一律回退默认，不让护栏因脏配置失效或爆炸。
    """
    raw = (group.settings_json or {}).get("guardrails")
    if not isinstance(raw, dict):
        raw = {}

    def _pick(key: str, default: int) -> int:
        value = raw.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
        return default

    return (
        _pick("rate_limit_per_minute", GROUP_RATE_LIMIT_PER_MINUTE),
        _pick("member_trigger_limit", GROUP_CROSS_MEMBER_TRIGGER_LIMIT),
        _pick("chain_ttl_seconds", GROUP_CHAIN_TTL_SECONDS),
    )


def _group_typing_preview_enabled(group: AgentGroupChat) -> bool:
    """typing 草稿预览群级开关（quick 群 P2，2026-09-02：默认关）。

    读 ``group.settings_json`` 的 ``typing_preview``（bool）——**默认 False**：
    只显示「正在输入」不发草稿（隐私从简）；显式 True 才随 typing 事件带
    preview。存量群 settings_json NULL / 无该键 / 脏值（非 bool）一律 False
    （与 ``_group_guardrail_settings`` 同款防御口径，脏配置不炸发布链路）。
    写入侧（PATCH ``_merge_group_settings_json``）已校验 bool。
    """
    return (group.settings_json or {}).get("typing_preview") is True


# ── 互@护栏参数群级可配（quick 群 P1，2026-09-02：settings_json 启用）────────


# guardrails 子键合法范围（int 边界含端点；范围沿用 design §9.3 保守界 +
# 模块常量默认值的合理调节带）。
_GUARDRAIL_FIELD_RANGES: dict[str, tuple[int, int]] = {
    "rate_limit_per_minute": (1, 60),
    "member_trigger_limit": (1, 10),
    "chain_ttl_seconds": (300, 7200),
}


def _validate_guardrail_overrides(raw: object) -> None:
    """PATCH ``settings_json.guardrails`` 校验（非法键/范围外值 → 400 中文）。

    fail-loud：未知键拒绝（防客户端拼写错误静默落库成死配置）；值必须为
    范围内整数（bool 是 int 子类，显式排除）。
    """
    if not isinstance(raw, dict):
        raise GroupChatInvalid("settings_json.guardrails 必须是对象。")
    for key, value in raw.items():
        if key not in _GUARDRAIL_FIELD_RANGES:
            raise GroupChatInvalid(
                f"未知的互@护栏参数「{key}」。",
                details={"field": key, "allowed": sorted(_GUARDRAIL_FIELD_RANGES)},
            )
        low, high = _GUARDRAIL_FIELD_RANGES[key]
        if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
            raise GroupChatInvalid(
                f"互@护栏参数「{key}」取值需在 {low}-{high} 之间。",
                details={"field": key, "value": str(value), "min": low, "max": high},
            )


def _merge_group_settings_json(current: dict | None, incoming: dict) -> dict:
    """PATCH ``settings_json`` 合并落库（quick 群 P1；P2 增 ``typing_preview``）。

    顶层键白名单：``guardrails``（子键**字段级合并**——未传字段保留既有覆盖值，
    与 GroupChatUpdate「None=不改」局部更新语义同构）+ ``typing_preview``
    （bool，quick 群 P2 typing 草稿预览开关）。``pinned`` 是置顶端点的内部写
    键，不经 PATCH（fail-loud 拒绝防外部覆盖快照）。返回新 dict（不原地改
    ORM 属性，赋值才进 dirty——既有 ``pinned`` 原样保留）。清除覆盖 = 显式
    回传默认值。
    """
    merged = dict(current or {})
    rest = dict(incoming)
    guardrails = rest.pop("guardrails", None)
    typing_preview = rest.pop("typing_preview", None)
    if rest:
        key = next(iter(rest))
        raise GroupChatInvalid(
            f"未知的群设置键「{key}」。",
            details={"key": key, "allowed": ["guardrails", "typing_preview"]},
        )
    if guardrails is not None:
        _validate_guardrail_overrides(guardrails)
        merged["guardrails"] = {**(merged.get("guardrails") or {}), **guardrails}
    if typing_preview is not None:
        if not isinstance(typing_preview, bool):
            raise GroupChatInvalid(
                "settings_json.typing_preview 必须是布尔值。",
                details={"field": "typing_preview", "value": str(typing_preview)},
            )
        merged["typing_preview"] = typing_preview
    return merged
