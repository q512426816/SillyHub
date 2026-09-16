"""change 模块共享 title 归一化 helper（2026-09-16-platform-progress-ingest-persist task-01）。

CLI 模板文档的首个 ``# `` H1 是无语义固定文案（``提案书（Proposal）`` 等，
含 ``— <change_key>`` 后缀变体）——语义名只在 change_key（去日期前缀）。本模块把
「H1 → 展示 title」的归一化规则收敛一处，供两条写路径同源消费，防互相回翻：

- platform_sync ``upsert_documents``（文档推送时按最深阶段文档重派生 ux_changes.title）；
- change parser ``_extract_title``（reparse 扫描 proposal.md，归一化后落 parsed.title）。

模板清单按本仓 ``.sillyspec/changes/**`` 实测 H1 家族校准（proposal/requirements/
design/plan/tasks 各自的中文类型词 + 可选括号英文/说明 + 可选 ``—`` 后缀）。注意
**不得**把裸英文标题（``Proposal`` 等）当模板：parser 既有测试 fixture 用英文 H1
表达自定义标题，收录会连坐断言（plan 审查备忘）。冒号形式（``提案：xxx``）视为
作者自定义语义标题，原样保留。
"""

from __future__ import annotations

import re

#: 变更 key 的日期前缀（YYYY-MM-DD-）：key 无语义时展示名用它去掉前缀只留短名
#: （`_broadcast_pending_approval` 的 `_DISPLAY_KEY_RE` 同款口径，收敛一处）。
DISPLAY_KEY_PREFIX_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-")

#: 模板 H1 正则：`<中文类型词>` + 可选 `（...）` 括号段 + 可选 `—/-` 后缀段。
#: 类型词按长前缀优先排列（`提案书` 在 `提案` 前），防短词先匹配截断。
#: 后缀分隔接受 em dash / 双 em dash / 连字符（CLI 模板历史用 `—`）。
_TEMPLATE_TYPE_WORDS = (
    "提案书",
    "提案",
    "需求规格",
    "需求文档",
    "需求",
    "设计文档",
    "设计",
    "实现计划",
    "轻量计划",
    "详细计划",
    "计划",
    "任务清单",
    "任务注册",
    "任务分解",
    "任务",
    "验证报告",
    "模块影响分析",
    "模块影响",
)
TEMPLATE_H1_RE: re.Pattern[str] = re.compile(
    r"^(?:" + "|".join(_TEMPLATE_TYPE_WORDS) + r")"
    r"(?:（[^）]*）)?"
    r"\s*(?:[-—–]\s*.*)?$"
)

_H1_RE = re.compile(r"^#\s+(.+)$")


def extract_h1(text: str) -> str | None:
    """取 markdown 全文首个 ``# `` 一级标题文本（strip 后），无则 None。

    与 parser ``_extract_title`` 的逐行扫描语义一致，收敛供 documents 推送路径
    复用（文档全文在内存，无需落盘）。
    """
    for line in text.splitlines():
        stripped = line.strip()
        matched = _H1_RE.match(stripped)
        if matched:
            return matched.group(1).strip() or None
    return None


def normalize_display_title(h1: str | None, change_key: str) -> str:
    """H1 → 展示 title 归一化（纯函数）。

    - H1 缺失或命中模板（类型词 + 可选括号 + 可选 ``—`` 后缀）→ 回退 change_key
      去日期前缀（``2026-09-15-ehs-reward-punishment`` → ``ehs-reward-punishment``）；
      key 本身无日期前缀或去后为空则原样用 key。
    - 其余（作者自定义文案，含冒号形式 ``提案：xxx``）→ 原样返回（strip 后）。
    """
    semantic = DISPLAY_KEY_PREFIX_RE.sub("", change_key).strip() or change_key
    if not h1:
        return semantic
    stripped = h1.strip()
    if not stripped or TEMPLATE_H1_RE.match(stripped):
        return semantic
    return stripped
