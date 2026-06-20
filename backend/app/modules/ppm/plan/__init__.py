"""plan 子域 — 计划节点模板 + ps 计划策划(里程碑 + 状态机)。

设计依据：``.sillyspec/changes/2026-06-20-ppm-module-migration/design.md``
§8 (数据模型里程碑简化 D-002@v1) + ``tasks/task-04.md``。

7 张表分两类：
- 模板簇 (3)：``ppm_plan_node`` / ``ppm_plan_node_detail`` / ``ppm_plan_node_module``
- ps 计划簇 (4)：``ppm_ps_project_plan`` / ``ppm_ps_plan_node`` /
  ``ppm_ps_plan_node_detail`` (核心简化表,状态机驱动 + parent_id 版本链) /
  ``ppm_ps_plan_node_detail_process`` (流程履历)

弃源 silly 的 ``ps_plan_node_detail_node`` / ``ps_plan_node_detail_variable``
两表 (D-002@v1) — 自定义表单能力由状态机覆盖。
"""

from __future__ import annotations

from app.modules.ppm.plan.router import router

__all__ = ["router"]
