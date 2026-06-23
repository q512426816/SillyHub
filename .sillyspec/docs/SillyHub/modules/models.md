---
schema_version: 1
doc_type: module-card
module_id: models
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:33
---
# models

## 定位
后端数据模型基类层，只提供 `BaseModel` 与 SQLModel 元数据容器。所有业务表的 ORM 模型都继承自它，从而统一纳入审计钩子、共享 metadata、UUID 主键等约定。本身不定义任何业务表。

## 契约摘要
- `BaseModel(SQLModel)`：应用层所有持久化模型的基类。业务模型应继承 `BaseModel` 而非直接继承 `SQLModel`。
- `SQLModel.metadata`：全局共享的表元数据，`create_all` 与迁移基于此生成表结构。
- 业务模型再 `table=True` 声明为表，主键统一用 `uuid.UUID`（`id`），审计字段由各业务模型自行声明或经 `core.audit_hooks` 写入 audit_log。

## 关键逻辑
```
# 约定的模型定义范式（各业务模块 model.py 遵循）
class XxxModel(BaseModel, table=True):
    id: uuid.UUID = Field(primary_key=True, default=uuid4)
    ...业务字段...
# 所有表挂同一 SQLModel.metadata
# 继承 BaseModel → after_insert/update/delete 钩子识别实例并写 audit_log
```

## 注意事项
- 全应用唯一的数据模型基类入口；新增表必须 `BaseModel, table=True`，不要另立基类。
- 本模块仅含基类，不承载业务表；业务表定义分散在各业务模块的 `model.py`（如 `incident/model.py`、`git_identity/model.py`）。
- 改动基类（增删字段、调整 mixin）影响全部业务表，需全量回归与迁移评估。
- 本项目未正式上线，数据可清空，schema 变更无需考虑历史数据兼容。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
