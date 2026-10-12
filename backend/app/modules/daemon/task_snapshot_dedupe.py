"""任务快照读侧去重（2026-10-12-session-defects task-06 / FR-07 / D-005 兜底）。

历史幽灵成对行（写侧根治 2026-10-12-session-defects task-03 落地前的存量数据：
同名 stopped(空摘要)+completed(真摘要) 双行，生产会话 47e2ff1a 实证 21 组）在
读侧统一收敛——导出（session/service/export.py:702 _fetch_export_tasks）与
任务列表 API（router/session_insights.py:602 GET /sessions/{id}/tasks）共用本
判定，保证「每任务名至多一行真实终态行」的展示不变量。

去重口径（纯函数，不碰 DB、不改行）：
- 按 (session_id, task_name) 分组；
- 组内**真实终态行**（completed/failed/stopped）只保留一条：终态优先序
  completed > failed > stopped，同优先序取 updated_at 最新——清扫 stopped 残影
  （RUN_CLOSE_SWEEP_REASON 行）与迟到异种终态旧行被收敛；
- 组内 running 行**全部透传**：同名多 running 是合法的重试重生成在途实例
  （生产「评审后断点续跑收口」×6 同名异实例实证，D-009@v1），不误杀；
- 无重复的输入零变化（行集与相对顺序原样）。

与写侧的分界：本模块只做读侧展示收敛，不改 agent_task_store.py（写侧不变量
归 task-03，Wave 内文件正交）；去重按终态状态判定，不依赖
RUN_CLOSE_SWEEP_REASON 文案匹配（文案仅兼作复活标记，语义耦合禁入）。
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final

from app.modules.daemon.model import AgentSessionTask

# 真实终态优先序（数值大者优先）：completed > failed > stopped。
_TERMINAL_PRIORITY: Final[dict[str, int]] = {"completed": 3, "failed": 2, "stopped": 1}


def dedupe_task_snapshots(rows: Sequence[AgentSessionTask]) -> list[AgentSessionTask]:
    """同 (session_id, task_name) 分组收敛真实终态行至多一条，其余透传。

    输出保持输入相对顺序（调用方 updated_at desc 排序语义不变）。
    """
    best_terminal: dict[tuple[object, str], AgentSessionTask] = {}
    for row in rows:
        priority = _TERMINAL_PRIORITY.get(row.status)
        if priority is None:
            continue  # running 行透传，不参与终态收敛
        key = (row.session_id, row.task_name or "")
        incumbent = best_terminal.get(key)
        if incumbent is None:
            best_terminal[key] = row
            continue
        incumbent_priority = _TERMINAL_PRIORITY.get(incumbent.status, 0)
        row_updated = row.updated_at
        incumbent_updated = incumbent.updated_at
        if priority > incumbent_priority or (
            priority == incumbent_priority
            and row_updated is not None
            and incumbent_updated is not None
            and row_updated > incumbent_updated
        ):
            best_terminal[key] = row

    dropped: set[object] = set()
    for row in rows:
        priority = _TERMINAL_PRIORITY.get(row.status)
        if priority is None:
            continue
        key = (row.session_id, row.task_name or "")
        if best_terminal.get(key) is not row:
            dropped.add(row.id)
    if not dropped:
        return list(rows)
    return [row for row in rows if row.id not in dropped]
