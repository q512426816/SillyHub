---
id: task-09
title: "同步 SillySpec 模块文档"
priority: P0
estimated_hours: 2
depends_on:
  - task-01
  - task-02
  - task-03
  - task-04
  - task-05
  - task-06
  - task-07
  - task-08
blocks:
  - task-10
allowed_paths:
  - .sillyspec/docs/backend/modules/agent.md
  - .sillyspec/docs/backend/modules/spec_workspace.md
  - .sillyspec/docs/frontend/scan/INTEGRATIONS.md
  - .sillyspec/docs/frontend/scan/PROJECT.md
author: qinyi
created_at: 2026-06-02T14:30:00
---

# task-09: 同步 SillySpec 模块文档

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `.sillyspec/docs/backend/modules/agent.md` | 记录 `pending_input`/`user_input` 新通道、`submit_run_input()` 服务方法、`POST /runs/{id}/input` 端点、bootstrap 用户指导事件和 SSE 行为 |
| 修改 | `.sillyspec/docs/backend/modules/spec_workspace.md` | 记录 bootstrap 从同步 CLI 改为异步 AgentRun 启动、后台 ClaudeCodeAdapter 执行链路、验证收尾流程、`/spec-bootstrap` 立即返回语义、`AgentRunWorkspace` M:N 关联 |
| 修改 | `.sillyspec/docs/frontend/scan/INTEGRATIONS.md` | 记录 `spec-workspaces.ts` 中 `BootstrapResult` 改为 run/stream 语义、`agent.ts` 新增 `submitAgentRunInput` API 和 `AgentRunInputRequest`/`AgentRunInputResponse` 类型、bootstrap SSE 连接策略 |
| 修改 | `.sillyspec/docs/frontend/scan/PROJECT.md` | 更新 Workspace 初始化流程描述：点击 Bootstrap 后立即连接 SSE stream、展示日志和 pending_input 用户指导入口、Agent 控制台双入口交互 |

## 实现要求

1. **逐文件更新**：按下方各文件的具体修改要求，更新对应模块文档的各个章节，确保文档准确反映 task-01 至 task-08 实施后的代码状态。
2. **保持现有格式**：每个模块文档保留原有的章节结构（职责、当前设计、对外接口、关键数据流、设计决策、依赖关系、注意事项、变更索引）不变，只在对应章节内追加或修改内容。
3. **变更索引追加**：每个模块文档的"变更索引"表末尾追加一行，记录本次变更标识 `2026-06-02-spec-bootstrap-agent-stream-interaction` 和摘要。
4. **最近变更标记**：更新文档头部 `最近变更` 行为 `2026-06-02-spec-bootstrap-agent-stream-interaction`。
5. **最后更新日期**：更新文档头部 `最后更新` 行为 `2026-06-02`。
6. **不修改源代码文件**：本任务只修改 `.sillyspec/docs/` 下的文档，不触及 `backend/` 或 `frontend/src/` 中的任何代码文件。

### 文件 1: `.sillyspec/docs/backend/modules/agent.md` 具体修改

#### 对外接口表追加

在"对外接口"表格末尾追加：

```
| POST /workspaces/{ws}/agent/runs/{id}/input | submit_run_input() | 向 AgentRun 提交用户指导文本（pending_input 通道回复） | 前端 |
```

#### 关键数据流追加

追加两个新的数据流块：

```
前端 → POST /runs/{id}/input → AgentService.submit_run_input()
  → 校验 run 属于 workspace 且用户具备 WORKSPACE_WRITE
  → 创建 AgentRunLog(channel="user_input", content_redacted=content)
  → Redis Pub/Sub publish → SSE 推送到所有订阅该 run 的客户端
  ← { run_id, accepted: true }
```

```
Agent 执行中 → ClaudeCodeAdapter 输出 pending_input
  → AgentRunLog(channel="pending_input", content_redacted=问题文本)
  → Redis Pub/Sub publish → SSE 推送
  → 前端展示交互输入面板
  → 用户提交指导 → POST /input → 如上流程
```

#### 当前设计 - 关键逻辑追加

在"关键逻辑"列表中追加：

```
7. **用户指导输入**：`AgentService.submit_run_input()` 接受用户对 `pending_input` 事件的回复，写入 `AgentRunLog(channel="user_input")` 并通过 Redis Pub/Sub 推送给订阅该 run 的 SSE 客户端。新增通道约定：`pending_input`（Agent 请求用户确认或指导）和 `user_input`（用户提交的指导文本）。
```

