"""plan 子域测试 conftest。

确保 plan 模型注册到 ``BaseModel.metadata``,使根 conftest 的
``create_all`` 能建出 plan 7 表 (根 conftest 未显式 import ppm.plan)。
"""

from __future__ import annotations

from app.modules.ppm.plan import model as _plan_model  # noqa: F401
