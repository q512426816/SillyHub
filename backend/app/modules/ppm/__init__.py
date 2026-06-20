"""ppm 模块 — 项目与问题管理 (Project & Problem Management).

平台级业务域，对齐源 ``ppdmq-module-ppm`` (Java/Spring Boot) 的 6 子域：
pm 项目管理 / plan 计划节点模板 / ps 计划策划 / problem 问题清单 /
task 任务执行 / kanban 看板。

本包仅作模块入口。聚合 router 在 task-08 (W6 集成) 由
``app.main`` 以 ``prefix="/api/ppm"`` 挂载各子域 router 后统一导出；
当前 W0 阶段只有 ``common`` 公共 helper，无具体子域实现。

设计依据：``.sillyspec/changes/2026-06-20-ppm-module-migration/design.md`` §5。
"""

from __future__ import annotations

# 占位：子域 router 聚合在 task-08 完成。
# 届时此处可暴露 ``router = APIRouter()`` 并 include 各子域 router，
# 或保持各子域 router 由 ``app.main`` 直接挂载（当前采用的方案）。
router = None

__all__ = ["router"]
