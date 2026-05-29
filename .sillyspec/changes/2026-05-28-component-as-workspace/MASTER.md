---
author: qinyi
created_at: 2026-05-29 17:02:45
---

# MASTER

## 主线

本轮主线不是再做一个普通多 Agent 功能，而是把 SillyHub 的平台底座收敛成：

```text
Workspace Graph 数据面
  -> Workflow / Spec Guardian 控制面
  -> Tool Gateway / Git Gateway 执行边界
  -> Local Runner 优先的 Agent 执行闭环
  -> Knowledge Candidate 审核沉淀
```

当前变更 `2026-05-28-component-as-workspace` 只承接第一段：把 Component 抽象并入 Workspace，把 WorkspaceRelation 图谱变成后续执行、上下文、权限和知识沉淀的统一数据基础。

## 范围判断

需要拆分，不建议一个变更全部吃下。

原因：

- 至少 5 个独立交付模块：Workspace 图谱、Workspace 接入与 Spec bootstrap、Workflow/审批、Runner/Agent 执行、Knowledge 生命周期。
- 涉及不同权限与视图：管理员、执行者、Reviewer、Agent、知识审核者。
- 存在跨页面状态流转：Change/Task 状态机、审批、Agent run、日志、归档。
- 模块间可以通过稳定接口解耦，适合分阶段落地。

不属于批量模式。它不是“模板乘以很多实例”，而是一组平台能力的主线拆分。

## 子阶段拆分

### Phase 0: Workspace Graph 数据面收口

对应当前变更：`2026-05-28-component-as-workspace`

目标：

- Workspace 成为唯一基本单元。
- Component 元数据并入 Workspace。
- WorkspaceRelation 表达跨 Workspace 的有向图。
- Change/Task/AgentRun 支持关联多个 Workspace。
- AgentSpecBundle 可以基于 WorkspaceRelation 拉取跨空间上下文。
- 前后端不再依赖旧 `/components` API 作为核心数据面。

不做：

- 不做 Server Sandbox Runner。
- 不做完整知识生命周期。
- 不做复杂 Workflow Template。
- 不做向量检索。

### Phase 1: Workspace 接入与 Spec Bootstrap

实际变更包：`2026-05-29-workspace-intake-spec-bootstrap`

目标：

- 普通代码仓库也能注册为 Workspace，不再强制要求 repo 内已有 `.sillyspec`。
- SpecWorkspace 作为平台托管规范空间，支持 import / sync / bootstrap 的真实文件逻辑。
- SillySpec CLI 作为格式专家，Agent 只调用 CLI，不手写规范文件格式。
- SpecValidator 成为创建、同步、执行前的硬门禁。

关键接口：

- `POST /api/workspaces` 支持 `spec_strategy`。
- `POST /api/workspaces/{id}/spec-bootstrap`
- `POST /api/workspaces/{id}/spec-sync`
- `GET /api/workspaces/{id}/spec-workspace`

### Phase 2: Harness Control Plane

实际变更包：`2026-05-29-harness-control-plane`

目标：

- 所有已实现的 workflow / agent / tool_gateway / git_gateway / runtime / knowledge router 明确接入 `main.py`。
- Change/Task 状态机与 Spec Guardian 形成执行前置门禁。
- Policy Engine 明确按 user、workspace、task stage、agent role、tool risk 校验工具调用。
- AuditLog 覆盖核心写操作和状态流转。

关键边界：

- Prompt 管认知。
- Policy 管权限。
- Workflow 管流程。
- Tool/Git Gateway 管操作。
- Audit 管追责。

### Phase 3: Local Runner Execution Loop

实际变更包：`2026-05-29-local-runner-execution-loop`

目标：

- 优先打通 Local CLI Runner，而不是先做云端全自动。
- Agent run 基于 WorktreeLease 执行。
- AgentSpecBundle 写入执行上下文。
- Tool Gateway / Git Gateway 负责文件、Shell、Git 操作边界。
- SSE 展示实时日志，DB 保留完整日志。
- 执行后收集 diff / test result / artifact。

推荐最小闭环：

