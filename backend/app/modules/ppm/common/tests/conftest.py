"""common 子域测试 conftest —— 注册 task/problem/project 模型到 BaseModel.metadata。

根 conftest 仅注册了 ppm.task;data_scope 测试还需 problem(问题清单)+ project
(项目成员,经理判定来源),在此补注册,使 ``create_all`` 能建出对应表。
"""

from __future__ import annotations

from app.modules.ppm.problem import model as _problem_model  # noqa: F401
from app.modules.ppm.project import model as _project_model  # noqa: F401
from app.modules.ppm.task import model as _task_model  # noqa: F401