#### 设计决策表追加

```
| pending_input/user_input 通道约定 | 用户指导作为结构化日志事件，复用 AgentRunLog + SSE 推送，不新增表或 schema enum | 2026-06-02-spec-bootstrap-agent-stream-interaction |
```

#### 变更索引追加

```
| 2026-06-02 | 2026-06-02-spec-bootstrap-agent-stream-interaction | 新增 `submit_run_input()` 服务方法、`POST /runs/{id}/input` 端点、`pending_input`/`user_input` 通道约定、SSE 用户指导推送 |
```

### 文件 2: `.sillyspec/docs/backend/modules/spec_workspace.md` 具体修改

#### 职责段更新

将现有职责描述更新为：

> 管理每个 workspace 对应的 spec 空间。提供 spec workspace 的 CRUD、导入/同步（stub）、**异步 bootstrap（通过 AgentRun + ClaudeCodeAdapter 后台执行）** 以及 spec conflict 的列表和解决。本模块是 spec 体系的核心协调层。

#### 当前设计 - 架构更新

将 BootstrapService 描述从：

> `SpecBootstrapService`：直接执行 `sillyspec init --dir <spec_root>` 初始化 spec 空间

改为：

> `SpecBootstrapService`：创建 AgentRun 记录、构造 bootstrap 专用 `AgentSpecBundle`，通过后台 `ClaudeCodeAdapter.run_with_bundle()` 异步执行 `sillyspec init` + `sillyspec run scan`，完成后 `SpecValidator` 验证收尾

#### Bootstrap 流程更新

将 Bootstrap 流程从当前的同步执行模式改为异步 AgentRun 模式：

```
`SpecBootstrapService.bootstrap()` 异步执行流程：

1. 加载 SpecWorkspace + Workspace 记录
2. 确保 spec_root 目录存在
3. 创建 AuditLog（start）
4. 创建 AgentRun(status=pending, agent_type="claude_code")
5. 创建 AgentRunWorkspace（M:N 关联 run 和 workspace）
6. 更新 AgentRun 状态为 running
7. 返回 agent_run_id + stream_url + status（立即返回，不等待执行完成）
8. 后台任务：构造 bootstrap 专用 AgentSpecBundle
   - task_key="spec-bootstrap"
   - task_title="Bootstrap spec workspace"
   - proposal/task_markdown 包含 init、scan、验证步骤
   - allowed_paths=[spec_root, code_root]
   - available_tools=["sillyspec"]
   - platform_metadata={"bootstrap": True, "workspace_id": ...}
9. 后台任务：ClaudeCodeAdapter.run_with_bundle() 执行
10. 后台任务：SpecValidator.validate(spec_root) 验证收尾
11. 后台任务：根据 CLI exit_code + 验证结果更新 run status、sync_status、创建 SpecConflict
12. 后台任务：创建 AuditLog（complete）
```

#### 对外接口表更新

将 `/spec-bootstrap` 行从：

```
POST | /workspaces/{wid}/spec-bootstrap | WORKSPACE_WRITE | dict | 直接执行 sillyspec init 初始化 spec 空间
```

改为：

```
POST | /workspaces/{wid}/spec-bootstrap | WORKSPACE_WRITE | dict | 创建异步 AgentRun 执行 bootstrap，立即返回 run 信息和 stream URL
```

#### 关键数据流更新

将 Bootstrap 流程数据流替换为：

```
Bootstrap 流程:
  POST /spec-bootstrap
    → SpecBootstrapService.bootstrap(workspace_id, user_id)
      → 加载 SpecWorkspace + Workspace
      → mkdir spec_root
      → AuditLog("spec_bootstrap.start")
      → AgentRun(status=pending, agent_type="claude_code")
      → AgentRunWorkspace(agent_run_id, workspace_id)
      → AgentRun(status=running)
      → return { agent_run_id, stream_url, status, spec_root, message }
      → [后台] build AgentSpecBundle
      → [后台] ClaudeCodeAdapter.run_with_bundle(bundle, on_log=callback)
      → [后台] SpecValidator.validate(spec_root)
      → [后台] update AgentRun status + output + exit_code
      → [后台] update SpecWorkspace sync_status (clean/dirty)
      → [后台] create SpecConflict for failures
      → [后台] AuditLog("spec_bootstrap.complete")
  ← { agent_run_id, stream_url: "/api/workspaces/{wid}/agent/runs/{run_id}/stream", status: "pending", spec_root, message: "Bootstrap agent run started." }
```

