"""workbench 子域测试 conftest。

workbench 三块聚合 (profile / summary / calendar) 跨多张表读取:
- PlanTask / TaskExecute (ppm.task,根 conftest 已注册)
- PpmProblemList (ppm.problem,根 conftest 未注册 → 这里 import 触发建表)
- Organization / UserOrganization / User / Role / UserWorkspaceRole
  (admin / auth,根 conftest 已注册)

这里显式 import problem 模型,确保根 conftest 的 ``create_all`` 能建出
``ppm_problem_list`` 等 6 张 problem 表 (defect_count / 待办派生依赖)。
"""

from __future__ import annotations

# problem 子域模型 (6 表,defect_count + 待办派生读取 ppm_problem_list)
from app.modules.ppm.problem import model as _problem_model  # noqa: F401
