---
schema_version: 1
doc_type: module-card
module_id: models
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 数据模型基类层（models）

## 定位
后端数据模型基类层。整个模块只有两个文件：`base.py` 定义应用基类 `BaseModel`，`__init__.py` re-export 它。不定义任何业务表，只提供「所有表挂同一 `SQLModel.metadata`」这一唯一约定，是 Alembic 迁移扫描的数据源头。

## 契约摘要
- `BaseModel(SQLModel)`：
  - 应用层所有持久化模型的唯一基类，业务模型继承它而非直接继承 `SQLModel`
  - 当前是空壳（`pass`），不加字段、不加 mixin——约定大于实现
- `SQLModel.metadata`（全局共享表元数据）：
  - 各特性模块 `model.py` 里的 `table=True` 子类 import `BaseModel` 时自动把表注册进同一份 metadata
  - Alembic autogenerate 经 `backend/migrations/env.py` 扫描这份共享 metadata，不经 `app.models`
  - `__init__.py` 明确注明：不经 `app.models` 聚合是为了避免 `app.models` 与特性模块循环 import
- 审计钩子不在这里：`core.audit_hooks` 在 core 层挂接，继承 `BaseModel` 的表自动纳入 audit_log 记录

## 关键逻辑
```
# 各业务模块 model.py 的统一范式
class XxxModel(BaseModel, table=True):
    __tablename__ = "xxx"
    id: uuid.UUID = Field(primary_key=True, default=uuid4)  # UUID 主键约定
    ...业务字段...
# import 即注册 → 所有表进同一 metadata → Alembic 扫描生成迁移
```

## 注意事项
- 全应用唯一基类入口；新增表必须 `BaseModel, table=True`，不要另立基类，也不要直接继承 SQLModel
- 本模块不承载业务表；表定义分散在各特性模块 `model.py`，找某张表先看对应模块卡片或 `_module-map.yaml`
- 主键约定是 UUID（`id` + `default_factory=uuid4`），个别表例外（如 `platform_settings` 用 String key 做主键、platform_sync 显式传 id）
- 基类当前是空壳，但改动它（如加审计 mixin / 公共字段）影响全部业务表与全部迁移，需全量回归评估
- 本项目未正式上线（PPM 除外）允许重置数据；但 PPM 已上线，涉其表结构的变更需按已上线标准谨慎处理

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
- 2026-08-20-session-multimodal-attachments：会话附件（图片多模态/文件落盘/multimodal 三态门控）涉及本模块（详见 changes 归档）
