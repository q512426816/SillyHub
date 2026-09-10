"""skill_source 模块测试包（task-01：模型约束 + 源 CRUD）。

模块导入即在共享 ``BaseModel.metadata`` 注册两表（根 conftest ``db_engine``
的 create_all 才能扫到，见 backend/conftest.py 注释先例）。
"""
