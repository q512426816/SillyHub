"""ppm task 子域:任务计划 / 任务执行 / 工时。

覆盖 task-06 (FR-05、D-001@v1、D-003@v1):
- ``ppm_plan_task`` 任务计划 + 看板排序 (kanban_order)
- ``ppm_task_execute`` 任务执行 (executePlan 联动 + 状态机)
- ``ppm_work_hour`` 工时 (按 user/project 聚合统计)

平台级表 (无 tenant_id、无 workspace_id);权限走 ``PPM_TASK_*`` / ``PPM_WORKHOUR_*``。
"""

from __future__ import annotations