```text
Task ready
  -> acquire worktree lease
  -> build AgentSpecBundle
  -> run local Claude/Codex adapter
  -> stream logs
  -> collect diff and tests
  -> review gate
```

参考实现：`C:\Users\qinyi\IdeaProjects\multica`

抽取模式，不照搬实现：
- Local daemon 是一等运行时：按 workspace/provider 注册 runtime，定期 heartbeat，server 只向 online runtime 派发任务。
- 任务领取是显式协议：runner 轮询、claim task、start task、report progress/messages、complete/fail，并支持 orphan recovery。
- 每个任务有隔离执行目录：`{workspacesRoot}/{workspaceID}/{shortTaskID}` 下分 `workdir` / `output` / `logs`，同时注入任务上下文和 provider-specific 配置。
- Agent backend 统一抽象：Claude、Codex 等 CLI 通过统一 `Execute(ctx, prompt, opts)` 入口执行，输出消息流和最终结果。
- 消息上报要可恢复：后台 draining 消息流，批量写入 DB / SSE，发现 session id 后 pin 住，后续支持 resume。
- Watchdog 不能误杀工具执行：空闲超时要区分普通沉默和 tool call in-flight。
- Runner 要有生命周期命令：start / stop / status / logs / disk-usage，以及 profile 级配置、并发上限、GC TTL。

### Phase 4: Knowledge Lifecycle

实际变更包：`2026-05-29-knowledge-lifecycle`

目标：

- 知识库不再只是 `.md` 文件列表。
- 引入 Metadata DB 管理知识类型、范围、成熟度、权限、来源任务、审核人。
- AI 只能提取 candidate，不能自动确权正式知识。
- Reviewer 或人工确认后进入 confirmed / verified。
- 向量索引只作为检索索引，后置，不作为知识本体。

成熟度：

```text
candidate -> confirmed -> verified -> promoted -> deprecated
```

### Phase 5: Server Sandbox Runner

实际变更包：`2026-05-29-server-sandbox-runner`

目标：

- 在 Local Runner 闭环稳定后，再做云端托管 Runner。
- 沙箱维度至少包含 tenant_id / user_id / workspace_id / task_id。
- 文件快照必须有白名单、敏感文件黑名单、保留周期和审计。
- Claude Code / Codex HTTP 服务只能作为内部执行能力，不直接暴露给用户。

## 依赖图

```text
Phase 0 Workspace Graph
  -> Phase 1 Workspace Intake + Spec Bootstrap
  -> Phase 2 Harness Control Plane
  -> Phase 3 Local Runner Execution Loop
  -> Phase 4 Knowledge Lifecycle
  -> Phase 5 Server Sandbox Runner
```

并行建议：

- Phase 1 和 Phase 2 可以小范围并行，但必须共享 SpecWorkspace 与 Workflow gate 的接口定义。
- Phase 4 可以先做只读 metadata 草案，但正式沉淀依赖 Phase 3 的任务产物。
- Phase 5 不应早于 Phase 3。

## 当前变更的验收焦点

当前变更只要证明以下事情成立，就可以结束：

- 后端不再需要 `project_components` / `component_relations` 作为核心表。
- WorkspaceRelation 能表达跨 Workspace 的关系和循环依赖。
- Change/Task/AgentRun 能关联多个 Workspace。
- ScanDocs / SpecWorkspace / Agent context 能以 Workspace 为中心工作。
- 前端入口不再假设组件是 Workspace 内的子资源。
- 全量测试覆盖模型、API、上下文构建和主要兼容路径。

## 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| 当前代码和扫描文档对 Component 模型描述不一致 | 后续计划引用错误 | 当前变更结束前重新扫描并更新 scan docs |
| 前端仍调用旧 `/components` API | 后端删除模块后页面不可用 | Phase 0 必须包含前端 API client 和页面迁移 |
| Workspace 创建仍强制 `.sillyspec` | 普通仓库无法接入平台 | 放入 Phase 1，作为独立变更处理 |
| Router 已实现但未挂载 | 页面调用失败，测试覆盖假阳性 | Phase 2 做统一 router 接线与契约测试 |
| 知识沉淀过早自动化 | 错误知识污染团队资产 | Phase 4 坚持 candidate 先审核 |
