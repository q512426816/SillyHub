---
author: qinyi
created_at: 2026-05-27 10:13:27
---

# Design

## 架构决策

### ADR-01: SillySpec 是 Agent 规范契约

SillySpec 不作为平台业务执行引擎，也不作为被管理项目准入门槛。平台将其作为 Agent-facing spec contract：阶段文档、任务输入、上下文约束、验收标准和门禁规则。

`C:\Users\qinyi\IdeaProjects\sillyspec` 是 profile 来源和参考实现。CLI 可用于导入、导出、校验或兼容执行，但平台业务流程不能依赖“目标项目必须运行 SillySpec CLI”。

### ADR-02: 默认 platform-managed

workspace 的代码目录和规范目录分离：

- `Workspace.root_path`: 被管理项目代码目录。
- `SpecWorkspace.spec_root`（新增）: 平台托管规范空间。
- repo `.sillyspec`: 可选同步目标。

默认策略为 `platform-managed`。`repo-mirrored` 和 `repo-native` 必须由用户显式选择。

### ADR-03: Agent 通过 Adapter Registry 接入

Agent 接入通过 `AgentAdapter` registry：

- 当前已有：`claude_code` -> `ClaudeCodeAdapter`。
- 后续扩展：`codex`、`cursor` 等。

业务流程只依赖 adapter 接口，不依赖具体 CLI 参数。

## 文件变更清单

### 后端

- 新增：`backend/app/modules/spec_workspace/model.py`
- 新增：`backend/app/modules/spec_workspace/schema.py`
- 新增：`backend/app/modules/spec_workspace/service.py`
- 新增：`backend/app/modules/spec_workspace/router.py`
- 新增：`backend/app/modules/spec_profile/model.py`
- 新增：`backend/app/modules/spec_profile/provider.py`
- 新增：`backend/app/modules/spec_profile/policy.py`
- 新增：`backend/app/modules/spec_profile/schema.py`
- 修改：`backend/app/modules/workspace/scanner.py`
- 修改：`backend/app/modules/workspace/service.py`
- 修改：`backend/app/modules/workspace/schema.py`
- 修改：`backend/app/modules/agent/base.py`
- 修改：`backend/app/modules/agent/context_builder.py`
- 修改：`backend/app/modules/agent/adapters/claude_code.py`
- 修改：`backend/app/modules/agent/service.py`
- 修改：`backend/app/modules/agent/schema.py`
- 修改：`backend/app/main.py`
- 新增迁移：`backend/migrations/versions/<timestamp>_create_spec_workspace.py`

### 前端

- 修改：`frontend/src/components/workspace-scan-dialog.tsx`
- 修改：`frontend/src/lib/workspaces.ts`
- 新增：`frontend/src/lib/spec-workspaces.ts`
- 修改：`frontend/src/lib/agent.ts`
- 修改：`frontend/src/app/(dashboard)/workspaces/[id]/runtime/page.tsx`
- 修改：`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/tasks/[tid]/page.tsx`
- 修改：`frontend/src/app/(dashboard)/settings/page.tsx`

## 数据模型

### 现有表

- `workspaces`: 保留 `root_path`，不再要求 root 下存在 `.sillyspec`。
- `agent_runs`: 保留 `agent_type`，新增运行上下文摘要字段。
- `tool_operation_logs` / `git_operation_logs` / `audit_logs`: 继续用于审计。

### 新增表：`spec_workspaces`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 主键 |
| `workspace_id` | UUID | 关联 `workspaces.id` |
| `spec_root` | Text | 平台托管规范目录 |
| `strategy` | String | `platform-managed` / `repo-mirrored` / `repo-native` |
| `repo_sillyspec_path` | Text nullable | 仓库 `.sillyspec` 路径 |
| `profile_version` | String | 当前使用的 `SpecProfileManifest` 版本 |
| `sync_status` | String | `clean` / `dirty` / `conflicted` |
| `last_synced_at` | DateTime nullable | 最近同步时间 |
| `created_at` | DateTime | 创建时间 |
| `updated_at` | DateTime | 更新时间 |

### 新增表：`spec_profile_manifests`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 主键 |
| `source_path` | Text | profile 来源路径 |
| `version` | String | SillySpec/package/profile 版本 |
| `manifest_json` | JSON/Text | 阶段、文档、门禁、Agent 契约 |
| `is_active` | Boolean | 是否默认启用 |
| `created_at` | DateTime | 创建时间 |

