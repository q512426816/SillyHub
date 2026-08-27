"""ppm 公共 helper 子包。

为 W1–W5 各子域四件套提供统一复用基础设施：

- :mod:`crud`   —— 通用分页/排序/查询参数 (PageReq / Page / apply_sort / apply_pagination)
- :mod:`export` —— openpyxl 通用 Excel 导出 (ColumnDef / rows_to_workbook / excel_response)
- :mod:`fsm`    —— 轻量状态机基类 (StateMachine / IllegalTransition)

各子域 (project/plan/problem/task/kanban) 自行定义自己的 TRANSITIONS
白名单与状态枚举，复用此处的 helper 而非各自重写。

2026-08-28-session-ppm-task-binding task-01 增补（design §5 Phase 1）：

- :mod:`session_binding` —— PPM 任务/问题 ↔ 会话绑定基座（ppm_item_session_links
  表 + 幂等 bind + 工作区解析 + item/File 读取 helper）
- :mod:`router` —— 平台级公共端点（GET /api/ppm/item-sessions 关联会话列表）

设计依据：``design.md`` §5 (common 公共 helper) + §10 R-04 (导出 helper)。
"""

from __future__ import annotations

__all__ = ["crud", "export", "fsm", "router", "session_binding"]
