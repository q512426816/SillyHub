---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# change
> 最后更新：2026-06-08
> 最近变更：2026-06-08-change-center-columns（Parser 推断方法 + reparse 覆盖）
> 模块路径：backend/app/modules/change/**

## 职责

Change 模块是 SillySpec 工作流的核心，负责变更（Change）的完整生命周期管理：从文件系统解析变更定义、CRUD 操作、阶段流转（state machine）、审批流程、进度更新，到 Agent 自动调度。它是连接工作区（workspace）、任务（task）和 AI 执行（agent）的枢纽模块。

核心能力包括：
- 变更的解析与同步（从 `.sillyspec/changes/` 目录解析 Markdown 文件）
- 变更类型自动推断（从目录结构推断 feature/quick/prototype）
- 影响组件自动推断（从 tasks.md 文件路径匹配 module-map）
- 变更 CRUD（list、get、documents 查询）
- 阶段流转（transition）：draft → propose → plan → execute → verify → accepted
- 审批流程（approve / reject）
- 进度更新（progress）
- 文档同步（sync_documents）
- 反馈提交（feedback）
- 归档前置检查（archive-gate）
- Agent 调度（dispatch）：根据阶段配置自动创建 Agent 运行
- Agent 状态查询

## 当前设计

模块分为六层：

```
router.py    → HTTP 接口层（16 个端点）
service.py   → 业务逻辑层（ChangeService，~850 行）
dispatch.py  → 调度引擎（SillySpecStageDispatchService + 独立调度函数）
parser.py    → 文件解析器（ChangeParser，解析 .sillyspec 目录结构 + 推断 change_type/affected_components）
model.py     → 数据模型（Change, ChangeDocument, StageEnum）
schema.py    → Pydantic 请求/响应 schema（~20 个模型）
prompts/     → 各阶段的 prompt 模板
  archive.md, brainstorm.md, execute.md, plan.md,
  propose.md, quick.md, scan.md, verify.md
tests/       → 测试（router, parser, dispatch, transition_response）
```

### 阶段枚举（StageEnum）

```
SillySpec 主阶段:  scan → brainstorm → propose → plan → execute → verify → archive → quick
Hub 业务扩展:      draft → rework_required → accepted
```

### 关键类

| 类 | 文件 | 说明 |
|---|---|---|
| `Change` | model.py | 变更主表（SQLModel ORM），含 workspace_id、change_key、status、stages、approval 等字段 |
| `ChangeDocument` | model.py | 变更文档表（proposal、design、plan 等） |
| `StageEnum` | model.py | 阶段枚举（11 个阶段） |
| `ChangeService` | service.py | 核心业务服务（~20 个公开方法） |
| `ChangeParser` | parser.py | 文件解析器，从 .sillyspec 目录解析变更定义 + 推断类型和影响组件 |
| `SillySpecStageDispatchService` | dispatch.py | 阶段调度服务 |
| `StageAgentConfig` | dispatch.py | 阶段 Agent 配置 |
| `StageSyncResult` | dispatch.py | 阶段同步结果 |

## 对外接口（表格）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/workspaces/{workspace_id}/changes` | 列出变更列表 |
| GET | `/workspaces/{workspace_id}/changes/{change_id}` | 获取变更详情 |
| GET | `/workspaces/{workspace_id}/changes/{change_id}/documents` | 获取文档矩阵 |
| GET | `/workspaces/{workspace_id}/changes/{change_id}/documents/{doc_type}` | 获取单文档内容 |
| POST | `/workspaces/{workspace_id}/changes/reparse` | 重新解析变更（从文件系统同步） |
| POST | `/workspaces/{workspace_id}/changes/{change_key}/progress` | 更新进度 |
| GET | `/workspaces/{workspace_id}/changes/{change_key}/approval` | 获取审批状态 |
| POST | `/workspaces/{workspace_id}/changes/{change_key}/approve` | 审批通过 |
| POST | `/workspaces/{workspace_id}/changes/{change_key}/reject` | 审批拒绝 |
| POST | `/workspaces/{workspace_id}/changes/{change_key}/documents` | 同步文档 |
| POST | `/workspaces/{workspace_id}/changes/{change_id}/transition` | 阶段流转 |
| POST | `/workspaces/{workspace_id}/changes/{change_id}/feedback` | 提交反馈 |
| GET | `/workspaces/{workspace_id}/changes/{change_id}/archive-gate` | 归档前置检查 |
| GET | `/workspaces/{workspace_id}/changes/{change_id}/agent-status` | 查询 Agent 运行状态 |
| POST | `/workspaces/{workspace_id}/changes/{change_id}/dispatch` | 手动触发调度 |

## 关键数据流

```
文件系统 .sillyspec/changes/<change-key>/
  → ChangeParser.parse_workspace()
    → ParsedChange（frontmatter + 文档列表）
      → ChangeService.reparse()
        → _sync_change_workspaces() 多对多关联
        → _sync_docs() 文档同步
        → upsert Change + ChangeDocument 记录
```

```
用户 → router.transition_change
  → ChangeService.transition_with_dispatch()
    → 校验阶段流转合法性（can_transition + TRANSITIONS）
    → 更新 Change 状态
    → SillySpecStageDispatchService.dispatch_next_step()
      → get_config_for_stage() 查询阶段配置
      → dispatch() → AgentService.start_stage_dispatch()
```

```
用户 → router.sync_documents
  → ChangeService.sync_documents()
    → 从文件系统读取文档内容
    → upsert ChangeDocument 记录
```

## 设计决策（表格）

| 决策 | 原因 | 备注 |
|---|---|---|
| 文件系统作为 Source of Truth | SillySpec 文档驱动开发，变更定义在 .sillyspec 目录中 | reparse 用于同步 |
| 阶段枚举统一管理 | 11 个阶段（8 SillySpec + 3 Hub）集中定义 | StageEnum |
| TRANSITIONS 白名单 | 防止非法阶段跳转 | model.py 中定义 |
| 调度与业务分离 | dispatch.py 独立于 service.py，职责清晰 | 调度逻辑复杂度高 |
| prompt 模板外部化 | 各阶段 prompt 以 Markdown 文件存储在 prompts/ 目录 | load_prompt_template() |
| 多对多 Change-Workspace | 一个变更可关联多个 workspace | ChangeWorkspace 中间表 |
| 文档矩阵（doc matrix） | 变更下多文档类型（proposal/design/plan 等）的结构化展示 | ChangeDocMatrix schema |
| 角色权限控制 | transition/approve 等操作按角色校验 | require_permission |

## 依赖关系

### 内部依赖（被本模块使用）

| 依赖模块 | 用途 |
|---|---|
| `app.core.auth_deps` | 权限校验 |
| `app.core.db` | 数据库会话 |
| `app.core.errors` | 错误类型（ChangeNotFound, InvalidTransition, PermissionDenied 等） |
| `app.core.logging` | 日志 |
| `app.core.spec_paths` | SpecPathResolver 文件路径解析 |
| `app.modules.auth` | User 模型、Permission 权限 |
| `app.modules.agent` | AgentRun 模型、AgentService（调度时创建运行） |
| `app.modules.workspace` | Workspace、ChangeWorkspace 中间表 |
| `app.models.base` | BaseModel 基类 |

### 被依赖（其他模块使用本模块）

| 使用方模块 | 用途 |
|---|---|
| `agent` | 读取 Change/ChangeDocument 用于上下文构建 |
| `archive` | 归档变更、读取 ChangeDocument |
| `change_writer` | 创建变更、生成文档、触发调度 |
| `task` | Task 关联 Change，使用 ChangeService 查询 |

## 注意事项

1. **reparse 的幂等性**：多次调用 reparse 应产生相同结果（upsert 逻辑）。
2. **reparse 覆盖策略**：`_apply_parsed()` 中 change_type 仅在 DB 值为 null 时覆盖（保护用户手动设置），affected_components 有值时始终覆盖（推断值更准确）。
2. **阶段流转校验**：`can_transition()` 和 TRANSITIONS 白名单双重保障，非法跳转会抛出 `InvalidTransition`。
3. **调度异步性**：`dispatch` 创建 Agent 运行是异步的，`agent-status` 端点用于查询运行状态。
4. **prompt 模板**：各阶段 prompt 存放在 `prompts/` 目录下，新增阶段需同步添加模板文件。
5. **workspace 多对多**：一个 Change 可关联多个 Workspace（通过 ChangeWorkspace 中间表），`enrich_with_workspace_ids` 用于填充。
6. **权限控制**：transition、approve、reject 等写操作需要相应权限。

## 变更索引（表格，初始为空）

| 变更 ID | 类型 | 简述 | 日期 |
|---|---|---|---|
| ql-20260605-002 | quick | sync_stage_status dual-db fallback + reparse before complete_stage | 2026-06-05 |
| 2026-06-08-change-center-columns | feature | 变更中心列展示优化：Parser 推断 change_type/affected_components + reparse 覆盖 + 前端展示 | 2026-06-08 |