### 新增表：`spec_conflicts`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 主键 |
| `workspace_id` | UUID | 工作区 |
| `change_id` | UUID nullable | 关联变更 |
| `task_id` | UUID nullable | 关联任务 |
| `stage` | String | 冲突阶段 |
| `conflict_type` | String | `gate` / `schema` / `path` / `validation` |
| `details_json` | JSON/Text | 冲突详情 |
| `status` | String | `open` / `approved` / `rejected` / `resolved` |
| `created_at` | DateTime | 创建时间 |

## API 设计

### Workspace

- `POST /api/workspaces/scan`: 返回代码目录扫描结果和 `.sillyspec` 探测结果，但不把 `is_sillyspec=false` 作为失败。
- `POST /api/workspaces`: 创建 workspace，同时创建默认 `spec_workspace`。

### Spec Workspace

- `GET /api/workspaces/{workspace_id}/spec-workspace`
- `POST /api/workspaces/{workspace_id}/spec-workspace/import`
- `POST /api/workspaces/{workspace_id}/spec-workspace/sync`
- `GET /api/workspaces/{workspace_id}/spec-conflicts`
- `POST /api/workspaces/{workspace_id}/spec-conflicts/{conflict_id}/resolve`

### Agent

- `POST /api/workspaces/{workspace_id}/agent/runs`: 创建后台 Agent run。
- Request 新增或保留：
  - `task_id`
  - `lease_id`
  - `agent_type=claude_code`
  - `profile_version` optional
- Response 包含：
  - `id`
  - `status`
  - `agent_type`
  - `spec_strategy`
  - `profile_version`
  - `exit_code`

## Agent 执行链路

1. `scan` 完成后，平台生成或刷新托管 spec root。
2. 项目维护者确认 proposal/design/tasks/plan。
3. 用户选择 task 并获取 worktree lease。
4. `AgentService` 构造 `AgentSpecBundle`：
   - change summary
   - proposal / requirements / design / plan
   - task markdown
   - allowed paths / denied paths
   - acceptance criteria
   - profile gates
   - platform extension metadata
5. `ClaudeCodeAdapter` 将 bundle 渲染为 `CLAUDE.md` 和 prompt。
6. 平台在 lease repo 目录运行 `claude`。
7. 平台保存 run、logs、audit、diff 摘要和任务状态。

## 兼容策略

- 已有 `.sillyspec` 项目默认识别为 `repo-native` 候选，但用户可选择导入到 `platform-managed`。
- 旧 `Workspace.sillyspec_path` 暂时保留用于展示和迁移，新增逻辑以 `spec_workspaces` 为准。
- 前端兼容旧字段，但新建流程以 `spec_strategy` 为主。
- `claude-code` 前端值迁移为 `claude_code`，后端可短期接收 alias 并返回规范 key。

## 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| SillySpec profile 与平台规则漂移 | Agent 执行上下文错误 | manifest diff + 人工确认迁移 |
| Agent run 阻塞 HTTP 请求 | 请求超时、体验差 | 后台任务化，接口只创建 run |
| 同步回仓库覆盖用户文件 | 数据丢失 | 显式 sync、diff 预览、审计 |
| allowed paths 不完整 | Agent 无法完成任务 | 从 task + policy 合并，失败可编辑 |
| adapter 参数差异 | 多 Agent 接入困难 | registry + adapter-specific renderer |

## 自审

- 没有要求普通项目必须有 `.sillyspec`。
- 没有把 SillySpec CLI 作为平台唯一运行时。
- Agent 接入以规范契约为中心。
- 冲突处理有记录和审批路径。
- 新表、类、API 均标注为新增或修改。

---

## 设计修正（V2）

> brainstorm 阶段用户反馈后追加。核心问题：(1) spec 文件不应该和代码混放；(2) Agent 不应该猜格式，应该调用 SillySpec CLI；(3) 生成后需要程序验证。

### ADR-04: Spec Data Root 独立目录

规范文件与代码仓库完全分离。每个 workspace 的规范文件存储在独立的平台数据目录中。

**Why:** 代码仓库是用户的，规范文件是平台的。混放会导致：(1) 仓库污染；(2) 非 SillySpec 项目无法纳管；(3) 规范文件归属不清。

**How to apply:**