#### 设计决策表更新

将决策"Bootstrap 只触发 init"从：

> Bootstrap 只触发 init | 直接执行 `sillyspec init --dir <spec_root>` | 该入口用于快速初始化 spec 空间，避免长时间 Agent/scan 流程导致调用无输出或结束前才返回

改为：

> Bootstrap 异步 AgentRun | 创建 AgentRun 后立即返回，后台通过 ClaudeCodeAdapter 执行 | 前端可立即连接 SSE stream 获取实时进度，避免同步等待造成页面空白

#### 新增设计决策行

```
| Bootstrap 验证由后端收尾 | Agent prompt 要求自查，但最终 sync_status 必须由 SpecValidator.validate() 决定 | 避免 CLI 自然语言输出和平台状态不一致 |
```

#### 依赖关系更新

在"依赖关系"中，将 agent 依赖从：

> agent：AgentRun, AgentRunLog — bootstrap 跟踪记录和日志可见性

改为：

> agent：AgentRun, AgentRunLog, AgentSpecBundle, ClaudeCodeAdapter — bootstrap 异步执行链路和日志流

#### 注意事项更新

删除现有注意事项：

> bootstrap 不再执行 Agent/scan，只触发 `sillyspec init`；CLI 超时设为 600 秒

替换为：

> bootstrap 通过 ClaudeCodeAdapter 异步执行，prompt 包含 `sillyspec init --dir <spec_root>` 和 `sillyspec run scan --dir <spec_root>`；前端通过 SSE stream 实时获取执行进度
> bootstrap 后台执行异常时，外层 try/except/finally 保证 AgentRun status 更新为 failed 并写入 stderr 日志

#### 变更索引追加

```
| 2026-06-02 | 2026-06-02-spec-bootstrap-agent-stream-interaction | `/spec-bootstrap` 改为异步 AgentRun + ClaudeCodeAdapter 后台执行 + SpecValidator 验证收尾，立即返回 stream_url |
```

### 文件 3: `.sillyspec/docs/frontend/scan/INTEGRATIONS.md` 具体修改

#### API 模块清单表更新

将 `spec-workspaces.ts` 行的说明从：

```
bootstrap（返回 command/stdout/stderr）
```

改为：

```
bootstrap（异步返回 agent_run_id + stream_url + status）、conflicts
```

将 `agent.ts` 行的说明从：

```
CRUD, logs, SSE stream（pending/running 连接，历史回放去重）
```

改为：

```
CRUD, logs, SSE stream（pending/running 连接，历史回放去重）, submit input（用户指导提交）
```

#### SSE 认证章节追加

在现有 SSE 认证说明末尾追加：

```
Bootstrap SSE 连接：Workspace 详情页点击 Bootstrap 后，前端调用 `/spec-bootstrap` 获取 `agent_run_id` 和 `stream_url`，立即通过 `streamAgentRunLogs(workspaceId, runId)` 建立 SSE 连接。SSE 推送包含 stdout/stderr/tool_call/pending_input/user_input 五种通道。前端对 pending_input 渲染交互输入面板，用户提交指导后通过 `POST /agent/runs/{run_id}/input` 提交，提交结果通过 SSE 的 user_input 事件回传。
```

#### 新增 Bootstrap API 说明段

在 SSE 认证章节之后追加：

```
### Bootstrap API

Workspace 详情页的 Bootstrap 流程使用以下 API 组合：

1. `POST /api/workspaces/{id}/spec-bootstrap` — 触发异步 bootstrap，返回 `BootstrapResult`（含 `agent_run_id`, `stream_url`, `status`）
2. `GET /api/workspaces/{id}/agent/runs/{run_id}/stream` — SSE 实时日志流，展示 bootstrap 执行进度
3. `POST /api/workspaces/{id}/agent/runs/{run_id}/input` — 用户指导输入提交（回复 pending_input）
```

### 文件 4: `.sillyspec/docs/frontend/scan/PROJECT.md` 具体修改

#### 流程一：Workspace 创建与初始化 更新

将步骤 7 从：

```
7. 进入 Workspace 详情页，执行 Bootstrap / Import / Sync 操作；Bootstrap 会展示 `sillyspec init` 的 command、exit code、stdout/stderr
```

改为：

