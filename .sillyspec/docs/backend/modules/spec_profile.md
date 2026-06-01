---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# spec_profile — Spec profile 管理

> 最后更新：2026-05-31
> 最近变更：初始模块文档
> 模块路径：`app/modules/spec_profile/**`

## 职责

管理 SillySpec profile 的发现、加载和冲突检测。定义 profile manifest 的数据模型，提供 manifest 发现和加载的 Provider 层，以及平台需求与 spec profile 之间的冲突检测 Policy 层。当前为 **stub/placeholder** 状态，核心逻辑待后续实现。

## 当前设计（架构 + 关键逻辑）

### 架构

本模块采用 Provider-Policy 分层设计，暂无 Router 和 Service：

- **Model** — `SpecProfileManifest` 和 `SpecConflict` 两个 SQLModel 表
- **Schema** — Pydantic DTO（Create/Read/List/Resolve）
- **Provider** — `SpecProfileProvider`：manifest 发现和加载（stub）
- **Policy** — `StagePolicy` + `DocumentPolicy`：冲突检测（stub）

### 数据模型

**spec_profile_manifests 表**（`SpecProfileManifest`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID (PK) | 主键 |
| source_path | Text | Profile 源路径 |
| version | String(64) | SillySpec 版本号 |
| manifest_json | Text \| None | 完整 manifest JSON |
| is_active | Boolean | 是否为当前激活的 profile |
| created_at | DateTime | 创建时间 |

- 索引：`ix_spec_profile_manifests_is_active`
- 业务约束：同一时间仅允许一个 `is_active=True` 的记录（service 层保证）

**spec_conflicts 表**（`SpecConflict`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID (PK) | 主键 |
| workspace_id | UUID (FK→workspaces) | 所属 workspace |
| change_id | UUID \| None | 关联变更（可选） |
| task_id | UUID \| None | 关联任务（可选） |
| stage | String(64) | 冲突所在阶段 |
| conflict_type | String(32) | 类型：gate / schema / path / validation |
| details_json | Text \| None | 冲突详情 JSON |
| status | String(20) | 状态：open / approved / rejected / resolved |
| created_at | DateTime | 创建时间 |

- 索引：workspace_id、status、stage
- 级联删除：workspace 删除时自动删除关联冲突

### SpecProfileProvider（Stub）

提供 manifest 的发现和加载接口：

- `discover_manifests()` — 扫描源目录，返回可用 manifest 列表
- `load_manifest(profile_path)` — 加载单个 manifest
- `get_active_manifest()` — 获取当前激活的 manifest

当前所有方法返回空值（`[]` / `None`），日志记录调用信息。

### ConflictDetail 数据结构

```
conflict_type: str   # gate / schema / path / validation
stage: str           # 冲突所在阶段
message: str         # 冲突描述
platform_requirement: dict  # 平台侧需求
spec_requirement: dict       # spec 侧需求
```

## 对外接口

本模块当前**无独立 Router**。SpecConflict 的 CRUD 由 `spec_workspace` 模块的 router 暴露：

- `GET /workspaces/{wid}/spec-conflicts` — 列出冲突
- `POST /workspaces/{wid}/spec-conflicts/{id}/resolve` — 解决冲突

## 关键数据流

```
冲突检测流程（设计中的未来实现）:
  平台需求变更
    → StagePolicy.check_stage_conflict(platform_stages, spec_stages)
      → 比较阶段定义、gate 兼容性、顺序约束
    → DocumentPolicy.check_document_conflict(platform_docs, spec_docs)
      → 比较文档 schema、路径约定、验证规则
    → 生成 ConflictDetail 列表
    → 写入 spec_conflicts 表
```

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Provider 分离 | 独立 Provider 类 | manifest 发现逻辑与业务逻辑解耦，便于测试和替换 |
| Policy 分离 | Stage + Document 两个 Policy | 不同类型冲突的检测逻辑独立，便于扩展 |
| 冲突表独立 | spec_conflicts 表 | 冲突可独立于 workspace 存在，支持级联删除 |
| Stub 优先 | 先定义接口后实现 | 上下游可并行开发，接口稳定后再填充逻辑 |

## 依赖关系

- **workspace**：`spec_conflicts.workspace_id` 外键关联 `workspaces.id`
- **spec_workspace**：冲突的列表和解决端点挂载在 spec_workspace router
- Provider 的 `DEFAULT_SOURCE_PATH` 硬编码为开发环境路径（待配置化）

## 注意事项

- Provider 当前硬编码了 Windows 路径 `C:\Users\qinyi\IdeaProjects\sillyspec` 作为默认源路径，生产环境需要通过配置注入
- `discover_manifests()` 的 TODO 注明将支持 `profile.yaml` / `manifest.json` 两种格式
- 冲突类型使用 Literal 类型约束为 `gate | schema | path | validation`，新增类型需修改两处
- SpecProfileManifest 的 `is_active` 唯一性未在 DB 层面保证，依赖 service 层逻辑

## 变更索引

| 日期 | 变更 |
|------|------|
| 2026-05-27 | 初始实现：model + provider + policy + schema |
| 2026-05-31 | 文档归档 |
