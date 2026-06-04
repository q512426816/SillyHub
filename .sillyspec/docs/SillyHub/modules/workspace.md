---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# workspace
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/workspace/**

## 职责

Workspace 模块负责管理 SillySpec 工作区的完整生命周期：扫描本地目录结构、解析 `.sillyspec` 配置、持久化工作区元数据、管理工作区之间的关系（dependency / parent-child / sibling 等），以及生成拓扑图。

## 当前设计

模块按职责拆分为以下核心文件：

| 文件 | 角色 |
|------|------|
| `model.py` | ORM 模型 — `Workspace`, `WorkspaceRelation`, `ChangeWorkspace`, `TaskWorkspace`, `AgentRunWorkspace` |
| `schema.py` | Pydantic 请求/响应 DTO — `WorkspaceCreate`, `WorkspaceUpdate`, `WorkspaceRead`, `ScanRequest/Response`, `WorkspaceListResponse` |
| `relation_schema.py` | 关系相关 DTO — `RelationCreate`, `RelationRead`, `RelationListResponse`, `TopologyNode/Edge/Response` |
| `scanner.py` | 纯函数目录扫描器 — `WorkspaceScanner.scan()` 返回 `ScanResult` |
| `parser.py` | YAML 解析器 — `WorkspaceParser.parse()` 将 `.sillyspec` 配置转为 `ParsedWorkspace` + `ParsedRelation` |
| `topology.py` | 拓扑图构建器 — `TopologyBuilder.build()` 从 DB 数据生成全局拓扑 |
| `service.py` | 业务逻辑层 — `WorkspaceService` 协调扫描/解析/持久化/reparse |
| `relation_service.py` | 关系管理逻辑 — `RelationService` 处理 CRUD + 环检测 |
| `router.py` | FastAPI 路由 — 所有 REST 端点 |

### 核心流程

1. **扫描**：`POST /workspaces/scan` — 调用 `WorkspaceScanner.scan(root)` 分析目录结构
2. **创建**：`POST /workspaces` — 扫描 + 解析 + 持久化；支持复活已软删除的工作区
3. **重解析**：`POST /workspaces/{id}/reparse` — 重新解析父工作区，自动创建/更新/软删除子工作区（component）
4. **拓扑**：`GET /workspaces/topology` — 全局节点-边图

## 对外接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/workspaces/scan` | 扫描本地目录，返回结构信息 |
| POST | `/workspaces` | 创建工作区（扫描 + 解析 + 入库） |
| GET | `/workspaces` | 列出工作区（支持分页、include_deleted） |
| GET | `/workspaces/{id}` | 获取单个工作区 |
| PATCH | `/workspaces/{id}` | 更新工作区（name, slug, description 等） |
| DELETE | `/workspaces/{id}` | 软删除工作区 |
| POST | `/workspaces/{id}/rescan` | 重新扫描并更新 last_scanned_at |
| POST | `/workspaces/{id}/reparse` | 重新解析，同步子工作区 |
| GET | `/workspaces/{id}/relations` | 列出工作区的关系 |
| POST | `/workspaces/{id}/relations` | 创建关系 |
| DELETE | `/workspaces/{id}/relations/{rid}` | 删除关系 |
| GET | `/workspaces/topology` | 全局拓扑图 |

## 关键数据流

```
用户提交 root_path
  → WorkspaceScanner.scan(path) → ScanResult
  → WorkspaceParser.parse(path) → ParsedWorkspace + ParsedRelation[]
  → WorkspaceService.create() → Workspace ORM → DB
  → 子工作区（component）自动创建 via reparse
```

## 设计决策

| 决策 | 原因 |
|------|------|
| 软删除而非硬删除 | 保留审计追踪，允许"复活" |
| slug 自动生成 + 唯一约束 | 友好 URL 标识 |
| reparse 自动同步子工作区 | component-as-workspace 模型下，父工作区解析自动管理子工作区 |
| 环检测在 RelationService 层 | 防止 A→B→A 类型循环依赖 |
| scanner 纯函数（无 DB 依赖） | 可独立测试，不污染数据库 |

## 依赖关系

- **内部依赖**：`app.core.config`, `app.core.errors`, `app.core.logging`, `app.models.base`
- **外部依赖**：SQLModel, SQLAlchemy AsyncSession, Pydantic, PyYAML（通过 parser）
- **被依赖模块**：worktree（FK → workspaces.id）, change（通过 ChangeWorkspace M2N）, task（通过 TaskWorkspace M2N）, agent（通过 AgentRunWorkspace M2N）

## 注意事项

- `Workspace.scanner` 和 `Workspace.parser` 是纯函数层，不依赖数据库，测试时应直接使用
- `WorkspaceService.reparse()` 会自动软删除不再存在的子工作区，需谨慎处理级联影响
- slug 校验使用正则 `^[a-z0-9][a-z0-9-]*[a-z0-9]$`，不合法时由 `_validate_slug` 拒绝
- 软删除的工作区在默认 list 中隐藏，但 topology 接口也排除已删除工作区

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