- `config.py` 新增 `spec_data_root: str` 配置项（默认 `/data/spec-workspaces` 或 Windows 对应路径）
- `SpecWorkspace.spec_root` 使用绝对路径：`{spec_data_root}/{workspace_id}/`
- spec_root 内部目录结构遵循 SillySpec 标准：`.sillyspec/projects/`, `.sillyspec/docs/`, `.sillyspec/changes/` 等
- 所有 parser（component/scan_docs/change/task/knowledge）改为从 `spec_root` 读取，不再从 `workspace.root_path/.sillyspec`
- `workspace.root_path` 仅用于代码文件访问和 Agent 执行

### ADR-05: SillySpec CLI 作为 Agent 工具

Agent 通过调用 SillySpec CLI 来生成规范的 `.sillyspec` 文件。CLI 是格式专家，Agent 是执行者。

**Why:** Agent 不知道 `.sillyspec` 文件的正确格式（YAML schema、目录结构、文档模板）。SillySpec CLI 本身就是为了这个目的设计的，包含完整的步骤 prompt 和格式规范。让 Agent 猜格式不如让 CLI 生成。

**How to apply:**

- `AgentSpecBundle` 新增 `available_tools: list[str]` 字段，默认包含 `["sillyspec"]`
- `ClaudeCodeAdapter` 在执行环境中确保 `sillyspec` CLI 可用
- Agent 的 prompt 中明确指示："使用 `sillyspec init --dir <spec_root>` 初始化，然后 `sillyspec run scan --dir <spec_root>` 扫描"
- 新增 API 端点：`POST /api/workspaces/{id}/spec-bootstrap` — 触发 Agent 使用 CLI 初始化规范空间
- Bootstrap 流程：Agent 在 spec_root 目录中执行 CLI 命令，CLI 生成文件，Agent 不直接写规范文件
- 已有 `.sillyspec` 的项目：Agent 调用 `sillyspec run scan --dir <spec_root>` 从代码仓库导入并修正

### ADR-06: SpecValidator 程序验证

规范文件生成后由平台 Python 代码进行程序化验证，不依赖 Agent 自评。

**Why:** 不能信任 Agent 的"我已生成完毕"反馈。验证必须是确定性的程序逻辑：YAML schema 校验、必填字段检查、引用完整性。

**How to apply:**

- 新增 `backend/app/modules/spec_workspace/validator.py` — `SpecValidator` 类
- 验证项目：
  - YAML schema 校验：每个 `projects/*.yaml` 必须有 `id`, `name`, `type` 字段
  - 引用完整性：`relations.target` 必须存在于组件列表中
  - 目录结构：至少有 `projects/` 目录
- 验证结果返回 `ValidationReport`（passed: bool, issues: list[ValidationIssue]）
- 验证失败 → 写入 `SpecConflict` 记录，sync_status = "dirty"
- 验证通过 → sync_status = "clean"
- 在 bootstrap 流程的 Agent run 完成后自动触发验证

### 修正后的文件变更清单

#### 后端新增

- `backend/app/modules/spec_workspace/validator.py` — SpecValidator
- `backend/app/modules/spec_workspace/bootstrap.py` — SpecBootstrapService（协调 Agent + CLI + Validator）
- `backend/app/modules/spec_workspace/router.py` — 新增 `/spec-bootstrap` 端点

#### 后端修改

- `backend/app/core/config.py` — 新增 `spec_data_root` 配置项
- `backend/app/modules/spec_workspace/model.py` — `spec_root` 改为绝对路径默认值
- `backend/app/modules/spec_workspace/service.py` — `create` 使用 `spec_data_root` 计算路径
- `backend/app/modules/workspace/service.py` — `_ensure_spec_workspace` 使用 `spec_data_root`
- `backend/app/modules/agent/base.py` — `AgentSpecBundle` 新增 `available_tools`
- `backend/app/modules/agent/context_builder.py` — `build_spec_bundle` 包含 `available_tools`
- `backend/app/modules/agent/adapters/claude_code.py` — 确保 `sillyspec` CLI 在执行环境中可用
- `backend/app/modules/component/service.py` — 改读 `spec_root`
- `backend/app/modules/scan_docs/service.py` — 改读 `spec_root`
- `backend/app/modules/change/service.py` — 改读 `spec_root`
- `backend/app/modules/task/service.py` — 改读 `spec_root`

### 后续变更（不在本次范围）

- "每个组件 = 一个工作空间"的架构重设计
- 跨工作空间组件引用与同步机制
- SillySpec CLI 的 `--dir` 参数支持（可能需要修改 CLI）
