"""problem 子域测试 conftest。

确保 problem 模型 + 依赖的 ppm.project 模型注册到 ``BaseModel.metadata``,
使根 conftest 的 ``create_all`` 能建出 6 张 problem 表 + project_member 表
(审批流按角色查 ppm_project_member)。
"""

from __future__ import annotations

# problem 子域模型 (6 表)
from app.modules.ppm.problem import model as _problem_model  # noqa: F401

# 审批流依赖:ppm_project_member (按角色查下一处理人)
from app.modules.ppm.project import model as _project_model  # noqa: F401
