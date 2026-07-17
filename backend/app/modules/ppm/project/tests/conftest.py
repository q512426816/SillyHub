"""project 子域测试 conftest。

确保 project / plan 模型注册到 ``BaseModel.metadata``,使根 conftest 的
``create_all`` 能建出 ppm project 4 表 + ppm_ps_project_plan 表
(根 conftest 未显式 import ppm.project / ppm.plan)。plan 表为
ql-20260717-004 project 改名同步 ps_project_plan 测试所需。
"""

from __future__ import annotations

from app.modules.ppm.plan import model as _plan_model  # noqa: F401
from app.modules.ppm.project import model as _project_model  # noqa: F401