```
7. 进入 Workspace 详情页，执行 Bootstrap / Import / Sync 操作
8. 点击 Bootstrap 后，调用 `/spec-bootstrap` 获取 `agent_run_id` 和 `stream_url`，立即连接 SSE stream
9. Bootstrap 执行过程中实时展示日志（stdout/stderr/tool_call/pending_input）
10. 当 Agent 需要 用户指导（pending_input）时，在日志下方展示交互输入面板，用户可提交指导文本
11. Bootstrap 完成后显示最终状态和验证结果
```

#### 流程三：Agent 执行与监控 更新

在现有流程末尾追加：

```
7. 识别 `pending_input` 通道日志时，展示交互输入面板，用户可提交指导文本
8. 提交指导通过 `POST /agent/runs/{run_id}/input` 接口，成功后 SSE 推送 `user_input` 事件
9. 对已完成 run 的展开日志，`pending_input` 和 `user_input` 以只读标记样式展示
```

## 接口定义

本任务为文档同步任务，不涉及代码接口定义。文档更新需严格对齐 task-01 至 task-08 实施后的实际代码行为。

### 文档验证方法

对照以下文件确认文档描述与代码一致：

1. **`backend/app/modules/spec_workspace/bootstrap.py`**：确认 bootstrap 流程为异步 AgentRun + ClaudeCodeAdapter 模式
2. **`backend/app/modules/spec_workspace/router.py`**：确认 `/spec-bootstrap` 端点返回 `agent_run_id` + `stream_url`
3. **`backend/app/modules/agent/service.py`**：确认 `submit_run_input()` 方法和 `pending_input`/`user_input` 通道
4. **`backend/app/modules/agent/router.py`**：确认 `POST /runs/{id}/input` 端点
5. **`frontend/src/lib/spec-workspaces.ts`**：确认 `BootstrapResult` 类型定义
6. **`frontend/src/lib/agent.ts`**：确认 `submitAgentRunInput` API 和 `AgentRunInputRequest`/`AgentRunInputResponse` 类型
7. **`frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`**：确认 Workspace 详情页的 bootstrap SSE 连接和用户输入交互
8. **`frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx`**：确认 Agent 控制台的 pending_input/user_input 展示

## 边界处理

1. **代码未实现时的文档**：如果 task-01 至 task-08 的某些任务尚未完全实施，文档中应描述 design.md 中规划的目标状态（而非当前代码状态），并在变更索引摘要中标注为"规划中"。如果所有 task 均已实施，则文档应与实际代码严格一致。
2. **空字段防御**：如果某个新增端点或方法在代码中不存在（例如 task-04/task-05 的 `submit_run_input` 尚未实现），不在文档中虚构该端点。只记录已确认存在的接口。
3. **向后兼容描述**：文档中应明确说明 bootstrap 的兼容策略——旧的 `BootstrapResult` 字段（如 `command`, `stdout`, `stderr`）是否保留，前端如何处理新老返回格式。
4. **变更索引格式一致**：每条变更索引的日期和变更标识格式必须与已有条目一致（`YYYY-MM-DD` 日期 + 变更标识 + 摘要）。
5. **不修改文档头部元数据**：文档头部的 `author` 和 `created_at` 字段保持原值不变，只更新 `最后更新` 和 `最近变更` 行。
6. **文档中不引用 task 编号**：文档应面向读者独立可读，不引用 `task-01`、`task-04` 等内部编号。使用功能描述代替（如"异步 AgentRun 启动"、"用户指导输入接口"）。

## 非目标

- 不修改 `backend/` 或 `frontend/src/` 下的任何代码文件。
- 不修改 `.sillyspec/docs/backend/modules/` 下除 `agent.md` 和 `spec_workspace.md` 以外的模块文档。
- 不修改 `.sillyspec/docs/frontend/scan/` 下除 `INTEGRATIONS.md` 和 `PROJECT.md` 以外的文档。
- 不新增模块文档文件。
- 不修改 `design.md` 或 `plan.md`。
- 不运行测试或 lint（由 task-10 负责）。
- 不更新其他未涉及的模块文档（如 `workspace.md`、`workflow.md` 等）。

## 参考

