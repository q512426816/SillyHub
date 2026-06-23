---
schema_version: 1
doc_type: module-card
module_id: models
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:08:51
---
# models
## 定位
共享 ORM 基类层。仅定义一个 `BaseModel(SQLModel)`，所有业务模块的表模型继承它，从而共享同一个 `metadata` 对象（Alembic autogenerate 据此扫描）。本模块不含任何表定义或业务逻辑。
## 契约摘要
- `BaseModel`：应用统一 SQLModel 基类。业务模块 `model.py` 中的表一律 `class Xxx(BaseModel, table=True)`。
- 共享 `metadata`：所有表注册到同一个 `BaseModel.metadata`，Alembic 据此生成迁移。
## 关键逻辑
```
# 唯一内容
class BaseModel(SQLModel):
    """Inherit from this — not SQLModel — in models."""
    pass
```
## 注意事项
- 新建表必须继承 `BaseModel` 而非直接 `SQLModel`，否则该表不会被 Alembic autogenerate 发现。
- 本模块不要放任何具体表或工具函数，保持极薄，避免循环依赖。
- 改动几乎零风险，但若引入新混入字段/mixin 会影响所有子类，需谨慎。
## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
