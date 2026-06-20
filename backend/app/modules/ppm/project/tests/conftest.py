"""project 子域测试 conftest。

确保 project 模型注册到 ``BaseModel.metadata``,使根 conftest 的
``create_all`` 能建出 ppm project 4 表 (根 conftest 未显式 import
ppm.project)。
"""

from __future__ import annotations

from app.modules.ppm.project import model as _project_model  # noqa: F401