- `.sillyspec/changes/2026-06-02-spec-bootstrap-agent-stream-interaction/design.md` — 文件变更清单、API 设计、后台执行流程、前端交互、兼容策略
- `.sillyspec/changes/2026-06-02-spec-bootstrap-agent-stream-interaction/plan.md` — 任务总表和全局验收标准
- `.sillyspec/docs/backend/modules/agent.md` — 当前 agent 模块文档，作为更新基础
- `.sillyspec/docs/backend/modules/spec_workspace.md` — 当前 spec_workspace 模块文档，作为更新基础
- `.sillyspec/docs/frontend/scan/INTEGRATIONS.md` — 当前前端集成文档，作为更新基础
- `.sillyspec/docs/frontend/scan/PROJECT.md` — 当前前端项目文档，作为更新基础
- `backend/app/modules/spec_workspace/bootstrap.py` — 实际 bootstrap 实现代码
- `backend/app/modules/agent/service.py` — 实际 agent service 实现代码
- `backend/app/modules/agent/router.py` — 实际 agent router 端点代码
- `frontend/src/lib/spec-workspaces.ts` — 实际前端 spec-workspaces API 客户端
- `frontend/src/lib/agent.ts` — 实际前端 agent API 客户端

## TDD 步骤

本任务为文档同步，采用"读代码 -> 写文档 -> 对照验证"流程：

1. **读取实际代码**：逐一读取上述"参考"中列出的源代码文件，确认各端点、方法、类型的实际签名和行为。
2. **确认与 design 差异**：对比代码实际行为与 design.md 规划，记录偏差（如有）。
3. **编写文档**：按上述各文件的具体修改要求更新文档内容。
4. **验证**：逐条检查验收标准 AC-01 至 AC-08，确保文档描述与代码一致。
5. **回归**：确认未修改的文档章节内容保持不变。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 读取 `agent.md` 对外接口表 | 包含 `POST /workspaces/{ws}/agent/runs/{id}/input` 行，说明为"向 AgentRun 提交用户指导文本"。 |
| AC-02 | 读取 `agent.md` 关键数据流 | 包含 `submit_run_input()` 的完整数据流描述（校验 -> AgentRunLog -> Redis publish -> SSE 推送）。 |
| AC-03 | 读取 `agent.md` 关键逻辑 | 包含第 7 条"用户指导输入"描述，明确 `pending_input` 和 `user_input` 两个新通道约定。 |
| AC-04 | 读取 `spec_workspace.md` Bootstrap 流程 | 描述为异步 AgentRun + ClaudeCodeAdapter 后台执行模式，包含"立即返回 agent_run_id + stream_url"步骤，不再描述同步 CLI 执行。 |
| AC-05 | 读取 `spec_workspace.md` 对外接口表 | `/spec-bootstrap` 行说明为"创建异步 AgentRun 执行 bootstrap，立即返回 run 信息和 stream URL"。 |
| AC-06 | 读取 `spec_workspace.md` 设计决策表 | 包含"Bootstrap 异步 AgentRun"决策行，原有"Bootstrap 只触发 init"行已被替换。 |
| AC-07 | 读取 `INTEGRATIONS.md` API 模块清单 | `spec-workspaces.ts` 说明更新为"bootstrap（异步返回 agent_run_id + stream_url + status）"，`agent.ts` 说明包含"submit input（用户指导提交）"。 |
| AC-08 | 读取 `INTEGRATIONS.md` | 包含"Bootstrap SSE 连接"和"Bootstrap API"独立说明段，描述了 `/spec-bootstrap` + SSE stream + `/input` 三个 API 的组合使用。 |
| AC-09 | 读取 `PROJECT.md` 流程一 | Workspace 初始化流程包含步骤 8-11（Bootstrap 后 SSE 连接、实时日志、pending_input 交互、完成状态展示），原有步骤 7 的同步 stdout/stderr 描述已替换。 |
| AC-10 | 读取 `PROJECT.md` 流程三 | Agent 执行与监控流程包含步骤 7-9（pending_input 交互面板、指导提交、已完成 run 只读标记）。 |
| AC-11 | 读取全部四个文档的变更索引 | 每个文档末尾都追加了 `2026-06-02` + `2026-06-02-spec-bootstrap-agent-stream-interaction` 行。 |
| AC-12 | 读取全部四个文档的头部 | `最后更新` 为 `2026-06-02`，`最近变更` 为 `2026-06-02-spec-bootstrap-agent-stream-interaction`。 |
| AC-13 | 对比文档描述与实际代码 | 文档中描述的端点路径、方法名、参数名、返回字段与 `bootstrap.py`/`service.py`/`router.py`/`agent.ts`/`spec-workspaces.ts` 中的实际代码一致，无虚构接口。 |
| AC-14 | 检查变更范围 | 只修改了 `allowed_paths` 中列出的 4 个文档文件，未修改任何代码文件或其他文档。 |
