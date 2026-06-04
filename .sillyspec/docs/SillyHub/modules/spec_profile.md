---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# spec_profile
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/spec_profile/**

## 职责

SillySpec Profile 管理模块，负责 profile manifest 的持久化存储、冲突检测（stage 冲突 / document 冲突）以及 profile 发现与加载。

- **Profile Manifest 管理**：SillySpec profile 的数据库持久化
- **冲突检测**：Stage 级别和 Document 级别的冲突检测策略
- **Profile 发现**：从文件系统发现和加载 profile manifest

## 当前设计

### 文件结构

```
backend/app/modules/spec_profile/
├── __init__.py
├── model.py        # ORM 模型定义
├── schema.py       # Pydantic 请求/响应 schema
├── policy.py       # 冲突检测策略
├── provider.py     # Profile 发现与加载
└── tests/
    └── test_policy.py  # 冲突检测策略单元测试
```

### 关键类

| 类名 | 文件 | 说明 |
|------|------|------|
| `SpecProfileManifest` | model.py | Profile manifest 表模型，含 name / version / profile_data（JSON）等 |
| `SpecConflict` | model.py | 冲突记录表模型，含 conflict_type / resource / details 等 |
| `ConflictDetail` | policy.py | 冲突详情 dataclass |
| `StagePolicy` | policy.py | Stage 级别冲突检测策略 |
| `DocumentPolicy` | policy.py | Document 级别冲突检测策略 |
| `ProfileManifestData` | provider.py | Profile manifest 数据结构，含 stages / documents / gates / agent_contracts |
| `SpecProfileProvider` | provider.py | Profile 发现与加载服务 |

### 关键 Schema

| 类名 | 文件 | 说明 |
|------|------|------|
| `SpecProfileManifestCreate` | schema.py | 创建 profile manifest 请求 |
| `SpecProfileManifestRead` | schema.py | 读取 profile manifest 响应 |
| `SpecProfileManifestListResponse` | schema.py | Profile manifest 列表响应 |
| `SpecConflictRead` | schema.py | 冲突记录读取响应 |
| `SpecConflictListResponse` | schema.py | 冲突列表响应 |
| `SpecConflictResolve` | schema.py | 冲突解决请求 |

### 关键函数

| 函数 | 文件 | 说明 |
|------|------|------|
| `StagePolicy.check_stage_conflict()` | policy.py | 检测 stage 级别冲突 |
| `DocumentPolicy.check_document_conflict()` | policy.py | 检测 document 级别冲突 |
| `SpecProfileProvider.discover_manifests()` | provider.py | 从文件系统发现所有 profile manifest |
| `SpecProfileProvider.load_manifest()` | provider.py | 加载指定路径的 profile manifest |
| `SpecProfileProvider.get_active_manifest()` | provider.py | 获取当前活跃的 profile manifest |

## 对外接口

spec_profile 模块当前**没有 HTTP 路由**（无 APIRouter），仅通过 Python API 供其他模块调用。

| 导出 | 类型 | 说明 |
|------|------|------|
| `SpecProfileManifest` | 模型 | Profile manifest ORM 模型 |
| `SpecConflict` | 模型 | 冲突记录 ORM 模型 |
| `StagePolicy` | 类 | Stage 冲突检测策略 |
| `DocumentPolicy` | 类 | Document 冲突检测策略 |
| `SpecProfileProvider` | 类 | Profile 发现与加载服务 |
| `ProfileManifestData` | 数据类 | Manifest 数据结构 |

## 关键数据流

1. **Profile 发现流**：SpecProfileProvider.discover_manifests() → 扫描 source_path → 解析 manifest JSON → 返回 ProfileManifestData 列表
2. **Profile 加载流**：SpecProfileProvider.load_manifest(path) → 读取 JSON 文件 → 解析 stages/documents/gates/agent_contracts → ProfileManifestData
3. **冲突检测流**：StagePolicy.check_stage_conflict(existing_stages, new_stages) → 比对 → 返回 ConflictDetail 列表
4. **冲突检测流（Document）**：DocumentPolicy.check_document_conflict(existing_docs, new_docs) → 比对 → 返回 ConflictDetail 列表

## 设计决策

| 决策 | 原因 | 替代方案 |
|------|------|----------|
| Policy 类分离检测逻辑 | 策略模式，可独立测试和替换 | 检测逻辑写在 service 中 |
| 无 HTTP 路由 | 当前仅作为内部服务使用 | 暴露 REST API |
| ProfileManifestData 数据类 | 类型安全的数据传递 | 使用 dict |
| 文件系统发现 | Profile 定义在 .sillyspec 目录中 | 数据库存储 profile 定义 |

## 依赖关系

### 内部依赖
- `app.models.base` — BaseModel
- `app.core.logging` — get_logger

### 外部库
- sqlmodel — ORM 模型（SQLModel + SQLAlchemy Column 类型）
- pydantic — Schema 定义
- 标准库 json / pathlib / dataclasses

## 注意事项

- 模块当前没有 HTTP 路由，所有功能通过 Python API 调用
- `SpecProfileProvider` 构造时接受 `source_path` 参数，为 None 时使用默认路径
- `StagePolicy` 和 `DocumentPolicy` 有完整的单元测试（`tests/test_policy.py`）
- `ProfileManifestData` 的 `stages` / `documents` / `gates` / `agent_contracts` 属性返回 `list[dict[str, Any]]`，尚未强类型化
- `SpecConflict` 模型使用 `conflict_type` 字段区分冲突类型（Literal 枚举）

## 变更索引

| 日期 | 变更 | 影响 |
|------|------|------|
| | | |
