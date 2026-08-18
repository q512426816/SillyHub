---
schema_version: 1
doc_type: module-card
module_id: models
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 数据模型基座（models）

## 定位
全后端共享的 SQLModel 基类与唯一 metadata 载体。整个模块只有 `app/models/base.py` 一个实体文件：`BaseModel(SQLModel)`，不定义任何具体表——所有表都放在各 feature 模块的 `model.py` 里并继承 `BaseModel`，从而共享同一个 `BaseModel.metadata`（Alembic autogenerate 扫描的就是这份 metadata）。

## 契约摘要
- `BaseModel`：应用级模型基类，无额外字段与行为。新表必须继承它（而不是直接继承 `SQLModel`），否则表脱离 metadata、autogenerate 看不见。
- `app/models/__init__.py` 只 re-export `BaseModel`，刻意不 import 任何 feature 模块——避免 `app.models` ↔ feature 模块循环依赖。
- feature 模块的表通过 `backend/migrations/env.py` 顶部逐个 eager import 登记进 metadata（登记清单见 migrations 卡）；本模块自身不参与登记。

## 关键逻辑
```
class BaseModel(SQLModel):   # app/models/base.py 全部内容
    pass
# 各模块: class Change(BaseModel, table=True): ...
# alembic autogenerate 扫 BaseModel.metadata → 生成迁移
```

## 注意事项
- 新建 ORM 表的固定三步：feature 模块定义 `class X(BaseModel, table=True)` → 在 `migrations/env.py` import 清单登记 → 生成 migration。漏第二步是历史上 autogenerate 漏表的根因（2026-08-14 architecture-4a §8 补登记过一批较新模块）。
- 不要往 `BaseModel` 加通用字段（created_at 之类）：存量表多、各模块时间列定义并不一致（datetime 列 / UTC / default 差异大），统一基类字段会引发大范围无意义迁移。
- `models` 模块零依赖（depends_on 为空）且被几乎所有业务模块反向依赖，改它等于全量影响面——实践中把它当只读稳定层。
- 判断某表归哪个模块：一律在 `app/modules/<feature>/model.py`，跨模块复用的表不存在（ppm 的共享原语在 `ppm/common/` 而非这里）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
