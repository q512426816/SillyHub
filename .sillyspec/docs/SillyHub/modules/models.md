---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# models
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/models/**

## 职责

定义全局 ORM 基类，为所有业务模型提供统一的 SQLModel 元数据对象。所有业务模型必须继承 `BaseModel` 而非直接继承 `SQLModel`。

- 提供 `BaseModel` 基类，统一 metadata 对象
- 通过 `__init__.py` 导出 `BaseModel` 供各模块引用

## 当前设计

### 文件结构

```
backend/app/models/
├── __init__.py    # 导出 BaseModel
└── base.py        # BaseModel 定义
```

### 关键类

| 类名 | 文件 | 说明 |
|------|------|------|
| `BaseModel` | base.py | 应用基础模型类，继承自 SQLModel，所有业务模型必须继承此类 |

### BaseModel 设计

- 继承 `SQLModel`
- 确保所有子模型共享同一个 `metadata` 对象（SQLAlchemy 表注册）
- 项目约定：禁止直接继承 `SQLModel`，统一使用 `BaseModel`

## 对外接口

| 导出 | 类型 | 说明 |
|------|------|------|
| `BaseModel` | 类 | 应用基础模型类，所有业务模型的父类 |

## 关键数据流

1. **模型定义流**：业务模块定义 Model → 继承 BaseModel → SQLAlchemy 自动注册到 metadata → Alembic 生成迁移
2. **导入流**：各模块 `from app.models.base import BaseModel`

## 设计决策

| 决策 | 原因 | 替代方案 |
|------|------|----------|
| 单一 BaseModel 基类 | 统一 metadata，避免多基类导致表注册分散 | 各模块直接使用 SQLModel |
| 独立 models 包 | 集中管理基类，各模块只引用 | 在各模块内定义基类 |

## 依赖关系

### 内部依赖
- 无（这是最底层的包）

### 外部库
- sqlmodel — SQLModel ORM 基类

## 注意事项

- 所有新增业务模型必须继承 `BaseModel`，不可直接继承 `SQLModel`
- 如果需要为 BaseModel 添加通用字段（如 id / created_at / updated_at），应在此处修改，影响全局
- `__init__.py` 仅导出 `BaseModel`，不导出具体业务模型

## 变更索引

| 日期 | 变更 | 影响 |
|------|------|------|
| | | |
