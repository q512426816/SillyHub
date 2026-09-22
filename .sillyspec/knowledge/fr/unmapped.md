## FR-unmapped-001 普通项目可创建 Workspace
变更：2026-05-27-platform-native-sillyspec
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户输入一个存在的普通代码目录 目标目录已存在 `.sillyspec`；When 用户执行 workspace scan 并创建 workspace 用户创建 workspace；Then 平台创建 workspace，`status=active`，不因缺少 `.sillyspec` 阻断 平台展示导入、镜像、忽略仓库规范三种选择
全文：.sillyspec/changes/archive/2026-05-27-platform-native-sillyspec/requirements.md#FR-01
最近确认：c0af692c7

## FR-unmapped-002 平台托管规范空间
变更：2026-05-27-platform-native-sillyspec
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given workspace 创建成功 用户选择 `repo-mirrored`；When workspace 没有 repo-native `.sillyspec` 用户触发同步
全文：.sillyspec/changes/archive/2026-05-27-platform-native-sillyspec/requirements.md#FR-02
最近确认：c0af692c7

## FR-unmapped-003 Agent Spec Profile
变更：2026-05-27-platform-native-sillyspec
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 平台配置了 `C:\Users\qinyi\IdeaProjects\sillyspec` 作为 profile 来源 SillySpec profile 发生；When 平台加载 profile 平台检测到 manifest diff；Then 平台生成版本化 `SpecProfileManifest`，包含阶段、文档、门禁和 Agent 上下文契约 平台生成兼容性报告，需项目维护者确认迁移
全文：.sillyspec/changes/archive/2026-05-27-platform-native-sillyspec/requirements.md#FR-03
最近确认：c0af692c7

## FR-unmapped-004 规范冲突策略
变更：2026-05-27-platform-native-sillyspec
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 平台治理要求和 SillySpec 规范要求不一致 策略层无法自动决策；When 策略层可以自动决策 用户推进阶段或触发 Agent；Then 平台按硬门禁合并、更严格校验优先、extension metadata 或 adapter transform 处理 平台生成 conflict record，
全文：.sillyspec/changes/archive/2026-05-27-platform-native-sillyspec/requirements.md#FR-04
最近确认：c0af692c7

## FR-unmapped-005 Claude Code Agent 接入
变更：2026-05-27-platform-native-sillyspec
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given task 已从规范文档解析并确认 Agent 执行完成；When 用户触发 `claude_code` Agent run 平台收到退出码和输出
全文：.sillyspec/changes/archive/2026-05-27-platform-native-sillyspec/requirements.md#FR-05
最近确认：c0af692c7

## FR-unmapped-006 Agent 类型一致性
变更：2026-05-27-platform-native-sillyspec
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端创建 Agent run 后端收到未知 agent type；When 用户选择 Claude Code adapter registry 没有对应实现；Then 请求 payload 使用 `agent_type=claude_code` 返回明确错误和可用 agent type 列表
全文：.sillyspec/changes/archive/2026-05-27-platform-native-sillyspec/requirements.md#FR-06
最近确认：c0af692c7

## FR-unmapped-007 规范文件独立存储
变更：2026-05-27-platform-native-sillyspec
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given workspace 创建成功 spec root 目录内 已有的 component/scan_docs/change/task/parser；When 平台创建托管 spec root Agent 或 CLI 生成规范文件 需要读取规范文件；Then spec root 位于 `spec_data_root/{workspace_id}/`，为绝对路径，不与代码仓库混放 目录结构遵循 SillySpec 标准
全文：.sillyspec/changes/archive/2026-05-27-platform-native-sillyspec/requirements.md#FR-07
最近确认：c0af692c7

## FR-unmapped-008 SillySpec CLI 作为 Agent 工具
变更：2026-05-27-platform-native-sillyspec
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given AgentSpecBundle 构建 用户触发 spec-bootstrap 已有 `.sillyspec` 的项目；When 平台准备 Agent 执行上下文 Agent 在 spec_root 目录中执行 Agent 导入规范；Then `available_tools` 包含 `["sillyspec"]`，Agent prompt 指示使用 CLI 命令 Agent 调用 `sillyspe
全文：.sillyspec/changes/archive/2026-05-27-platform-native-sillyspec/requirements.md#FR-08
最近确认：c0af692c7

## FR-unmapped-009 SpecValidator 程序验证
变更：2026-05-27-platform-native-sillyspec
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 规范文件已生成（bootstrap 或 sync 后） 验证通过 验证失败；When 平台执行验证 平台更新状态 平台处理结果；Then `SpecValidator` 检查：YAML schema（每个 `projects/*.yaml` 必须有 `id`、`name`、`type`）、引用完整
全文：.sillyspec/changes/archive/2026-05-27-platform-native-sillyspec/requirements.md#FR-09
最近确认：c0af692c7

## FR-unmapped-010 Agent stdout 逐行流式发布
变更：2026-05-28-agent-log-streaming
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Agent 运行中（status=running）；When ClaudeCodeAdapter 收到子进程 stdout 的一行输出；Then 平台通过 Redis Pub/Sub 发布到 channel `agent_run:{run_id}`，payload 包含 `channel`（stdout/
全文：.sillyspec/changes/archive/2026-05-28-agent-log-streaming/requirements.md#FR-01
最近确认：3cdaada90

## FR-unmapped-011 SSE 实时日志端点
变更：2026-05-28-agent-log-streaming
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 客户端连接 `GET /api/workspaces/{id}/agent/runs/{run_id}/stream` Agent 运行结束（status 变为；When Redis Pub/Sub channel `agent_run:{run_id}` 收到消息 SSE 端点检测到运行结束 端点收到请求；Then SSE 端点将消息作为 `data` event 推送给客户端 发送 `event: done` 并关闭连接 返回 200 并立即发送 `event: done
全文：.sillyspec/changes/archive/2026-05-28-agent-log-streaming/requirements.md#FR-02
最近确认：3cdaada90

## FR-unmapped-012 前端实时日志消费
变更：2026-05-28-agent-log-streaming
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Agent 状态为 running SSE 连接断开 Agent 状态变为 completed/failed；When 用户打开 Agent Console 或 Task Detail 页面 浏览器自动重连 前端收到 `event: done` 或检测到状态变更
全文：.sillyspec/changes/archive/2026-05-28-agent-log-streaming/requirements.md#FR-03
最近确认：3cdaada90

## FR-unmapped-013 DB 日志持久化不受影响
变更：2026-05-28-agent-log-streaming
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Agent 运行结束；When 平台处理完 stdout/stderr；Then 仍按现有逻辑写入 `AgentRunLog` 表，现有 `/logs` 端点行为不变
全文：.sillyspec/changes/archive/2026-05-28-agent-log-streaming/requirements.md#FR-04
最近确认：3cdaada90

## FR-unmapped-014 Workspace 吸收 Component 元数据
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 创建 Workspace 请求包含 `component_key`、`type`、`role`、`repo_url`、`default_branch`、`tec；When 平台保存 Workspace Workspace 已保存 Component 元数据；Then 这些字段保存到 `workspaces` 表 响应返回这些元数据字段
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-01
最近确认：c0af692c7

## FR-unmapped-015 移除旧 Component 核心数据面
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 后端启动 前端读取 Workspace 或拓扑；When API router 注册完成 页面加载数据；Then 不再把旧 `backend/app/modules/component/` router 作为核心入口 通过 Workspace API 获取数据，而不是依赖旧
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-02
最近确认：c0af692c7

## FR-unmapped-016 创建 WorkspaceRelation
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Workspace A 和 Workspace B 都存在 A 到 B 已存在 `depends_on` Workspace A 存在；When 创建 A `depends_on` B 再次创建同类型关系 创建 A 指向 A 的关系
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-03
最近确认：c0af692c7

## FR-unmapped-017 支持循环依赖图
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 已存在 A `depends_on` B 存在 A -> B -> C -> A；When 查询 A 的关系 查询全局拓扑；Then 响应同时包含出边 A -> B 和入边 B -> A 拓扑结果包含完整环路，不因循环依赖报错
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-04
最近确认：c0af692c7

## FR-unmapped-018 Change 支持多 Workspace
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 开发者创建 Change 并传入 `workspace_ids=[A,B]` 旧客户端只传 `workspace_id=A`；When 服务保存 Change 服务保存 Change；Then `change_workspaces` 包含 Change 到 A、B 的关联 Change 仍保存成功，并将 A 视为 primary Workspace
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-05
最近确认：c0af692c7

## FR-unmapped-019 Task 支持多 Workspace
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 开发者创建 Task 并传入 `workspace_ids=[A,B]` 查询 Workspace A 的任务；When 服务保存 Task Task 通过 `task_workspaces` 关联 A；Then `task_workspaces` 包含 Task 到 A、B 的关联 查询结果包含该 Task
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-06
最近确认：c0af692c7

## FR-unmapped-020 AgentRun 支持多 Workspace
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given AgentRun 由一个跨 Workspace Task 触发 查询 AgentRun 详情；When AgentRun 创建 该 run 涉及多个 Workspace；Then `agent_run_workspaces` 记录该 run 涉及的 Workspace 响应返回对应 Workspace 列表或 `workspace_ids
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-07
最近确认：c0af692c7

## FR-unmapped-021 AgentSpecBundle 基于 Workspace Graph 构建
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Task T 关联 Workspace A A -> B -> C 的依赖链；When 构建 AgentSpecBundle 构建上下文的 depth 为 1；Then bundle 包含 A 的 spec 摘要 bundle 只包含 A 的直接关联 Workspace，不递归拉取 C
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-08
最近确认：c0af692c7

## FR-unmapped-022 全局拓扑 API
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 平台存在多个 Workspace 和 WorkspaceRelation 某个 Workspace 被软删除或不可见；When 调用 `GET /api/workspaces/topology` 查询拓扑；Then 响应返回 nodes 和 edges 该 Workspace 不应作为 active 节点展示
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-09
最近确认：c0af692c7

## FR-unmapped-023 后续独立变更包边界
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 当前变更包正在实施；When 发现普通仓库接入、Workflow 控制面、Local Runner、Knowledge Lifecycle 或 Server Sandbox 需求；Then 只记录为后续独立变更包，不在当前包实现
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-10
最近确认：c0af692c7

## FR-unmapped-024 Router 统一挂载
变更：2026-05-29-harness-control-plane
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 后端启动；When 查询 OpenAPI 或调用模块 API；Then workflow、agent、tool_gateway、git_gateway、runtime、knowledge 的入口可用
全文：.sillyspec/changes/archive/2026-05-29-harness-control-plane/requirements.md#FR-01
最近确认：3cdaada90

## FR-unmapped-025 Workflow 状态流转
变更：2026-05-29-harness-control-plane
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Task 处于 draft；When 请求进入 ready；Then Workflow service 校验必要条件后完成流转
全文：.sillyspec/changes/archive/2026-05-29-harness-control-plane/requirements.md#FR-02
最近确认：3cdaada90

## FR-unmapped-026 Spec Guardian 门禁
变更：2026-05-29-harness-control-plane
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Task 关联 Workspace 缺少有效 SpecWorkspace；When 请求执行；Then Spec Guardian 拒绝执行并返回诊断
全文：.sillyspec/changes/archive/2026-05-29-harness-control-plane/requirements.md#FR-03
最近确认：3cdaada90

## FR-unmapped-027 Policy 校验
变更：2026-05-29-harness-control-plane
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Agent 请求高风险 shell 操作；When Policy 评估结果为 require_approval；Then 操作进入审批，不直接执行
全文：.sillyspec/changes/archive/2026-05-29-harness-control-plane/requirements.md#FR-04
最近确认：3cdaada90

## FR-unmapped-028 AuditLog
变更：2026-05-29-harness-control-plane
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户批准一个操作；When 决策保存；Then AuditLog 记录操作者、对象、动作、结果和时间
全文：.sillyspec/changes/archive/2026-05-29-harness-control-plane/requirements.md#FR-05
最近确认：3cdaada90

## FR-unmapped-029 创建 candidate
变更：2026-05-29-knowledge-lifecycle
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given AgentRun 产生可沉淀内容；When Agent 提交 candidate；Then candidate 保存为待审核状态，并记录来源 run/task/workspace
全文：.sillyspec/changes/archive/2026-05-29-knowledge-lifecycle/requirements.md#FR-01
最近确认：3cdaada90

## FR-unmapped-030 Reviewer 确认
变更：2026-05-29-knowledge-lifecycle
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given candidate 待审核；When Reviewer 确认；Then 系统创建或更新 knowledge item，状态为 confirmed
全文：.sillyspec/changes/archive/2026-05-29-knowledge-lifecycle/requirements.md#FR-02
最近确认：3cdaada90

## FR-unmapped-031 验证和推广
变更：2026-05-29-knowledge-lifecycle
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given knowledge item 已 confirmed item 已 verified；When Reviewer 标记验证通过 管理员推广；Then 状态进入 verified 状态进入 promoted
全文：.sillyspec/changes/archive/2026-05-29-knowledge-lifecycle/requirements.md#FR-03
最近确认：3cdaada90

## FR-unmapped-032 废弃
变更：2026-05-29-knowledge-lifecycle
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 知识不再适用；When Reviewer 标记 deprecated；Then 查询默认不返回该知识，除非显式包含 deprecated
全文：.sillyspec/changes/archive/2026-05-29-knowledge-lifecycle/requirements.md#FR-04
最近确认：3cdaada90

## FR-unmapped-033 查询过滤
变更：2026-05-29-knowledge-lifecycle
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Workspace A 有多条知识；When 用户按 type、status、source 查询；Then 返回匹配的知识列表
全文：.sillyspec/changes/archive/2026-05-29-knowledge-lifecycle/requirements.md#FR-05
最近确认：3cdaada90

## FR-unmapped-034 runtime 注册
变更：2026-05-29-local-runner-execution-loop
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本机安装 Codex CLI；When Local daemon 启动；Then daemon 向 server 注册 provider=codex 的 runtime
全文：.sillyspec/changes/archive/2026-05-29-local-runner-execution-loop/requirements.md#FR-01
最近确认：3cdaada90

## FR-unmapped-035 heartbeat
变更：2026-05-29-local-runner-execution-loop
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given runtime 已注册；When daemon 定期发送 heartbeat；Then server 将 runtime 视为 online
全文：.sillyspec/changes/archive/2026-05-29-local-runner-execution-loop/requirements.md#FR-02
最近确认：3cdaada90

## FR-unmapped-036 claim task
变更：2026-05-29-local-runner-execution-loop
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Task 已 ready 且绑定 online runtime；When daemon claim task；Then server 原子分配任务给该 runtime
全文：.sillyspec/changes/archive/2026-05-29-local-runner-execution-loop/requirements.md#FR-03
最近确认：3cdaada90

## FR-unmapped-037 隔离执行环境
变更：2026-05-29-local-runner-execution-loop
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 已 claim task；When 准备执行；Then 创建独立 workdir/output/logs 并写入 AgentSpecBundle
全文：.sillyspec/changes/archive/2026-05-29-local-runner-execution-loop/requirements.md#FR-04
最近确认：3cdaada90

## FR-unmapped-038 消息流上报
变更：2026-05-29-local-runner-execution-loop
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given CLI 正在执行；When 产生 stdout、tool call、thinking 或 result message；Then daemon 批量上报到 server
全文：.sillyspec/changes/archive/2026-05-29-local-runner-execution-loop/requirements.md#FR-05
最近确认：3cdaada90

## FR-unmapped-039 执行完成
变更：2026-05-29-local-runner-execution-loop
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given CLI 返回成功；When runner 收集结果；Then server 保存 diff/test/artifact 并推进到 review gate
全文：.sillyspec/changes/archive/2026-05-29-local-runner-execution-loop/requirements.md#FR-06
最近确认：3cdaada90

## FR-unmapped-040 创建沙箱
变更：2026-05-29-server-sandbox-runner
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Task 已 ready；When Server Runner claim task；Then 平台创建绑定 tenant/user/workspace/task 的沙箱
全文：.sillyspec/changes/archive/2026-05-29-server-sandbox-runner/requirements.md#FR-01
最近确认：3cdaada90

## FR-unmapped-041 文件快照
变更：2026-05-29-server-sandbox-runner
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Workspace 有允许注入的路径；When 创建沙箱快照；Then 只复制白名单路径
全文：.sillyspec/changes/archive/2026-05-29-server-sandbox-runner/requirements.md#FR-02
最近确认：3cdaada90

## FR-unmapped-042 执行任务
变更：2026-05-29-server-sandbox-runner
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 沙箱已准备完成；When Runner 调用内部 Claude/Codex 执行能力；Then 日志通过统一 runner 协议写回 AgentRun
全文：.sillyspec/changes/archive/2026-05-29-server-sandbox-runner/requirements.md#FR-03
最近确认：3cdaada90

## FR-unmapped-043 导出结果
变更：2026-05-29-server-sandbox-runner
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 执行完成；When Runner 导出结果；Then 平台保存 diff、test result、artifact
全文：.sillyspec/changes/archive/2026-05-29-server-sandbox-runner/requirements.md#FR-04
最近确认：3cdaada90

## FR-unmapped-044 清理
变更：2026-05-29-server-sandbox-runner
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 沙箱超过保留周期；When GC 执行；Then 沙箱文件和临时凭据被清理
全文：.sillyspec/changes/archive/2026-05-29-server-sandbox-runner/requirements.md#FR-05
最近确认：3cdaada90

## FR-unmapped-045 普通 repo 注册
变更：2026-05-29-workspace-intake-spec-bootstrap
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个没有 `.sillyspec` 的代码仓库；When 管理员使用 `spec_strategy=bootstrap` 创建 Workspace；Then Workspace 创建成功
全文：.sillyspec/changes/archive/2026-05-29-workspace-intake-spec-bootstrap/requirements.md#FR-01
最近确认：3cdaada90

## FR-unmapped-046 导入已有规范
变更：2026-05-29-workspace-intake-spec-bootstrap
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given repo 内已有 `.sillyspec`；When 管理员使用 `spec_strategy=import`；Then 平台导入规范文件并记录来源路径
全文：.sillyspec/changes/archive/2026-05-29-workspace-intake-spec-bootstrap/requirements.md#FR-02
最近确认：3cdaada90

## FR-unmapped-047 规范同步
变更：2026-05-29-workspace-intake-spec-bootstrap
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Workspace 已有关联 SpecWorkspace；When 调用 `spec-sync`；Then 平台通过受控 CLI adapter 同步规范文件
全文：.sillyspec/changes/archive/2026-05-29-workspace-intake-spec-bootstrap/requirements.md#FR-03
最近确认：3cdaada90

## FR-unmapped-048 规范校验
变更：2026-05-29-workspace-intake-spec-bootstrap
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given SpecWorkspace 缺少必要 frontmatter；When 调用 `spec-validate`；Then 返回 error 级诊断并阻止进入执行阶段
全文：.sillyspec/changes/archive/2026-05-29-workspace-intake-spec-bootstrap/requirements.md#FR-04
最近确认：3cdaada90

## FR-unmapped-049 Kill 运行中的 Agent
变更：2026-05-30-agent-adapter
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-agent-adapter/requirements.md#FR-01
最近确认：c0af692c7

## FR-unmapped-050 Diff 收集
变更：2026-05-30-agent-adapter
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-agent-adapter/requirements.md#FR-02
最近确认：c0af692c7

## FR-unmapped-051 进程注册表
变更：2026-05-30-agent-adapter
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-agent-adapter/requirements.md#FR-03
最近确认：c0af692c7

## FR-unmapped-052 Stale Run 清理
变更：2026-05-30-agent-adapter
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-agent-adapter/requirements.md#FR-04
最近确认：c0af692c7

## FR-unmapped-053 Allowed Paths 隔离
变更：2026-05-30-agent-adapter
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-agent-adapter/requirements.md#FR-05
最近确认：c0af692c7

## FR-unmapped-054 输出脱敏
变更：2026-05-30-agent-adapter
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-agent-adapter/requirements.md#FR-06
最近确认：c0af692c7

## FR-unmapped-055 前端 Agent Run 列表页
变更：2026-05-30-agent-adapter
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-agent-adapter/requirements.md#FR-07
最近确认：c0af692c7

## FR-unmapped-056 前端 Agent Run 详情页
变更：2026-05-30-agent-adapter
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-agent-adapter/requirements.md#FR-08
最近确认：c0af692c7

## FR-unmapped-057 前端 SSE 日志流
变更：2026-05-30-agent-adapter
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-agent-adapter/requirements.md#FR-09
最近确认：c0af692c7

## FR-unmapped-058 tasks.md 模板生成
变更：2026-05-30-change-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-change-writer/requirements.md#FR-01
最近确认：3cdaada90

## FR-unmapped-059 verification.md 模板生成
变更：2026-05-30-change-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-change-writer/requirements.md#FR-02
最近确认：3cdaada90

## FR-unmapped-060 MASTER.md 格式增强
变更：2026-05-30-change-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-change-writer/requirements.md#FR-03
最近确认：3cdaada90

## FR-unmapped-061 batch-generate 传递 lease_id
变更：2026-05-30-change-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-change-writer/requirements.md#FR-04
最近确认：3cdaada90

## FR-unmapped-062 Git 提交并推送
变更：2026-05-30-change-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-change-writer/requirements.md#FR-05
最近确认：3cdaada90

## FR-unmapped-063 创建 Pull Request
变更：2026-05-30-change-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-change-writer/requirements.md#FR-06
最近确认：3cdaada90

## FR-unmapped-064 PAT 安全处理
变更：2026-05-30-change-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-change-writer/requirements.md#FR-07
最近确认：3cdaada90

## FR-unmapped-065 幂等创建（idempotency_key）
变更：2026-05-30-execution-coordinator
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 开发者调用 start_run 并提供 idempotency_key = "abc123" 开发者调用 start_run 并提供 idempotency_k；When 该 key 不存在 该 key 已存在且对应 AgentRun 状态为 pending/running 该 key 已存在且对应 AgentRun 状态为 co；Then 正常创建 AgentRun（201），记录 idempotency_key 返回已有 AgentRun（200），不重复创建 返回已有 AgentRun（200
全文：.sillyspec/changes/archive/2026-05-30-execution-coordinator/requirements.md#FR-01
最近确认：c0af692c7

## FR-unmapped-066 执行恢复（resume_token）
变更：2026-05-30-execution-coordinator
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When AgentRun.resume_token 不为 NULL resume_token 匹配 resume_token 不匹配 AgentRun 状态为 comp；Then 可通过 resume 端点恢复执行 AgentRun 状态重置为 pending → running，重新执行 返回 403 INVALID_RESUME_TO
全文：.sillyspec/changes/archive/2026-05-30-execution-coordinator/requirements.md#FR-02
最近确认：c0af692c7

## FR-unmapped-067 进度快照（checkpoint）
变更：2026-05-30-execution-coordinator
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 AgentRun 正在执行（状态 running） 一个 AgentRun 已保存 checkpoint 调用 save_checkpoint 时指定 e；When 调用 save_checkpoint 并传入 data = {"step": 3, "files_modified": [...]} 调用 load_check
全文：.sillyspec/changes/archive/2026-05-30-execution-coordinator/requirements.md#FR-03
最近确认：c0af692c7

## FR-unmapped-068 乐观锁（optimistic_lock）
变更：2026-05-30-execution-coordinator
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 AgentRun.version = 3 并发冲突返回 409；When 两个并发请求同时更新该 AgentRun 客户端重新获取最新 version 后重试；Then 第一个成功（version → 4），第二个检测到冲突返回 409 更新成功
全文：.sillyspec/changes/archive/2026-05-30-execution-coordinator/requirements.md#FR-04
最近确认：c0af692c7

## FR-unmapped-069 审批门（approval_token）
变更：2026-05-30-execution-coordinator
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 AgentRun 被标记为需要审批 管理员调用 approve 端点并传入正确的 approval_token 管理员调用 approve 端点并传入错误；When 执行到高风险操作前 token 匹配 token 不匹配 超过审批超时（默认 1 小时）
全文：.sillyspec/changes/archive/2026-05-30-execution-coordinator/requirements.md#FR-05
最近确认：c0af692c7

## FR-unmapped-070 上下文一致性（context_fingerprint）
变更：2026-05-30-execution-coordinator
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 开发者调用 start_run 开发者调用 resume 端点 开发者调用 resume 端点；When AgentSpecBundle 构建 提供了 context_fingerprint 参数且与存储值不匹配 不提供 context_fingerprint 参数；Then 计算 proposal + design + plan + task_content 的 SHA-256 指纹，存入 context_fingerprint 返
全文：.sillyspec/changes/archive/2026-05-30-execution-coordinator/requirements.md#FR-06
最近确认：c0af692c7

## FR-unmapped-071 重试控制
变更：2026-05-30-execution-coordinator
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 AgentRun 执行失败 一个 AgentRun 执行失败；When retry_count < max_retries retry_count >= max_retries；Then 可通过 resume 自动重试，retry_count 递增 不允许自动重试，返回 409 MAX_RETRIES_EXCEEDED
全文：.sillyspec/changes/archive/2026-05-30-execution-coordinator/requirements.md#FR-07
最近确认：c0af692c7

## FR-unmapped-072 ToolPolicy CRUD
变更：2026-05-30-tool-gateway
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 workspace 存在 一个 workspace 已有 ToolPolicy 一个 ToolPolicy 存在 一个 ToolPolicy 存在；When 开发者 POST /api/workspaces/{ws_id}/tool-policies 并提供 name + 配置 开发者 GET /api/worksp；Then 创建 ToolPolicy 并返回 201 返回该 workspace 下所有 policy 列表 更新 policy 并返回 200 删除 policy，关联
全文：.sillyspec/changes/archive/2026-05-30-tool-gateway/requirements.md#FR-01
最近确认：c0af692c7

## FR-unmapped-073 AgentRun 关联 ToolPolicy
变更：2026-05-30-tool-gateway
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 AgentRun 正在创建 一个 AgentRun 正在创建；When 指定 tool_policy_id 未指定 tool_policy_id；Then AgentRun 记录关联该 policy AgentRun 使用 default_policy（全量允许 + 全局安全限制）
全文：.sillyspec/changes/archive/2026-05-30-tool-gateway/requirements.md#FR-02
最近确认：c0af692c7

## FR-unmapped-074 策略校验 — 工具白名单
变更：2026-05-30-tool-gateway
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given ToolPolicy.allowed_tools = ["file_read", "file_list"] ToolPolicy.allowed_tools =；When Agent 调用 shell_exec Agent 调用 file_read；Then 返回 403 TOOL_OPERATION_FORBIDDEN 正常执行
全文：.sillyspec/changes/archive/2026-05-30-tool-gateway/requirements.md#FR-03
最近确认：c0af692c7

## FR-unmapped-075 策略校验 — 路径限制
变更：2026-05-30-tool-gateway
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given ToolPolicy.allowed_paths = ["src/", "tests/"] ToolPolicy.allowed_paths = ["."]；When Agent 调用 file_read path="../../etc/passwd" Agent 调用 file_read path="src/main.py"；Then 返回 403 TOOL_PATH_FORBIDDEN（路径逃逸） 正常执行
全文：.sillyspec/changes/archive/2026-05-30-tool-gateway/requirements.md#FR-04
最近确认：c0af692c7

## FR-unmapped-076 策略校验 — shell 命令黑名单
变更：2026-05-30-tool-gateway
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given ToolPolicy.blocked_commands = ["curl", "wget"] 全局 SHELL_BLOCKED_PATTERNS 包含 sudo；When Agent 调用 shell_exec command="curl" Agent 调用 shell_exec command="sudo"；Then 返回 403 TOOL_OPERATION_FORBIDDEN 返回 403 TOOL_OPERATION_FORBIDDEN（全局黑名单始终生效）
全文：.sillyspec/changes/archive/2026-05-30-tool-gateway/requirements.md#FR-05
最近确认：c0af692c7

## FR-unmapped-077 策略校验 — 资源限制
变更：2026-05-30-tool-gateway
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given ToolPolicy.max_timeout = 30 ToolPolicy.max_output_size = 32000；When Agent 调用 shell_exec timeout=60 工具输出 50000 字符；Then 实际超时被限制为 30s 输出被截断为 32000 字符
全文：.sillyspec/changes/archive/2026-05-30-tool-gateway/requirements.md#FR-06
最近确认：c0af692c7

## FR-unmapped-078 run_tests 工具
变更：2026-05-30-tool-gateway
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given lease 处于 locked 状态且 policy 允许 run_tests run_tests 执行超时；When Agent 调用 run_tests runner="pytest" path="tests/" 超过 policy.max_timeout；Then 在 lease root 下执行 pytest，返回结构化结果 (passed/failed/skipped 计数 + 失败列表) 终止进程，返回 result
全文：.sillyspec/changes/archive/2026-05-30-tool-gateway/requirements.md#FR-07
最近确认：c0af692c7

## FR-unmapped-079 http_get 工具
变更：2026-05-30-tool-gateway
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given ToolPolicy.allowed_domains = ["api.github.com", "pypi.org"] ToolPolicy.allowed_d；When Agent 调用 http_get url="https://api.github.com/repos/..." Agent 调用 http_get url="
全文：.sillyspec/changes/archive/2026-05-30-tool-gateway/requirements.md#FR-08
最近确认：c0af692c7

## FR-unmapped-080 审计双写
变更：2026-05-30-tool-gateway
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 任意工具调用执行成功 AuditLog 记录；When ToolGatewayService.execute() 完成 查看 details_json；Then 同时存在 ToolOperationLog 记录和 AuditLog 记录 包含 tool_type、params、result_code 信息
全文：.sillyspec/changes/archive/2026-05-30-tool-gateway/requirements.md#FR-09
最近确认：c0af692c7

## FR-unmapped-081 spec-bootstrap 创建异步 AgentRun
变更：2026-06-02-spec-bootstrap-agent-stream-interaction
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户拥有 `WORKSPACE_WRITE` 权限且 workspace 存在对应 SpecWorkspace 后台任务已启动；When 用户调用 `POST /api/workspaces/{workspace_id}/spec-bootstrap` Agent run 状态变为 `runnin；Then 后端创建 `AgentRun(status=pending)` 和 `AgentRunWorkspace` 关联，并立即返回 `agent_run_id`、`s
全文：.sillyspec/changes/archive/2026-06-02-spec-bootstrap-agent-stream-interaction/requirements.md#FR-01
最近确认：cfd794ddf

## FR-unmapped-082 bootstrap 通过 ClaudeCodeAdapter 执行
变更：2026-06-02-spec-bootstrap-agent-stream-interaction
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given `SpecBootstrapService` 已加载 `SpecWorkspace` 和 `Workspace`；When 后台执行 bootstrap run；Then 后端构造 `AgentSpecBundle` 并调用 `ClaudeCodeAdapter.run_with_bundle()`
全文：.sillyspec/changes/archive/2026-06-02-spec-bootstrap-agent-stream-interaction/requirements.md#FR-02
最近确认：cfd794ddf

## FR-unmapped-083 Agent 执行 init + scan + 验证
变更：2026-06-02-spec-bootstrap-agent-stream-interaction
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Agent 收到 bootstrap bundle Agent 执行结束；When `ClaudeCodeAdapter` 启动 Claude CLI 后端运行 `SpecValidator.validate(spec_root)`；Then prompt 必须包含 `sillyspec init --dir <spec_root>` 验证通过时 `SpecWorkspace.sync_status=
全文：.sillyspec/changes/archive/2026-06-02-spec-bootstrap-agent-stream-interaction/requirements.md#FR-03
最近确认：cfd794ddf

## FR-unmapped-084 Workspace 页面实时展示消息流
变更：2026-06-02-spec-bootstrap-agent-stream-interaction
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given `/spec-bootstrap` 返回 `agent_run_id`；When Workspace 详情页收到响应；Then 页面立即连接该 run 的 SSE stream
全文：.sillyspec/changes/archive/2026-06-02-spec-bootstrap-agent-stream-interaction/requirements.md#FR-04
最近确认：cfd794ddf

## FR-unmapped-085 双入口用户确认/指导
变更：2026-06-02-spec-bootstrap-agent-stream-interaction
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Agent 输出需要用户确认或指导的事件 用户提交指导文本；When 前端解析到 pending input 状态 后端收到用户输入；Then Workspace 详情页展示轻量输入框 用户输入记录到 `AgentRunLog`
全文：.sillyspec/changes/archive/2026-06-02-spec-bootstrap-agent-stream-interaction/requirements.md#FR-05
最近确认：cfd794ddf

## FR-unmapped-086 后端 SSE 支持续传参数
变更：2026-06-02-sse-reliable-stream
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 调用者请求 `GET /api/workspaces/{ws}/agent/runs/{id}/stream?after={log_id}` 调用者未传 `af；When 后端处理 SSE stream 请求 后端处理请求；Then DB replay 阶段只返回 `id > after` 的 AgentRunLog 记录 行为与当前完全一致（返回所有日志）
全文：.sillyspec/changes/archive/2026-06-02-sse-reliable-stream/requirements.md#FR-01
最近确认：cfd794ddf

## FR-unmapped-087 SSE 事件携带 log_id
变更：2026-06-02-sse-reliable-stream
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 后端通过 SSE 推送日志事件；When 事件格式序列化；Then 每个事件包含 `log_id` 字段（AgentRunLog.id）
全文：.sillyspec/changes/archive/2026-06-02-sse-reliable-stream/requirements.md#FR-02
最近确认：cfd794ddf

## FR-unmapped-088 AgentRunStreamClient 连接管理
变更：2026-06-02-sse-reliable-stream
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端创建 `AgentRunStreamClient` 实例 调用 `disconnect()` 方法；When 调用 `connect(token)` 方法 连接处于任何状态；Then 内部创建 EventSource 并连接到对应 run 的 SSE 端点 关闭 EventSource，状态变为 `disconnected`
全文：.sillyspec/changes/archive/2026-06-02-sse-reliable-stream/requirements.md#FR-03
最近确认：cfd794ddf

## FR-unmapped-089 断线自动重连
变更：2026-06-02-sse-reliable-stream
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given SSE 连接处于 `connected` 状态 重连流程执行中 连续重试 5 次均失败；When EventSource 触发 `onerror` 获取新 token 失败或回填请求失败 达到最大重试次数；Then 自动执行重连流程：关闭旧连接 → 刷新 token → 回填日志 → 重建连接 计入重试次数，等待指数退避后重试 状态变为 `error`
全文：.sillyspec/changes/archive/2026-06-02-sse-reliable-stream/requirements.md#FR-04
最近确认：cfd794ddf

## FR-unmapped-090 断线日志回填
变更：2026-06-02-sse-reliable-stream
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given SSE 连接断开并准备重连 回填日志和 SSE 新事件存在重叠；When 获取到新 token 后 两者都包含相同 `log_id` 的事件；Then 调用 `GET /logs?after={lastLogId}` 获取断线期间日志 通过 `log_id` Set 去重，只处理一次
全文：.sillyspec/changes/archive/2026-06-02-sse-reliable-stream/requirements.md#FR-05
最近确认：cfd794ddf

## FR-unmapped-091 log_id 去重
变更：2026-06-02-sse-reliable-stream
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given SSE 事件携带 `log_id` 字段 回填日志和 SSE 推送可能重叠；When 前端收到事件 log_id 已存在于 Set 中；Then 维护 `Set<number>` 记录已处理的 log_id 该事件被安全丢弃，不触发 `onMessage`
全文：.sillyspec/changes/archive/2026-06-02-sse-reliable-stream/requirements.md#FR-06
最近确认：cfd794ddf

## FR-unmapped-092 Workspace 详情页集成
变更：2026-06-02-sse-reliable-stream
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Workspace 详情页使用 `AgentRunStreamClient`；When Bootstrap 按钮触发后；Then 使用新的 `AgentRunStreamClient` 替换手动 EventSource 管理
全文：.sillyspec/changes/archive/2026-06-02-sse-reliable-stream/requirements.md#FR-07
最近确认：cfd794ddf

## FR-unmapped-093 生成项目规范统一为 Bootstrap 流程并跳转详情页
变更：2026-06-03-workspace-bootstrap-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户在「添加 Workspace」弹窗已完成扫描，处于 ready 阶段；When 用户点击「生成项目规范」按钮；Then 前端调用 `scanGenerate(rootPath)` 创建（或幂等复用）workspace 与 scan run
全文：.sillyspec/changes/archive/2026-06-03-workspace-bootstrap-flow/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-094 进入详情页自动检测并恢复进行中的 Bootstrap 回显
变更：2026-06-03-workspace-bootstrap-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 某 workspace 存在一个 `change_id` 为空、status 为 pending 或 running 的 scan run；When 用户进入 `/workspaces/{id}` 详情页（首次进入或刷新）；Then `load()` 通过 `listWorkspaceAgentRuns` 查到该进行中 run
全文：.sillyspec/changes/archive/2026-06-03-workspace-bootstrap-flow/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-095 Bootstrap 执行期间防止重复触发
变更：2026-06-03-workspace-bootstrap-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 某 workspace 已有进行中（pending/running）的 scan run；When 用户（在详情页或另一标签页弹窗）再次发起 `scan-generate`；Then 后端不创建新 run，幂等返回现有进行中 run 的 id
全文：.sillyspec/changes/archive/2026-06-03-workspace-bootstrap-flow/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-096 Bootstrap 成功后自动创建子组件
变更：2026-06-03-workspace-bootstrap-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given scan agent 执行成功（exit_code == 0）；When 后端 `_execute_scan_run` 进入成功收尾分支；Then 自动执行 reparse 逻辑，创建对应子 workspace 与 relations
全文：.sillyspec/changes/archive/2026-06-03-workspace-bootstrap-flow/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-097 完成后详情页刷新子组件计数
变更：2026-06-03-workspace-bootstrap-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 详情页已连接的 Bootstrap SSE 流收到 done 事件；When `onDone` 回调触发；Then 调用 `load()` 重新拉取数据
全文：.sillyspec/changes/archive/2026-06-03-workspace-bootstrap-flow/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-098 Gate 时机修正 — transition 时 gate=none
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When 调用 `transition(target_stage="brainstorm")` `complete_stage(stage="propose")` 被调用；Then `current_stage=brainstorm, human_gate=none`（不是 need_requirement_input） `human_ga
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-01
最近确认：f7f73d86c

## FR-unmapped-099 complete_stage 统一入口
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Agent 完成任意阶段 brainstorm 完成，result="clear" brainstorm 完成，result="ambiguous" execu；When 系统调用 `complete_stage(workspace_id, change_id, stage, result)` `complete_stage(st；Then 根据 stage 和 result 执行对应后续动作（设 gate / transition / dispatch），不再散落在 transition / au
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-02
最近确认：f7f73d86c

## FR-unmapped-100 rerun_stage 同阶段重跑
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 Change 处于 propose 阶段，`human_gate=need_proposal_review` 一个 Change 处于 plan 阶段，`；When `proposal_review(decision="revise", comment="四件套缺少边界条件")` 被调用 `plan_review(decis；Then `human_gate=none`，重新 dispatch propose Agent，不触发 InvalidTransition `human_gate=no
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-03
最近确认：f7f73d86c

## FR-unmapped-101 verify→propose 回退边
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 Change 处于 verify 阶段，`human_gate=need_human_test`；When `human_test(result="doc_mismatch", comment="API 文档与实际不一致")` 被调用；Then `current_stage=propose, human_gate=none`，并 dispatch propose Agent
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-04
最近确认：f7f73d86c

## FR-unmapped-102 proposal-review 修正
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 Change 处于 propose 阶段，`human_gate=need_proposal_review` 任意 proposal_review 调用；When `proposal_review(decision="approve")` 被调用 `proposal_review(decision="unclear", c；Then `current_stage=plan, human_gate=none`，并 dispatch plan Agent `current_stage=brain
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-05
最近确认：f7f73d86c

## FR-unmapped-103 plan-review 修正
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 Change 处于 plan 阶段，`human_gate=need_plan_review`；Then `current_stage=execute, human_gate=none`，并 dispatch execute Agent `current_stage
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-06
最近确认：f7f73d86c

## FR-unmapped-104 human-test 修正
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 Change 处于 verify 阶段，`human_gate=need_human_test`；When `human_test(result="pass")` 被调用 `human_test(result="bug", comment="列表分页显示错误")` 被
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-07
最近确认：f7f73d86c

## FR-unmapped-105 archive-confirm API
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 Change 处于 archive 阶段，`human_gate=need_archive_confirm` 一个 Change 不处于 archive+；When `POST /api/workspaces/{ws_id}/changes/{id}/archive-confirm` 被调用 调用 archive-confi；Then `human_gate=none`，dispatch archive Agent 返回 400 错误 `current_stage=archived, huma
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-08
最近确认：f7f73d86c

## FR-unmapped-106 前端 Gate 面板 comment
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 详情页显示 Gate 面板（任意 gate） revise / unclear / replan / bug / doc_mismatch 操作 approve；When 用户看到操作按钮 comment 为空 comment 为空；Then 每个面板都有一个 textarea 用于输入意见 按钮禁用或提交时提示"请填写意见" 允许提交（comment 可选）
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-09
最近确认：f7f73d86c

## FR-unmapped-107 归档确认按钮修正
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 详情页显示 `need_archive_confirm` Gate 面板；When 用户点击"确认归档"；Then 调用 `archiveConfirm(workspaceId, changeId, comment)` API，不调用 `humanTest(pass)`
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-10
最近确认：f7f73d86c

## FR-unmapped-108 清理旧 UI 残留
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更详情页代码；When 搜索 `ready_for_dev` / `accepted` / `executeChange` / `handleArchive` / `submitFee；Then 无匹配引用
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-11
最近确认：f7f73d86c

## FR-unmapped-109 日志区域宽度自适应
变更：2026-06-05-agent-74b61b
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Agent 控制台页面加载完成；When 用户在"已完成运行"表格中点击"查看日志"展开日志区域；Then 日志区域宽度应填满 AppShell 主内容区的可用宽度（viewport 减去 sidebar）
全文：.sillyspec/changes/archive/2026-06-05-agent-74b61b/requirements.md#FR-01
最近确认：90ddec4bc

## FR-unmapped-110 长日志行显示
变更：2026-06-05-agent-74b61b
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 日志区域已展开；When 日志内容包含超过容器宽度的长文本行；Then 长文本行应自然折行显示（`white-space: pre-wrap; word-break: break-all`）
全文：.sillyspec/changes/archive/2026-06-05-agent-74b61b/requirements.md#FR-02
最近确认：90ddec4bc

## FR-unmapped-111 小屏兼容
变更：2026-06-05-agent-74b61b
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户在 1280px 或更小屏幕上访问 Agent 控制台；When 页面加载完成；Then 页面布局正常，内容不溢出
全文：.sillyspec/changes/archive/2026-06-05-agent-74b61b/requirements.md#FR-03
最近确认：90ddec4bc

## FR-unmapped-112 日志块内水平滚动
变更：2026-06-08-2026-06-05-agent-log-width
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-08-2026-06-05-agent-log-width/requirements.md#FR-01
最近确认：f311f977d

## FR-unmapped-113 页面无 X 轴滚动条
变更：2026-06-08-2026-06-05-agent-log-width
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-08-2026-06-05-agent-log-width/requirements.md#FR-02
最近确认：f311f977d

## FR-unmapped-114 日志内容完整性
变更：2026-06-08-2026-06-05-agent-log-width
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-08-2026-06-05-agent-log-width/requirements.md#FR-03
最近确认：f311f977d

## FR-unmapped-115 现有功能不受影响
变更：2026-06-08-2026-06-05-agent-log-width
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-08-2026-06-05-agent-log-width/requirements.md#FR-04
最近确认：f311f977d

## FR-unmapped-116 类型列自动推断
变更：2026-06-08-2026-06-08-change-center-columns
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更目录包含 `tasks/` 子目录和 `plan.md`/`design.md` 变更目录名包含 "quick" 或仅包含 MASTER.md + requ；When Parser 扫描该目录 Parser 扫描该目录 Parser 扫描该目录 Parser 扫描该目录；Then `change_type` 被推断为 `"feature"` `change_type` 被推断为 `"quick"` `change_type` 被推断为 `
全文：.sillyspec/changes/archive/2026-06-08-2026-06-08-change-center-columns/requirements.md#FR-01
最近确认：8fbf8a5df

## FR-unmapped-117 影响组件自动推断
变更：2026-06-08-2026-06-08-change-center-columns
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更目录下有 `module-impact.md` 变更目录下无 `module-impact.md` 但有 `tasks.md` 或 `tasks/*.md`；When Parser 扫描该目录 Parser 扫描该目录 Parser 扫描该目录；Then `affected_components` 从 module-impact.md 提取模块名 `affected_components` 从文件路径中提取模块名
全文：.sillyspec/changes/archive/2026-06-08-2026-06-08-change-center-columns/requirements.md#FR-02
最近确认：8fbf8a5df

## FR-unmapped-118 reparse 覆盖策略
变更：2026-06-08-2026-06-08-change-center-columns
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given DB 中 `change_type` 为 null DB 中 `change_type` 已有非 null 值 reparse 执行时；When reparse 执行时 Parser 推断出 change_type reparse 执行时 Parser 推断出 affected_components；Then DB 中的 change_type 被更新为推断值 DB 中的 change_type 不被覆盖 DB 中的 affected_components 总是被更新
全文：.sillyspec/changes/archive/2026-06-08-2026-06-08-change-center-columns/requirements.md#FR-03
最近确认：8fbf8a5df

## FR-unmapped-119 状态列展示 human_gate
变更：2026-06-08-2026-06-08-change-center-columns
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更的 `human_gate` 不为空且不为 `"none"` 变更的 `human_gate` 为空或 `"none"`；When 前端渲染状态列 前端渲染状态列；Then 显示对应中文待办 Badge（如"待提案审核"、"待人工测试"） 根据 `current_stage` 显示阶段状态
全文：.sillyspec/changes/archive/2026-06-08-2026-06-08-change-center-columns/requirements.md#FR-04
最近确认：8fbf8a5df

## FR-unmapped-120 阶段列 null 兜底
变更：2026-06-08-2026-06-08-change-center-columns
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更的 `current_stage` 为 null 或 undefined；When 前端渲染阶段列；Then 显示 "draft" badge
全文：.sillyspec/changes/archive/2026-06-08-2026-06-08-change-center-columns/requirements.md#FR-05
最近确认：8fbf8a5df

## FR-unmapped-121 类型列颜色映射
变更：2026-06-08-2026-06-08-change-center-columns
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When 前端渲染类型列 前端渲染类型列 前端渲染类型列；Then 显示蓝色 Badge 显示黄色 Badge 显示紫色 Badge
全文：.sillyspec/changes/archive/2026-06-08-2026-06-08-change-center-columns/requirements.md#FR-06
最近确认：8fbf8a5df

## FR-unmapped-122 多 Agent 二进制检测
变更：2026-06-09-daemon-agent-detection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本地安装了 claude、codex、cursor 等 agent CLI 环境变量 `SILLYHUB_CLAUDE_PATH` 设置为自定义路径；When daemon 启动并执行 agent 检测 daemon 检测 claude agent；Then 所有在 PATH 中可找到的 agent 都被识别，返回名称、路径、版本 使用环境变量指定的路径而非 PATH 查找
全文：.sillyspec/changes/archive/2026-06-09-daemon-agent-detection/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-123 版本校验
变更：2026-06-09-daemon-agent-detection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本地 claude 版本为 1.9.0（低于 2.0.0 最低要求） 本地 codex 版本为 0.200.0（高于 0.100.0 最低要求）；When daemon 检测并校验版本 daemon 检测并校验版本；Then 该 agent 被标记为可用但版本不合规，注册时上报版本警告 该 agent 正常通过版本校验
全文：.sillyspec/changes/archive/2026-06-09-daemon-agent-detection/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-124 多 Runtime 注册
变更：2026-06-09-daemon-agent-detection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本地检测到 claude、codex、cursor 三种 agent；When daemon 向服务器注册；Then 服务器创建 3 条 daemon_runtime 记录，provider 分别为 "claude"、"codex"、"cursor"
全文：.sillyspec/changes/archive/2026-06-09-daemon-agent-detection/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-125 执行协议分类
变更：2026-06-09-daemon-agent-detection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 任务分配给 provider="claude" 的 runtime 任务分配给 provider="codex" 的 runtime 任务分配给 provide；When TaskRunner 执行任务 TaskRunner 执行任务 TaskRunner 执行任务；Then 使用 stream-json 协议解析输出 使用 JSON-RPC 2.0 协议通信 直接读取 stdout 纯文本
全文：.sillyspec/changes/archive/2026-06-09-daemon-agent-detection/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-126 前端展示
变更：2026-06-09-daemon-agent-detection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 服务器上注册了多个 daemon runtime；When 用户访问 /runtimes 页面；Then 表格中显示每个 runtime 的 provider 类型和版本
全文：.sillyspec/changes/archive/2026-06-09-daemon-agent-detection/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-127 守护进程注册
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-128 任务认领
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-129 任务执行
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-130 心跳续期
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-131 进度报告
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-132 任务完成
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-133 运行时管理
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-07
最近确认：98d3e56dd

## FR-unmapped-134 运行位置选择
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-08
最近确认：98d3e56dd

## FR-unmapped-135 优雅降级
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-09
最近确认：98d3e56dd

## FR-unmapped-136 密钥隔离
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-10
最近确认：98d3e56dd

## FR-unmapped-137 Platform Admin 权限校验
变更：2026-06-10-user-management
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-10-user-management/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-138 安全保护
变更：2026-06-10-user-management
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-10-user-management/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-139 用户列表增强
变更：2026-06-10-user-management
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-10-user-management/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-140 用户详情
变更：2026-06-10-user-management
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-10-user-management/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-141 管理员重置密码
变更：2026-06-10-user-management
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-10-user-management/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-142 审计日志
变更：2026-06-10-user-management
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-10-user-management/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-143 单个会话撤销
变更：2026-06-10-user-management-v2
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户有活跃会话 会话不属于目标用户或已撤销；When Platform Admin 调用 DELETE /api/users/{id}/sessions/{session_id} 调用 DELETE /api/us；Then 该会话被标记为 revoked，写入审计日志 返回 404
全文：.sillyspec/changes/archive/2026-06-10-user-management-v2/requirements.md#FR-01
最近确认：8fbf8a5df

## FR-unmapped-144 批量撤销会话
变更：2026-06-10-user-management-v2
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户有 N 个活跃会话；When Platform Admin 调用 POST /api/users/{id}/sessions/revoke-all；Then 所有活跃会话被撤销，返回 revoked_count，写入审计日志
全文：.sillyspec/changes/archive/2026-06-10-user-management-v2/requirements.md#FR-02
最近确认：8fbf8a5df

## FR-unmapped-145 密码重置审计标记
变更：2026-06-10-user-management-v2
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Platform Admin 重置用户密码 传入 force_change_on_next_login=false 或不传；When 传入 force_change_on_next_login=true 重置密码；Then 审计日志 details_json 包含 force_change_on_next_login=true 标记 details_json 中 force_cha
全文：.sillyspec/changes/archive/2026-06-10-user-management-v2/requirements.md#FR-03
最近确认：8fbf8a5df

## FR-unmapped-146 用户 Workspace 角色查询
变更：2026-06-10-user-management-v2
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户属于 Workspace A (role: developer) 和 Workspace B (role: reviewer) 用户不属于任何 Worksp；When Platform Admin 调用 GET /api/users/{id}/workspaces 调用 GET /api/users/{id}/workspac；Then 返回 [{workspace_name: "A", workspace_slug: "a", role_name: "developer"}, ...] 返回空
全文：.sillyspec/changes/archive/2026-06-10-user-management-v2/requirements.md#FR-04
最近确认：8fbf8a5df

## FR-unmapped-147 前端操作列优化
变更：2026-06-10-user-management-v2
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户列表展示；When 管理员查看操作列；Then 只看到"详情"链接，点击打开 Drawer
全文：.sillyspec/changes/archive/2026-06-10-user-management-v2/requirements.md#FR-05
最近确认：8fbf8a5df

## FR-unmapped-148 Drawer 增强
变更：2026-06-10-user-management-v2
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户详情 Drawer 打开 会话 Tab 展示 会话 Tab 展示；When 查看"所属 Workspace" Tab 管理员点击某个会话的"撤销"按钮 管理员点击"撤销全部会话"；Then 显示 workspace name + role name 列表 该会话被撤销 所有活跃会话被撤销
全文：.sillyspec/changes/archive/2026-06-10-user-management-v2/requirements.md#FR-06
最近确认：8fbf8a5df

## FR-unmapped-149 协议抽象层（方案B 核心）
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 12 种 agent provider 各自有不同的 stdout 协议（stream_json / json_rpc / jsonl / ndjson / t；When TaskRunner 按 provider 取对应 `ProtocolAdapter` 开发者只新增一个 `ProtocolAdapter` 实现；Then adapter 的 `parse(line)` 将原始行转为统一 `AgentEvent`（text/tool_use/tool_result/error/co
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-01
最近确认：4a456728a

## FR-unmapped-150 provider → protocol 映射
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given provider 名称；When 调用 `getBackend(provider)`；Then 按 `PROTOCOL_PROVIDERS` 映射（stream_json:[claude,gemini,cursor] / json_rpc:[codex,h
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-02
最近确认：4a456728a

## FR-unmapped-151 通信契约对齐（G-02，P0）
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given backend 的 `protocol.py` 定义的消息常量 WS 断线；When daemon 发送/接收 WS 消息 触发重连
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-03
最近确认：4a456728a

## FR-unmapped-152 lease 生命周期
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 收到 `task_available`；When 执行一次任务；Then 完整走通 `claim(拿 claim_token) → start → 流式 messages(submit) → complete(带 patch+stat
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-04
最近确认：4a456728a

## FR-unmapped-153 凭证管理（0600）
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 工具配置含 `{{USER_GITHUB_TOKEN}}` 占位符；When 渲染环境变量；Then 优先从 `~/.sillyhub/daemon/credentials.json` 取值，次取环境变量；凭证文件写入后权限为 `0600`（POSIX）。
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-05
最近确认：4a456728a

## FR-unmapped-154 workspace git mirror
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 任务携带 repo_url + branch；When 准备工作区；Then 执行 git mirror / pull --ff-only，执行后 collect git diff 生成 patch + files_changed；Win
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-06
最近确认：4a456728a

## FR-unmapped-155 agent 检测（12 provider）
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本机环境；When daemon 启动检测；Then 对 12 种 provider 按优先级（env 覆盖 → PATH 查找 → 标记不可用）探测，做 `--version` 与最低版本校验，每个检测到的 ag
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-07
最近确认：4a456728a

## FR-unmapped-156 stdin control_request 应答
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 子进程（如 stream_json/claude）通过 stdin 发出 control_request；When backend 等待批准；Then daemon 保持 stdin 开启并按策略应答（自动批准工具使用），避免子进程 hang。
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-08
最近确认：4a456728a

## FR-unmapped-157 CLI（commander）
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户在终端；When 执行 `start / stop / status / logs`；Then 与 Python 版（Click）命令名、配置项（--server/--token）、PID 文件、日志文件路径一致。
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-09
最近确认：4a456728a

## FR-unmapped-158 增量可交付（G-04）
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 任一 Wave 完成；When 验收；Then `tsc` 编译通过 + `vitest` 该 Wave 单测全绿即可推进，不依赖后续 Wave。
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-10
最近确认：4a456728a

## FR-unmapped-159 Workspace 持久化默认 agent
变更：2026-06-14-2026-06-14-agent-runtime-selection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个已存在的 workspace（`default_agent` 列存在，可为 NULL） workspace 当前 `default_agent="claud；When 所有者通过 `PATCH /api/workspaces/{id}` 传 `{"default_agent": "claude"}` 所有者 PATCH 传 `；Then 该 workspace 的 `default_agent` 更新为 `"claude"`，`GET /api/workspaces/{id}` 返回 `defa
全文：.sillyspec/changes/archive/2026-06-14-2026-06-14-agent-runtime-selection/requirements.md#FR-01
最近确认：4b0733057

## FR-unmapped-160 provider 解析优先级（三入口共用）
变更：2026-06-14-2026-06-14-agent-runtime-selection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given workspace.default_agent="claude"，且未在触发时显式传 provider workspace.default_agent="cla；When 任意入口（start_run / start_stage_dispatch / start_scan_dispatch）分发 分发 分发；Then 透传给 `dispatch_to_daemon` 的 `provider="claude"` 透传的 `provider="codex"`（显式 > 默认） 透
全文：.sillyspec/changes/archive/2026-06-14-2026-06-14-agent-runtime-selection/requirements.md#FR-02
最近确认：4b0733057

## FR-unmapped-161 placement 严格匹配 + 无在线回退
变更：2026-06-14-2026-06-14-agent-runtime-selection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户有 claude（在线）、codex（在线）、hermes（在线）三个 runtime 用户仅有 codex（在线）、hermes（在线），claude 离；Then 返回 provider="claude" 的 runtime 返回 codex 或 hermes 中一个在线 runtime（ORDER BY last_hea
全文：.sillyspec/changes/archive/2026-06-14-2026-06-14-agent-runtime-selection/requirements.md#FR-03
最近确认：4b0733057

## FR-unmapped-162 自动调度链路自动使用默认 agent
变更：2026-06-14-2026-06-14-agent-runtime-selection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given workspace.default_agent="claude"，change 处于自动调度（`auto_dispatch_next_step` → `disp；When stage 自动分发执行；Then `start_stage_dispatch` 内部读 workspace.default_agent，命中 claude（无需改 dispatch.py 自动调
全文：.sillyspec/changes/archive/2026-06-14-2026-06-14-agent-runtime-selection/requirements.md#FR-04
最近确认：4b0733057

## FR-unmapped-163 task 触发支持显式 provider
变更：2026-06-14-2026-06-14-agent-runtime-selection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端 task 触发面板，用户在下拉选择 "codex"；When POST `/api/workspaces/{id}/agent/runs` body 含 `"provider": "codex"`；Then `create_agent_run` 透传给 `start_run(provider="codex")`，最终命中 codex
全文：.sillyspec/changes/archive/2026-06-14-2026-06-14-agent-runtime-selection/requirements.md#FR-05
最近确认：4b0733057

## FR-unmapped-164 手动 stage dispatch / scan-generate 支持显式 provider
变更：2026-06-14-2026-06-14-agent-runtime-selection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端手动重跑 stage / scan 触发面板，用户选择某 provider；When 对应 HTTP 入口收到 `provider` 字段；Then 透传到 `start_stage_dispatch` / `start_scan_dispatch`，覆盖 workspace.default_agent
全文：.sillyspec/changes/archive/2026-06-14-2026-06-14-agent-runtime-selection/requirements.md#FR-06
最近确认：4b0733057

## FR-unmapped-165 前端 workspace 设置页默认 agent 下拉
变更：2026-06-14-2026-06-14-agent-runtime-selection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given workspace 设置页打开，daemon 注册了 claude / codex / hermes（部分在线）；When 渲染"默认 Agent"下拉；Then 选项 = 在线 runtime 的 distinct provider（用 PROVIDER_META 显示 label/icon），含"未设置"选项；默认选中
全文：.sillyspec/changes/archive/2026-06-14-2026-06-14-agent-runtime-selection/requirements.md#FR-07
最近确认：4b0733057

## FR-unmapped-166 前端触发面板 agent 下拉默认联动
变更：2026-06-14-2026-06-14-agent-runtime-selection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given workspace.default_agent="claude"；When 打开 task / stage / scan 触发面板；Then agent 下拉默认显示"claude"（或"使用默认(claude)"），用户可临时改选
全文：.sillyspec/changes/archive/2026-06-14-2026-06-14-agent-runtime-selection/requirements.md#FR-08
最近确认：4b0733057

## FR-unmapped-167 数据模型与迁移
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-168 Permission 枚举扩展
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-169 角色管理 - 列表与详情
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-170 角色管理 - 创建
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-171 角色管理 - 更新与状态切换
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-172 角色管理 - 删除前置检查
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-173 组织管理 - 树形结构
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-07
最近确认：98d3e56dd

## FR-unmapped-174 组织管理 - 创建与更新
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-08
最近确认：98d3e56dd

## FR-unmapped-175 组织管理 - 删除前置检查
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-09
最近确认：98d3e56dd

## FR-unmapped-176 用户管理 - CRUD 扩展
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-10
最近确认：98d3e56dd

## FR-unmapped-177 用户管理 - 自保护与最后管理员保护
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-11
最近确认：98d3e56dd

## FR-unmapped-178 用户管理 - 登录权限控制
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-12
最近确认：98d3e56dd

## FR-unmapped-179 现有 /api/users 端点兼容
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-13
最近确认：98d3e56dd

## FR-unmapped-180 前端 /admin 路由鉴权
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-14
最近确认：98d3e56dd

## FR-unmapped-181 前端 settings 剥离
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-15
最近确认：98d3e56dd

## FR-unmapped-182 审计覆盖
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-16
最近确认：98d3e56dd

## FR-unmapped-183 Admin 签发 API Key
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-184 Admin 列出 API Keys
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-185 Admin 吊销 API Key
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-186 API Key 鉴权（X-API-Key header）
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-187 鉴权 dependency header 优先级
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-188 API Key 持久化 last_used_at
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-189 daemon CLI --api-key 选项
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-07
最近确认：98d3e56dd

## FR-unmapped-190 daemon config.json 持久化 api_key
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-08
最近确认：98d3e56dd

## FR-unmapped-191 前端 API Keys 管理页
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-09
最近确认：98d3e56dd

## FR-unmapped-192 runtimes 页面启动命令优先用 API Key
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-10
最近确认：98d3e56dd

## FR-unmapped-193 列出 workspace 成员
变更：2026-06-16-workspace-members
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-workspace-members/requirements.md#FR-01
最近确认：509d92bc6

## FR-unmapped-194 模糊搜索用户
变更：2026-06-16-workspace-members
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-workspace-members/requirements.md#FR-02
最近确认：509d92bc6

## FR-unmapped-195 添加成员
变更：2026-06-16-workspace-members
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-workspace-members/requirements.md#FR-03
最近确认：509d92bc6

## FR-unmapped-196 修改成员角色
变更：2026-06-16-workspace-members
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-workspace-members/requirements.md#FR-04
最近确认：509d92bc6

## FR-unmapped-197 移除成员
变更：2026-06-16-workspace-members
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-workspace-members/requirements.md#FR-05
最近确认：509d92bc6

## FR-unmapped-198 传递所有权
变更：2026-06-16-workspace-members
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-workspace-members/requirements.md#FR-06
最近确认：509d92bc6

## FR-unmapped-199 前端 Members tab
变更：2026-06-16-workspace-members
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-workspace-members/requirements.md#FR-07
最近确认：509d92bc6

## FR-unmapped-200 添加成员对话框
变更：2026-06-16-workspace-members
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-workspace-members/requirements.md#FR-08
最近确认：509d92bc6

## FR-unmapped-201 workspace 路径来源字段（覆盖 D-004@v1）
变更：2026-06-18-2026-06-18-workspace-client-path
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given workspaces 表 创建 path_source=daemon-client 的 workspace 现有/新 server-local workspac；When 应用迁移 提交 WorkspaceCreate 未指定 path_source；Then 新增 `path_source VARCHAR(20) NOT NULL DEFAULT 'server-local'` 与 `daemon_runtime_i
全文：.sillyspec/changes/archive/2026-06-18-2026-06-18-workspace-client-path/requirements.md#FR-01
最近确认：686ca0f7e

## FR-unmapped-202 agent run 强绑 daemon 路由 + 离线失败（覆盖 D-001@v1）
变更：2026-06-18-2026-06-18-workspace-client-path
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given path_source=daemon-client 的 workspace 发起 agent run 绑定 daemon 离线 path_source=serv；When dispatch_to_daemon 选 runtime dispatch dispatch；Then 使用 `workspace.daemon_runtime_id`（覆盖 `_get_online_runtime(user_id)` 的 user 级选择） 抛
全文：.sillyspec/changes/archive/2026-06-18-2026-06-18-workspace-client-path/requirements.md#FR-02
最近确认：686ca0f7e

## FR-unmapped-203 前端 daemon 目录树形浏览（覆盖 D-005@v1）
变更：2026-06-18-2026-06-18-workspace-client-path
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 已选在线 daemon daemon 离线或 RPC 超时；When 用户在创建表单展开目录节点 list-dir 调用；Then 前端调 `POST /api/daemon/runtimes/{id}/list-dir {path}`，渲染返回的 `{name,type}[]` 子节点（懒
全文：.sillyspec/changes/archive/2026-06-18-2026-06-18-workspace-client-path/requirements.md#FR-03
最近确认：686ca0f7e

## FR-unmapped-204 list_dir allowed_roots 白名单（覆盖 D-002@v1）
变更：2026-06-18-2026-06-18-workspace-client-path
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given daemon config.allowed_roots 配置 allowed_roots 未显式配置；When list_dir 请求 path daemon 启动；Then daemon 校验 path 必须在某 allowed_root 之下；越界返回 error.code=forbidden（前端 403） 默认 `[homed
全文：.sillyspec/changes/archive/2026-06-18-2026-06-18-workspace-client-path/requirements.md#FR-04
最近确认：686ca0f7e

## FR-unmapped-205 spec 按需下发与回传（覆盖 D-003@v1, D-006@v1）
变更：2026-06-18-2026-06-18-workspace-client-path
状态：active
摘要：默认场景
依据决策：D-003@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given daemon-client workspace 的 agent run 准备执行 agent 执行完成 spec 列表/内容读取；When daemon task-runner 启动 daemon 收尾 前端查询；Then 调 `GET /api/spec-workspaces/{ws_id}/bundle` 拉 tar，解到本地 `~/.sillyhub/daemon/specs
全文：.sillyspec/changes/archive/2026-06-18-2026-06-18-workspace-client-path/requirements.md#FR-05
最近确认：686ca0f7e

## FR-unmapped-206 daemon-client 扫描派发（覆盖 D-003@v1）
变更：2026-06-18-2026-06-18-workspace-client-path
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 创建 daemon-client workspace daemon-client workspace 的 scan/scan-generate/reparse；When create 执行 触发；Then 跳过 `_ensure_spec_workspace` 本地 copytree（backend 读不到客户端路径） 判断 path_source，daemon-
全文：.sillyspec/changes/archive/2026-06-18-2026-06-18-workspace-client-path/requirements.md#FR-06
最近确认：686ca0f7e

## FR-unmapped-207 统一调度入口
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-208 废弃子进程直跑路径
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-209 CLAUDE.md 不被覆盖
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-210 阶段配置完整
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-211 AgentSpecBundle 含阶段上下文
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-212 状态同步
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-213 三字段边界
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-07
最近确认：98d3e56dd

## FR-unmapped-214 工作目录正确
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-08
最近确认：98d3e56dd

## FR-unmapped-215 Transition Response Model
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-09
最近确认：98d3e56dd

## FR-unmapped-216 测试覆盖
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-10
最近确认：98d3e56dd

## FR-unmapped-217 Design Token 单一源
变更：2026-06-21-2026-06-21-frontend-style-system
状态：active
摘要：（无场景名）
依据决策：D-004@v2、D-005@v1、D-006@v1
全文：.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/requirements.md#FR-01
最近确认：4fcf52daa

## FR-unmapped-218 统一"现代明亮活力"视觉
变更：2026-06-21-2026-06-21-frontend-style-system
状态：active
摘要：（无场景名）
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/requirements.md#FR-02
最近确认：4fcf52daa

## FR-unmapped-219 统一状态语义色
变更：2026-06-21-2026-06-21-frontend-style-system
状态：active
摘要：（无场景名）
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/requirements.md#FR-03
最近确认：4fcf52daa

## FR-unmapped-220 共享布局组件
变更：2026-06-21-2026-06-21-frontend-style-system
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/requirements.md#FR-04
最近确认：4fcf52daa

## FR-unmapped-221 AppShell 升级
变更：2026-06-21-2026-06-21-frontend-style-system
状态：active
摘要：（无场景名）
依据决策：D-003@v1
全文：.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/requirements.md#FR-05
最近确认：4fcf52daa

## FR-unmapped-222 登录页同色系
变更：2026-06-21-2026-06-21-frontend-style-system
状态：active
摘要：（无场景名）
依据决策：D-002@v1
全文：.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/requirements.md#FR-06
最近确认：4fcf52daa

## FR-unmapped-223 Inter 字体
变更：2026-06-21-2026-06-21-frontend-style-system
状态：active
摘要：（无场景名）
依据决策：D-004@v2
全文：.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/requirements.md#FR-07
最近确认：4fcf52daa

## FR-unmapped-224 DaemonService facade 兼容，router.py 零改动
变更：2026-06-22-2026-06-22-daemon-service-split
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given `router.py` 的端点以 `svc = DaemonService(session)` 实例化并调用 `DaemonService` 的方法 任一 da；When 拆分完成，`DaemonService` 退化为持有 5 子 service 引用的 facade 拆分前后分别调用；Then `git diff backend/app/modules/daemon/router.py` 为空 HTTP 状态码、响应体、副作用（DB 写入 / Redi
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-daemon-service-split/requirements.md#FR-01
最近确认：7db5ab6b3

## FR-unmapped-225 51 方法按子域归位，5 子包分层
变更：2026-06-22-2026-06-22-daemon-service-split
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given `DaemonService` 含 51 个方法，分布于 runtime/lease/run_sync/session/patch 五类（按操作主对象） 私有辅；When 按 design §6 文件变更清单归位 归位 统计各子域 service.py 行数；Then 每个方法存在于对应子域 `service.py`（RuntimeService/LeaseService/RunSyncService/SessionServi
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-daemon-service-split/requirements.md#FR-02
最近确认：7db5ab6b3

## FR-unmapped-226 DaemonLeaseService 原位保留，agent 跨模块调用不破
变更：2026-06-22-2026-06-22-daemon-service-split
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given `backend/app/modules/agent/service.py...:545` 执行 `from app.modules.daemon.lease_service import DaemonLe；When 拆分完成 迁移；Then import 成功；`cancel_lease` 行为不变；`lease_service.py` 文件未被移动/重命名/删除 迁入新 `lease/servic
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-daemon-service-split/requirements.md#FR-03
最近确认：7db5ab6b3

## FR-unmapped-227 生命周期契约不变（行为不变）
变更：2026-06-22-2026-06-22-daemon-service-split
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — When 拆分完成 拆分后运行；Then 状态转移、触发条件、关键字段、活动态/终态定义全部不变 全部通过（无逻辑变更导致的行为偏差）
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-daemon-service-split/requirements.md#FR-04
最近确认：7db5ab6b3

## FR-unmapped-228 异常类 re-export，import 路径兼容
变更：2026-06-22-2026-06-22-daemon-service-split
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given `backend/app/modules/daemon/router/__init__.py:55` 的 `from app.modules.daemon.service import (DaemonLeaseNotFound, D；When 异常类定义迁入各子包 execute 阶段以 `grep -rn "from app.modules.daemon.service import"` 全量收集
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-daemon-service-split/requirements.md#FR-05
最近确认：7db5ab6b3

## FR-unmapped-229 单一 SSE 客户端（合并）
变更：2026-06-22-2026-06-22-unify-agent-run-sse-hook
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 前端存在 `streamAgentRunLogs`（函数）与 `AgentRunStreamClient`（class）两套 SSE 客户端；When 本次变更完成；Then `AgentRunStreamClient` 是唯一底层 SSE 客户端；`streamAgentRunLogs` 从 `agent.ts` 删除；4 个调用点
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-unify-agent-run-sse-hook/requirements.md#FR-01
最近确认：76d31620a

## FR-unmapped-230 useAgentRunStream hook 封装实时流状态
变更：2026-06-22-2026-06-22-unify-agent-run-sse-hook
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 一个活跃 agent run（workspaceId + runId，status∈{pending,running}）；When 调用 `useAgentRunStream(workspaceId, runId, { isActive: true })`；Then hook 内部 `new AgentRunStreamClient` 并连接，返回 `{ logs, status, streaming, loading, e
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-unify-agent-run-sse-hook/requirements.md#FR-02
最近确认：76d31620a

## FR-unmapped-231 AgentRunPanel 面板组件
变更：2026-06-22-2026-06-22-unify-agent-run-sse-hook
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 调用点需要展示一个 run 的实时日志 + 审批 + input；When 渲染 `<AgentRunPanel workspaceId runId isActive title ... />`；Then 内部调 `useAgentRunStream`，把 logs/perms/input（适配后）/loading 注入 `<AgentLogViewer>`，调用
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-unify-agent-run-sse-hook/requirements.md#FR-03
最近确认：76d31620a

## FR-unmapped-232 AskUserQuestion 审批卡片在 /agent 与 changes/[cid] 渲染（bug 修复）
变更：2026-06-22-2026-06-22-unify-agent-run-sse-hook
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given `/agent` 或 `changes/[cid]` 页的活跃 run 中 Claude Code 触发 AskUserQuestion（daemon 发 pe；When 事件到达 `AgentRunStreamClient` 卡片自调 `respondSessionPermission` 成功后 onResolved，或 SSE；Then hook 的 `perms` 增加该 request（按 request_id 去重），`AgentRunPanel`→`AgentLogViewer` 渲染审
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-unify-agent-run-sse-hook/requirements.md#FR-04
最近确认：76d31620a

## FR-unmapped-233 pending_input 回复纳入 hook + UI 统一
变更：2026-06-22-2026-06-22-unify-agent-run-sse-hook
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 活跃 run 输出 pending_input 日志（人工指导请求）；When 用户在 input 控件填写并提交；Then hook 的 `input.submit(logId)` 调 `submitAgentRunInput`，成功后标记 `replied`；三处调用点（根/age
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-unify-agent-run-sse-hook/requirements.md#FR-05
最近确认：76d31620a

## FR-unmapped-234 非活跃 run 仅 prefetch 历史（isActive 语义）
变更：2026-06-22-2026-06-22-unify-agent-run-sse-hook
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given runId 对应非活跃 run（completed/failed/killed），`isActive=false`；When 调用 `useAgentRunStream(workspaceId, runId, { isActive: false })`；Then hook 仅 prefetch 历史日志（`AgentRunStreamClient.connect` 内 `getAgentRunLogs`），**不建立 S
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-unify-agent-run-sse-hook/requirements.md#FR-06
最近确认：76d31620a

## FR-unmapped-235 dialog 恢复（刷新前未答的 AskUserQuestion）
变更：2026-06-22-2026-06-22-unify-agent-run-sse-hook
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 页面刷新前已有 pending 的 AskUserQuestion 对话（dialog_kind 待答）；When hook 连接一个 isActive run（runId 变化）；Then hook 内部 `getAgentRun` 取 `session_id` → `fetchPendingDialogs(session_id)` 恢复未答 di
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-unify-agent-run-sse-hook/requirements.md#FR-07
最近确认：76d31620a

## FR-unmapped-236 Codex runtime 创建 interactive session
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1、D-003@v1、D-005@v1、D-009@v1
场景正文：
- 场景：默认场景 — Given `/runtimes` 中存在在线 Codex runtime；When 用户在 Codex runtime 会话弹窗中发送首条消息；Then frontend 调用 `createSession({provider:"codex"})`
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-01
最近确认：3cace8c05

## FR-unmapped-237 Codex 支持同一 session 多轮对话
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1、D-003@v1、D-009@v1
场景正文：
- 场景：默认场景 — Given Codex `AgentSession` 已 active；When 用户发送第二条消息；Then frontend 调用 `injectSession(sessionId,prompt)`
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-02
最近确认：3cace8c05

## FR-unmapped-238 Codex 支持运行中 interrupt
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given Codex turn 正在运行且 driver 已收到 `turn/started`；When 用户点击打断；Then backend 下发 `SESSION_INTERRUPT`
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-03
最近确认：3cace8c05

## FR-unmapped-239 Codex 输出进入现有日志与 SSE
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given Codex app-server 输出 agent message、tool use、tool result 或 error；When daemon 收到 JSON-RPC notification；Then Codex driver 将其归一化为 flat message
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-04
最近确认：3cace8c05

## FR-unmapped-240 Codex session 支持 end 与历史回看
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given Codex `AgentSession` 处于 active 或 running；When 用户点击结束会话；Then backend 下发 `SESSION_END`
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-05
最近确认：3cace8c05

## FR-unmapped-241 Codex 支持 reopen 与 daemon recovery
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1、D-003@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given Codex ended/failed session 有 `agent_session_id` thread id Codex session 缺少 threa；When 用户点击继续对话或 daemon 启动恢复 尝试 reopen/recovery；Then backend 允许 provider `codex` reopen 系统不得伪造新 thread
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-06
最近确认：3cace8c05

## FR-unmapped-242 frontend Codex runtime 不走 quick-chat
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given runtime provider 为 `codex`；When `/runtimes` 弹窗渲染右侧会话区；Then 使用 `InteractiveSessionChatSection`
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-07
最近确认：3cace8c05

## FR-unmapped-243 Codex 普通 approval 策略与 Claude Code 一致
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-006@v1、D-008@v1
场景正文：
- 场景：默认场景 — Given Codex session 配置为 `manual_approval=true` 且 `ask_user_only=true` Codex session 配置；When app-server 发出 command/file/permission approval request app-server 发出 command/fil；Then daemon 按 ask-only 策略 allow-through 并记录 metadata daemon 发送 backend `PERMISSION_RE
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-08
最近确认：3cace8c05

## FR-unmapped-244 Codex 用户输入请求复用现有 dialog 卡片
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-006@v1、D-008@v1、D-010@v1
场景正文：
- 场景：默认场景 — Given Codex app-server 发出 `item/tool/requestUserInput` Codex app-server 发出复杂 MCP elici；When daemon 收到 server request daemon 处理该 request；Then daemon 归一化为现有 `AskUserDialogCard` 可渲染的 `questions/options` request fail-closed
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-09
最近确认：3cace8c05

## FR-unmapped-245 Claude Code interactive 行为不回退
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-001@v1、D-006@v1、D-008@v1、D-009@v1
场景正文：
- 场景：默认场景 — Given provider 为 `claude`；When 用户创建、inject、interrupt、end、reopen、触发 AskUserQuestion；Then 现有 Claude Code 行为保持一致
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-10
最近确认：3cace8c05

## FR-unmapped-246 会话弹窗化（runtime 专属工作台）
变更：2026-06-23-runtimes-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户在 /runtimes 页面，存在在线 runtime（claude/codex） 弹窗已打开（runtime A） 弹窗打开且该 runtime 有活跃会；When 用户点击某 runtime 卡片的「会话」按钮 用户点击另一 runtime B 的「会话」按钮 弹窗渲染 弹窗渲染；Then 弹出该 runtime 专属会话工作台（左历史会话列表 + 右会话区），不滚动页面 弹窗切换为 B（单例，A 关闭 B 打开，状态重置） 右侧默认 attach
全文：.sillyspec/changes/archive/2026-06-23-runtimes-session-dialog/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-247 active 会话续聊
变更：2026-06-23-runtimes-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 弹窗左侧列表有一 active 会话 active 会话 attach 后有进行中 run；When 用户点击该 active 会话项 SSE 推送进行中 run 的 log；Then 右侧进入 attach 模式：拉历史 logs → `logsToTurns` 预填 → 建 SSE → 轮询到 active → 输入框可用可发送续聊（非只读
全文：.sillyspec/changes/archive/2026-06-23-runtimes-session-dialog/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-248 页面精简
变更：2026-06-23-runtimes-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户进入 /runtimes；When 页面渲染；Then 无底部常驻会话区，主体为摘要卡 + runtime 卡片列表，卡片更舒展
全文：.sillyspec/changes/archive/2026-06-23-runtimes-session-dialog/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-249 ended/failed 会话回看与续聊
变更：2026-06-23-runtimes-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 弹窗左侧有 ended/failed claude 会话（有 agent_session_id） ended/failed codex 会话；When 用户点击 用户点击；Then 右侧只读回看 + 「继续对话」按钮可用（reopen → attach） 右侧只读回看，「继续对话」置灰（codex 不支持续聊）
全文：.sillyspec/changes/archive/2026-06-23-runtimes-session-dialog/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-250 关闭清理
变更：2026-06-23-runtimes-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 弹窗打开且会话 attach 中（SSE/轮询活跃）；When 用户关闭弹窗；Then SSE 关闭 + 轮询清理无泄漏；`?session=` 被清除
全文：.sillyspec/changes/archive/2026-06-23-runtimes-session-dialog/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-251 URL `?session=` 恢复
变更：2026-06-23-runtimes-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given URL 含 `?session=<活跃会话>` URL 含 `?session=<ended/failed/不存在>`；When 页面 mount/刷新 页面 mount；Then 自动打开对应 runtime 弹窗并 attach 该会话 清 param，不开弹窗，降级 idle
全文：.sillyspec/changes/archive/2026-06-23-runtimes-session-dialog/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-252 transport 全局配置开关
变更：2026-06-23-spec-transport-tar-sync
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given backend 未设置 `SPEC_TRANSPORT` env `SPEC_TRANSPORT=tar` `SPEC_TRANSPORT` 为非法值；When Settings 加载 Settings 加载 Settings 加载
全文：.sillyspec/changes/archive/2026-06-23-spec-transport-tar-sync/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-253 shared 模式零改动（向后兼容）
变更：2026-06-23-spec-transport-tar-sync
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given `transport=shared`；When scan/stage dispatch；Then `build_claim_payload` 透传 spec_root（容器路径），prompt 用宿主路径
全文：.sillyspec/changes/archive/2026-06-23-spec-transport-tar-sync/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-254 tar 模式 prompt 用 daemon 本地路径
变更：2026-06-23-spec-transport-tar-sync
状态：active
摘要：默认场景
依据决策：D-001@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given `transport=tar`；When `build_scan_bundle` / `start_stage_dispatch` 生成 prompt；Then `--spec-root = ~/.sillyhub/daemon/specs/{ws}`（`resolve_prompt_spec_root` helper）
全文：.sillyspec/changes/archive/2026-06-23-spec-transport-tar-sync/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-255 tar 模式 build_claim_payload 透传 workspace_id + transport，不透传 spec_root
变更：2026-06-23-spec-transport-tar-sync
状态：active
摘要：默认场景
依据决策：D-007@v1
场景正文：
- 场景：默认场景 — Given `transport=tar` 且 interactive lease（scan/stage）；When `build_claim_payload`；Then 透传 `transport`/`transportMode` + `workspaceId`/`workspace_id`，**不 set**
全文：.sillyspec/changes/archive/2026-06-23-spec-transport-tar-sync/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-256 tar 模式 interactive 路径 spec pull（session 开始）
变更：2026-06-23-spec-transport-tar-sync
状态：active
摘要：默认场景
依据决策：D-003@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given `transport=tar` 且 daemon 收到 interactive lease；When `_startInteractiveSession` 创建 session（driver 启动前）；Then 调 `spec-sync.pullSpecBundle(client, wsId)` 拉 backend spec bundle 解到
全文：.sillyspec/changes/archive/2026-06-23-spec-transport-tar-sync/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-257 tar 模式 interactive 路径 postSpecSync（session 终态）
变更：2026-06-23-spec-transport-tar-sync
状态：active
摘要：默认场景
依据决策：D-003@v1、D-004@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given `transport=tar` 且 scan 所有 step 完成；When `onSessionEnd` 触发（session 终态）；Then 调 `spec-sync.postSpecSync` 打 tar 整树 → `POST /spec-workspace/sync`
全文：.sillyspec/changes/archive/2026-06-23-spec-transport-tar-sync/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-258 backend apply_sync 接收 tar 回传（复用）
变更：2026-06-23-spec-transport-tar-sync
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given daemon `POST /spec-workspace/sync`（tar）；When `apply_sync(workspace_id, tar_bytes)`；Then 解 tar 覆盖 `/data/{ws}`（保留 `.runtime/`）+ reparse → ScanDocument 入库 +
全文：.sillyspec/changes/archive/2026-06-23-spec-transport-tar-sync/requirements.md#FR-07
最近确认：98d3e56dd

## FR-unmapped-259 过时测试断言修正
变更：2026-06-23-spec-transport-tar-sync
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given `test_context_builder.py` 行 142/162；When 重写；Then tar 模式断言 prompt 含 `~/.sillyhub/daemon/specs/{ws}`，shared 模式含宿主路径；
全文：.sillyspec/changes/archive/2026-06-23-spec-transport-tar-sync/requirements.md#FR-08
最近确认：98d3e56dd

## FR-unmapped-260 后端 grace window(grace 内旧 token 重签、不误杀)
变更：2026-06-24-2026-06-24-concurrent-refresh-revoke
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 用户已登录,有一 active session S1(refresh_token=T1);T1 被正常 rotate 产生 S2,`S2.rotated_at=；When 在 grace 窗口(`now - rotated_at < auth_refresh_grace_seconds`,默认 60s)内再次用 T1 调 `POS；Then 返回 200 + 全新 TokenPair;**不**触发 `revoke_all_user_sessions`;Sx 仍 active;新增一个 active
全文：.sillyspec/changes/archive/2026-06-24-2026-06-24-concurrent-refresh-revoke/requirements.md#FR-01
最近确认：29acb47ea

## FR-unmapped-261 Session.rotated_at 字段 + migration
变更：2026-06-24-2026-06-24-concurrent-refresh-revoke
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given `sessions` 表现状(无 rotated_at)；When 执行新 migration `202606241000_add_session_rotated_at`；Then 新增 `rotated_at TIMESTAMP WITH TIME ZONE NULL`;现有行 rotated_at 保持 NULL;`down_revis
全文：.sillyspec/changes/archive/2026-06-24-2026-06-24-concurrent-refresh-revoke/requirements.md#FR-02
最近确认：29acb47ea

## FR-unmapped-262 access token TTL 15min → 30min
变更：2026-06-24-2026-06-24-concurrent-refresh-revoke
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given `config.Settings` 默认值；When 调 `create_access_token` 签发；Then access token `exp = iat + 30min`;`/api/auth/refresh` 返回 `access_expires_in≈1800`
全文：.sillyspec/changes/archive/2026-06-24-2026-06-24-concurrent-refresh-revoke/requirements.md#FR-03
最近确认：29acb47ea

## FR-unmapped-263 前端单飞刷新锁
变更：2026-06-24-2026-06-24-concurrent-refresh-revoke
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 浏览器单 tab,N 个并发请求同时收到 401,store 内为同一 refreshToken；When 各自调用 `ensureFreshAccessToken()`；Then 仅发起 **1 次** `POST /api/auth/refresh`;所有调用共享同一结果;成功后 store 更新为新 token
全文：.sillyspec/changes/archive/2026-06-24-2026-06-24-concurrent-refresh-revoke/requirements.md#FR-04
最近确认：29acb47ea

## FR-unmapped-264 三处 401 刷新收口到单飞锁
变更：2026-06-24-2026-06-24-concurrent-refresh-revoke
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given `api.ts`(apiFetch 401 分支)、`ppm/export.ts`(downloadExcel 401 分支)、`auth.ts`(refres；When 任一处需要刷新；Then 统一调用 `ensureFreshAccessToken()`,删除各处内联的 fetch refresh;`/api/auth/*` 端点自身不触发刷新重试(
全文：.sillyspec/changes/archive/2026-06-24-2026-06-24-concurrent-refresh-revoke/requirements.md#FR-05
最近确认：29acb47ea

## FR-unmapped-265 AppShell 主动刷新定时器
变更：2026-06-24-2026-06-24-concurrent-refresh-revoke
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 用户处于登录态(accessToken 非空)；When AppShell 定时校验(每分钟)发现 `exp - now < (exp - iat)/3`(剩余 < 1/3 TTL)；Then 自动调 `ensureFreshAccessToken()` 续期;token 缺失/解析失败时静默跳过
全文：.sillyspec/changes/archive/2026-06-24-2026-06-24-concurrent-refresh-revoke/requirements.md#FR-06
最近确认：29acb47ea

## FR-unmapped-266 logout 调用点适配三元返回(Design Grill X-001)
变更：2026-06-24-2026-06-24-concurrent-refresh-revoke
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given `_consume_refresh_token` 返回值由二元组改为三元组 `(User, Session, is_grace)`；When `logout_session_by_refresh` 与 `refresh` 调用它；Then 两处解包正确(logout 用 `_, session, _`);logout 命中 grace 时幂等 revoke、**不签发新对**;`logout` 路
全文：.sillyspec/changes/archive/2026-06-24-2026-06-24-concurrent-refresh-revoke/requirements.md#FR-07
最近确认：29acb47ea

## FR-unmapped-267 卡片展示 token / 缓存 / 费用数字
变更：2026-06-24-runtime-usage-stats
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 某 runtime 在选定时间窗内有用量数据 该 runtime 无 cache 数据(如 codex)；When 用户打开运行时列表页 渲染缓存数字；Then 该 runtime 卡片显示「输入 / 输出 / 缓存 / 费用」4 个数字(token 用 k/M 格式化,费用 $USD) 显示「—」;无费用数据显示 $0
全文：.sillyspec/changes/archive/2026-06-24-runtime-usage-stats/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-268 cache 采集(daemon)
变更：2026-06-24-runtime-usage-stats
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — When stream-json 的 message_delta 携带 `event.usage.cache_creation_input_tokens` / `cach；Then daemon 累加并经 `usage_update` 透传到后端,写入 `AgentRun.cache_read_tokens` / `cache_creati
全文：.sillyspec/changes/archive/2026-06-24-runtime-usage-stats/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-269 批量聚合接口
变更：2026-06-24-runtime-usage-stats
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v2、D-004@v1
场景正文：
- 场景：默认场景 — Given 多个 runtime 存在归属它们的 agent_runs interactive run 同时挂 agent_session_id + lease_id wi；When `GET /api/daemon/runtimes/usage?window=7d` 聚合 返回 daily 返回 daily 聚合；Then 返回每个 runtime 的 `{summary: input/output/cache_read/cache_creation/cost, daily: [.
全文：.sillyspec/changes/archive/2026-06-24-runtime-usage-stats/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-270 时间窗折线图(sparkline)
变更：2026-06-24-runtime-usage-stats
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 卡片拿到某 runtime 的 daily 序列 某时间窗该 runtime 无数据；When 渲染 sparkline 渲染；Then 画输入(蓝)/ 输出(绿)双线;切换时间窗时折线随之更新 折线为空占位,数字显示「—」/0
全文：.sillyspec/changes/archive/2026-06-24-runtime-usage-stats/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-271 兼容与回退
变更：2026-06-24-runtime-usage-stats
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 老 daemon 不上报 cache / 历史数据 cache 列为 NULL；When 聚合查询；Then `SUM(COALESCE(...,0))` 忽略 NULL 不报错;现有 `/runtimes`、`/sessions` 端点行为不变
全文：.sillyspec/changes/archive/2026-06-24-runtime-usage-stats/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-272 平台管理员全局查看与操作资源
变更：2026-06-25-2026-06-25-admin-global-daemon-workspace-management
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 当前用户是平台管理员 当前用户是平台管理员 当前用户是平台管理员；When 访问 daemon runtime 分页列表 对非本人 runtime 执行别名更新、启用、禁用或删除 访问 workspace 列表；Then 返回全部用户的 runtime，并包含 owner 展示信息 后端允许操作，并沿用现有绑定 workspace 时删除返回 409 的保护 返回全部未删除 wo
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-admin-global-daemon-workspace-management/requirements.md#FR-01
最近确认：4389ebf90

## FR-unmapped-273 普通账号权限边界不扩大
变更：2026-06-25-2026-06-25-admin-global-daemon-workspace-management
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 当前用户不是平台管理员 当前用户不是平台管理员；When 查询 daemon runtime 分页列表 查询 workspace 列表并传入其他人的 `user_id`；Then 只返回该用户自己的 runtime 仍只返回该用户已有 `workspace:read` 权限的 workspace
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-admin-global-daemon-workspace-management/requirements.md#FR-02
最近确认：4389ebf90

## FR-unmapped-274 两类资源支持独立别名
变更：2026-06-25-2026-06-25-admin-global-daemon-workspace-management
状态：active
摘要：默认场景
依据决策：D-002@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given runtime 或 workspace 尚未设置 `display_alias` 用户在卡片中保存新的别名；When 前端渲染卡片标题 PATCH 对应资源的 `display_alias`；Then 标题回退到原始 `name`、`slug` 或 `provider` 后端持久化别名，列表刷新后标题优先显示该别名，原始名称仍在副标题展示
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-admin-global-daemon-workspace-management/requirements.md#FR-03
最近确认：4389ebf90

## FR-unmapped-275 服务端筛选与分页
变更：2026-06-25-2026-06-25-admin-global-daemon-workspace-management
状态：active
摘要：默认场景
依据决策：D-003@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 调用方传入 `q` 调用方传入 `type` 和 `status` 调用方传入 `limit` 和 `offset` 请求 `GET /api/daemon/r；When 查询 runtime 或 workspace 列表 查询 runtime 或 workspace 列表 查询 runtime 或 workspace 列表 Fa；Then 后端在 `display_alias`、原始名称和关键标识字段中做大小写不敏感匹配 后端按 provider/path_source/type 和 status
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-admin-global-daemon-workspace-management/requirements.md#FR-04
最近确认：4389ebf90

## FR-unmapped-276 两页卡片与分页 UI 统一
变更：2026-06-25-2026-06-25-admin-global-daemon-workspace-management
状态：active
摘要：默认场景
依据决策：D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 用户打开 `/runtimes` 或 `/workspaces` 当前用户是平台管理员 当前用户不是平台管理员；When 数据加载成功 页面渲染筛选条 页面渲染筛选条；Then 页面展示筛选条、摘要统计、卡片网格和分页器 展示人员筛选控件，并可通过 `lib-admin.listUsers` 搜索用户 不展示人员筛选控件
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-admin-global-daemon-workspace-management/requirements.md#FR-05
最近确认：4389ebf90

## FR-unmapped-277 兼容旧调用
变更：2026-06-25-2026-06-25-admin-global-daemon-workspace-management
状态：active
摘要：默认场景
依据决策：D-001@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 现有前端组件调用 `listDaemonRuntimes()` 现有调用不传 workspace 筛选参数；When 请求 `GET /api/daemon/runtimes` 请求 `GET /api/workspaces`；Then 响应仍为 `DaemonRuntimeRead[]` 响应结构仍为 `{ items, total }`，默认行为保持兼容
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-admin-global-daemon-workspace-management/requirements.md#FR-06
最近确认：4389ebf90

## FR-unmapped-278 errMessage 纯函数取中文文案
变更：2026-06-25-2026-06-25-frontend-error-handling
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 ApiError(code="HTTP_409_DAEMON_RUNTIME_IN_USE", message="该 daemon 仍被 1 个 work；When 调用 errMessage(err) 调用 errMessage(err) 调用 errMessage(err)  /  errMessage(err, "加载；Then 返回 "该 daemon 仍被 1 个 workspace 绑定…"（后端中文 message 原样） 返回 "网络连接失败，请检查网络后重试"（中文兜底） 返
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-frontend-error-handling/requirements.md#FR-01
最近确认：0ab898669

## FR-unmapped-279 useNotify hook 统一通知入口
变更：2026-06-25-2026-06-25-frontend-error-handling
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 组件渲染在 <AntApp> 内（dashboard 全局已包裹） 操作成功；When 调用 const notify = useNotify(); notify.error(err) 调用 notify.success("运行时已移除")；Then 调用 antd messageApi.error(errMessage(err))，弹出中文 toast 弹出 antd 成功 toast
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-frontend-error-handling/requirements.md#FR-02
最近确认：0ab898669

## FR-unmapped-280 daemon runtime 删除落地
变更：2026-06-25-2026-06-25-frontend-error-handling
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户在 runtimes 页点某 runtime 的「移除」 确认删除后后端返回 409（被 workspace 绑定） 确认删除后后端返回 204；When 触发删除 ApiError 抛出 成功；Then 弹出 antd Modal.confirm（destructive 主题，中文警告），而非原生 window.confirm notify.error(err)
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-frontend-error-handling/requirements.md#FR-03
最近确认：0ab898669

## FR-unmapped-281 D 模式 16 处收敛
变更：2026-06-25-2026-06-25-frontend-error-handling
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 16 处 `${err.code}: ${err.message}` 拼接（精确清单见 design §6）；When 替换为 errMessage(err) / notify.error(err)；Then 用户不再看到英文 code；原展示方式（toast/inline）保持；grep 残留 = 0
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-frontend-error-handling/requirements.md#FR-04
最近确认：0ab898669

## FR-unmapped-282 合并 3 处重复 errMessage util
变更：2026-06-25-2026-06-25-frontend-error-handling
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given kanban.ts / ppm problem-list / problem-changes 各有局部 errMessage；When 改为 import 全局 lib/errors.ts 的 errMessage；Then 行为等价（全局版多 network 兜底，属增强）；局部函数删除
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-frontend-error-handling/requirements.md#FR-05
最近确认：0ab898669

## FR-unmapped-283 展示策略规范文档化
变更：2026-06-25-2026-06-25-frontend-error-handling
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本次确立的展示策略（操作 toast / 加载 inline / 表单 inline / 确认 Modal）；When 写入模块文档（lib-errors.md 注意事项区）；Then 后续开发者有明确约定可循
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-frontend-error-handling/requirements.md#FR-06
最近确认：0ab898669

## FR-unmapped-284 daemon idle 自动回收默认禁用（D-001）
变更：2026-06-25-2026-06-25-interactive-idle-timeout-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-interactive-idle-timeout-fix/requirements.md#FR-1
最近确认：4337b8a51

## FR-unmapped-285 idle 逃生口保留（D-001）
变更：2026-06-25-2026-06-25-interactive-idle-timeout-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-interactive-idle-timeout-fix/requirements.md#FR-2
最近确认：4337b8a51

## FR-unmapped-286 scan 完成主动 end_session（D-002）
变更：2026-06-25-2026-06-25-interactive-idle-timeout-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-interactive-idle-timeout-fix/requirements.md#FR-3
最近确认：4337b8a51

## FR-unmapped-287 stage 完成主动 end_session（D-002）
变更：2026-06-25-2026-06-25-interactive-idle-timeout-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-interactive-idle-timeout-fix/requirements.md#FR-4
最近确认：4337b8a51

## FR-unmapped-288 多轮对话不自动 end（D-002@v1 边界）
变更：2026-06-25-2026-06-25-interactive-idle-timeout-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-interactive-idle-timeout-fix/requirements.md#FR-5
最近确认：4337b8a51

## FR-unmapped-289 完成驱动 end 失败不阻塞 lease（D-002@v1 容错）
变更：2026-06-25-2026-06-25-interactive-idle-timeout-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-interactive-idle-timeout-fix/requirements.md#FR-6
最近确认：4337b8a51

## FR-unmapped-290 手动终止链路保持不变（D-003）
变更：2026-06-25-2026-06-25-interactive-idle-timeout-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-interactive-idle-timeout-fix/requirements.md#FR-7
最近确认：4337b8a51

## FR-unmapped-291 WorkspaceCreate 支持 spec_strategy 字段
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-004@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-292 daemon-client 创建时 strategy 落 spec_workspaces
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-003@v1、D-004@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-293 strategy 经 scan lease payload 透传（backend→daemon）
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-001@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-294 daemon 接收 specStrategy
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-001@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-295 pullSpecBundle platform-managed 分支现状回归
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-004@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-296 pullSpecBundle repo-mirrored 分支单次导入
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-002@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-297 pullSpecBundle repo-native 分支建 junction
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-07
最近确认：98d3e56dd

## FR-unmapped-298 junction 生命周期（复用/降级）
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-08
最近确认：98d3e56dd

## FR-unmapped-299 repo-native rm 防误删守卫
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-09
最近确认：98d3e56dd

## FR-unmapped-300 packSpecDir 穿 junction + postSpecSync 三策略都走
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-10
最近确认：98d3e56dd

## FR-unmapped-301 前端创建表单 strategy 选项
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-004@v1、D-005@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-11
最近确认：98d3e56dd

## FR-unmapped-302 AgentRun.spec_strategy 读真实值
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-001@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-12
最近确认：98d3e56dd

## FR-unmapped-303 model.py repo-mirrored 注释更新
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-002@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-13
最近确认：98d3e56dd

## FR-unmapped-304 daemon-client 详情页扫描入口（首次/重新 scan 触发）
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-006@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-14
最近确认：98d3e56dd

## FR-unmapped-305 开启子代理 text/thinking 流出（Claude SDK）
变更：2026-06-28-daemon-subagent-transcript
状态：active
摘要：默认场景
依据决策：D-001@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 主 agent 在 Claude interactive session 中调用 Task/Agent tool 派生子代理；When `ClaudeSdkDriver.start()` 设置 `options.forwardSubagentText = true`；Then 子代理的 text/thinking 作为带 `parent_tool_use_id` 的 assistant/user message 经主流 query g
全文：.sillyspec/changes/archive/2026-06-28-daemon-subagent-transcript/requirements.md#FR-01
最近确认：f7f73d86c

## FR-unmapped-306 子代理消息归属识别与原样透传
变更：2026-06-28-daemon-subagent-transcript
状态：active
摘要：默认场景
依据决策：D-001@v1、D-008@v1
场景正文：
- 场景：默认场景 — Given daemon consume 收到一条带 `parent_tool_use_id` 非空的 SDK message（assistant 或 user）；When `_onMessage` 处理并经 `onTurnMessage` 转发；Then msg 顶层保留 `parent_tool_use_id`/`subagent_type`/`task_description`（原样，不剥离），backend
全文：.sillyspec/changes/archive/2026-06-28-daemon-subagent-transcript/requirements.md#FR-02
最近确认：f7f73d86c

## FR-unmapped-307 partial buffer 按 parent_tool_use_id 分桶隔离
变更：2026-06-28-daemon-subagent-transcript
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 主 agent 与一个或多个子代理在同一 interactive session 并发产出 partial（streaming delta）；When `_bufferPartial` / `_clearPartialBufferSync` / `_flushPartial` / `_emitOverrideS；Then 各自按 `parentKey = parent_tool_use_id ?? 'main'` 独立分桶；子代理完整 assistant message 只清自己
全文：.sillyspec/changes/archive/2026-06-28-daemon-subagent-transcript/requirements.md#FR-03
最近确认：f7f73d86c

## FR-unmapped-308 agentSessionId 不被子代理 init 覆盖
变更：2026-06-28-daemon-subagent-transcript
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 主 session 已写入 `agentSessionId`（主 system/init 先到），随后子代理 system/init 到达；When `_onMessage` 处理子代理 system/init；Then 直接跳过（`parent_tool_use_id` 非空守卫 + 现有 `===undefined` 守卫），主 session resume key 不被覆盖
全文：.sillyspec/changes/archive/2026-06-28-daemon-subagent-transcript/requirements.md#FR-04
最近确认：f7f73d86c

## FR-unmapped-309 depth 维护与透传
变更：2026-06-28-daemon-subagent-transcript
状态：active
摘要：默认场景
依据决策：D-007@v1
场景正文：
- 场景：默认场景 — Given `SessionState.subagentDepth: Map<tool_use_id, depth>`；When `_onMessage` 处理 assistant message（含 tool_use blocks）与子代理消息
全文：.sillyspec/changes/archive/2026-06-28-daemon-subagent-transcript/requirements.md#FR-05
最近确认：f7f73d86c

## FR-unmapped-310 agent_run_logs 加归属列 + migration
变更：2026-06-28-daemon-subagent-transcript
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given `agent_run_logs` 表（现有无归属列）；When 执行 alembic migration；Then 加 `parent_tool_use_id VARCHAR(200) NULL` / `subagent_type VARCHAR(100) NULL` / `
全文：.sillyspec/changes/archive/2026-06-28-daemon-subagent-transcript/requirements.md#FR-06
最近确认：f7f73d86c

## FR-unmapped-311 _extract_sdk_messages 每条注入归属 + 落库
变更：2026-06-28-daemon-subagent-transcript
状态：active
摘要：默认场景
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — Given backend 收到 daemon 透传的 SDK message（带 parent_tool_use_id/subagent_type/depth）；When `_extract_sdk_messages` 展开为 flat records 且 `submit_messages` 落库；Then **每条** flat record 都带 parent_tool_use_id/subagent_type/depth（非首条 stamp，D-008）；落库
全文：.sillyspec/changes/archive/2026-06-28-daemon-subagent-transcript/requirements.md#FR-07
最近确认：f7f73d86c

## FR-unmapped-312 前端徽标 + 深度渲染
变更：2026-06-28-daemon-subagent-transcript
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 前端收到带归属列的 `agent_run_logs` 行；When `agent-log-viewer` / `logsToTurns` 渲染；Then `subagent_type` 非空 → 行首渲染 `[子代理:<subagent_type>]` 徽标（中文）；`depth > 0` → 按 depth 缩
全文：.sillyspec/changes/archive/2026-06-28-daemon-subagent-transcript/requirements.md#FR-08
最近确认：f7f73d86c

## FR-unmapped-313 向后兼容
变更：2026-06-28-daemon-subagent-transcript
状态：active
摘要：默认场景
依据决策：D-004@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 历史 `agent_run_logs` 行（归属列 NULL）或未升级 daemon 的旧路径（msg 无归属字段）；When 前端渲染；Then 按 main agent 渲染（parent=null/depth=NULL→0），行为与现状一致
全文：.sillyspec/changes/archive/2026-06-28-daemon-subagent-transcript/requirements.md#FR-09
最近确认：f7f73d86c

## FR-unmapped-314 变更中心移除生命周期流程图
变更：2026-07-02-2026-07-02-change-detail-file-tree-editor
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更中心列表页；When 用户打开 `/workspaces/{id}/changes`；Then 不再渲染「变更生命周期」SectionCard（扫描→…→归档）；列表/分页/搜索/新建/重新扫描均正常
全文：.sillyspec/changes/archive/2026-07-02-2026-07-02-change-detail-file-tree-editor/requirements.md#FR-01
最近确认：3849dbf33

## FR-unmapped-315 变更详情移除文档完整性面板 + DOC_TABS 查看器
变更：2026-07-02-2026-07-02-change-detail-file-tree-editor
状态：active
摘要：默认场景
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — Given 变更详情页；When 用户打开 `/workspaces/{id}/changes/{cid}`；Then 不再渲染「变更文档完整性」section（828-914）与 DOC_TABS 只读查看器（916-993）；关联前端死代码（DOC_TABS/DOC_LABE
全文：.sillyspec/changes/archive/2026-07-02-2026-07-02-change-detail-file-tree-editor/requirements.md#FR-02
最近确认：3849dbf33

## FR-unmapped-316 文件树展示变更目录全部文件
变更：2026-07-02-2026-07-02-change-detail-file-tree-editor
状态：active
摘要：默认场景
依据决策：D-006@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 变更详情页已加载 daemon-client 工作区 server-local 工作区；When 调用 `GET /changes/{cid}/files`；Then 返回该变更目录下递归全部文件清单 `[{path, name, size, last_modified_at, is_text}]`（path 相对变更目录，排
全文：.sillyspec/changes/archive/2026-07-02-2026-07-02-change-detail-file-tree-editor/requirements.md#FR-03
最近确认：3849dbf33

## FR-unmapped-317 读取单文件内容
变更：2026-07-02-2026-07-02-change-detail-file-tree-editor
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 文件树选中某文件 path 含 `../` 或绝对路径或符号链接越界；When 调用 `GET /changes/{cid}/files/content?path=<rel>`；Then 返回 `{path, content, exists}`，content ≤ 1MB 截断 返回 4xx（路径穿越守卫）
全文：.sillyspec/changes/archive/2026-07-02-2026-07-02-change-detail-file-tree-editor/requirements.md#FR-04
最近确认：3849dbf33

## FR-unmapped-318 编辑保存（path_source 分流）
变更：2026-07-02-2026-07-02-change-detail-file-tree-editor
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1、D-004@v1、D-006@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 用户编辑文本文件（is_text=true） server-local 工作区 daemon-client 工作区 二进制文件（is_text=false）；When 调用 `POST /changes/{cid}/files/content` body `{path, content}`；Then path resolve 后必须落在变更目录内（否则 4xx），content ≤ 1MB（否则 4xx） `write_text` 到 `{root_path
全文：.sillyspec/changes/archive/2026-07-02-2026-07-02-change-detail-file-tree-editor/requirements.md#FR-05
最近确认：3849dbf33

## FR-unmapped-319 离线续传
变更：2026-07-02-2026-07-02-change-detail-file-tree-editor
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given daemon-client 工作区且 daemon 离线 同文件多次保存（daemon 仍离线）；When 用户保存；Then pending 行保持 pending（不翻 failed），daemon 重连后轮询 claim→写本机→complete 合并为单条 pending 行（更
全文：.sillyspec/changes/archive/2026-07-02-2026-07-02-change-detail-file-tree-editor/requirements.md#FR-06
最近确认：3849dbf33

## FR-unmapped-320 保存后 per-change resync
变更：2026-07-02-2026-07-02-change-detail-file-tree-editor
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 写回成功（server-local 写盘 / daemon-client 镜像直写） daemon 回执 complete；When POST 返回前；Then 调用 `_resync_change_docs`：复用 `_parse_change` + `_sync_docs` 刷新 ChangeDocument 行 +
全文：.sillyspec/changes/archive/2026-07-02-2026-07-02-change-detail-file-tree-editor/requirements.md#FR-07
最近确认：3849dbf33

## FR-unmapped-321 待写回状态查询
变更：2026-07-02-2026-07-02-change-detail-file-tree-editor
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 文件树加载 / 保存后轮询；When 调用 `GET /changes/{cid}/files/pending`；Then 返回该变更 pending/claimed 的 DaemonChangeWrite 行 `[{path, status, created_at}]`（建议 ki
全文：.sillyspec/changes/archive/2026-07-02-2026-07-02-change-detail-file-tree-editor/requirements.md#FR-08
最近确认：3849dbf33

## FR-unmapped-322 前端文件树 + 编辑器 + 状态机
变更：2026-07-02-2026-07-02-change-detail-file-tree-editor
状态：active
摘要：默认场景
依据决策：D-003@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 变更详情页 保存动作 文件有待回写 pending 行；When 渲染文件树；Then 左树（复用 scan-docs TreeView 范式）+ 右内容区双栏；文本文件→可编辑 textarea + 保存按钮 + 放弃修改；二进制→只读 状态机流
全文：.sillyspec/changes/archive/2026-07-02-2026-07-02-change-detail-file-tree-editor/requirements.md#FR-09
最近确认：3849dbf33

## FR-unmapped-323 daemon register 上报版本
变更：2026-07-04-2026-07-04-daemon-version-management
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 启动并以 release 构建（DAEMON_VERSION=语义版本，BUILD_ID=git SHA） daemon 为 dev 构建（BUI；When daemon 调 POST /api/daemon/register register；Then 请求体含 `daemon_version`（语义版本）+ `daemon_build_id`（SHA） 请求体含 `daemon_version`，`daemo
全文：.sillyspec/changes/archive/2026-07-04-2026-07-04-daemon-version-management/requirements.md#FR-01
最近确认：3849dbf33

## FR-unmapped-324 daemon heartbeat 上报版本
变更：2026-07-04-2026-07-04-daemon-version-management
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 已注册且在线；When daemon 周期性调 heartbeat（HTTP 或 WS）；Then payload 含 `daemon_version` + `daemon_build_id`
全文：.sillyspec/changes/archive/2026-07-04-2026-07-04-daemon-version-management/requirements.md#FR-02
最近确认：3849dbf33

## FR-unmapped-325 backend 持久化 daemon 版本
变更：2026-07-04-2026-07-04-daemon-version-management
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given backend 收到带 daemon_version/daemon_build_id 的 register/heartbeat 收到旧 daemon 不带版本字；When service 处理 upsert daemon_instances upsert；Then daemon_instances.version = 语义版本，daemon_instances.build_id = SHA 被写入 version/buil
全文：.sillyspec/changes/archive/2026-07-04-2026-07-04-daemon-version-management/requirements.md#FR-03
最近确认：3849dbf33

## FR-unmapped-326 backend DTO 返回 daemon 版本
变更：2026-07-04-2026-07-04-daemon-version-management
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon_instances 已存 version/build_id；When 前端调 GET /api/daemon/runtimes/page 或 GET /api/daemon/instances；Then 响应每项含 daemon_version/daemon_build_id（runtime 行）或 version/build_id（instance 行）
全文：.sillyspec/changes/archive/2026-07-04-2026-07-04-daemon-version-management/requirements.md#FR-04
最近确认：3849dbf33

## FR-unmapped-327 GET /api/daemon/version 返回 latest 双字段
变更：2026-07-04-2026-07-04-daemon-version-management
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 部署 bundle 提取失败 self-update 端点 POST /runtimes/{id}/self-update；When 前端调 GET /api/daemon/version；Then 响应含 `latest_version`（语义版本）+ `latest_build_id`（SHA），保留旧 latest/minRequired/downlo
全文：.sillyspec/changes/archive/2026-07-04-2026-07-04-daemon-version-management/requirements.md#FR-05
最近确认：3849dbf33

## FR-unmapped-328 前端展示 daemon 版本 + 徽标
变更：2026-07-04-2026-07-04-daemon-version-management
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 管理员打开 runtimes 管理页 runtime.daemon_build_id == latest.latest_build_id（且非 dev/unkn；When runtime 列表渲染；Then 每个 runtime 行显示其 daemon 版本号 + SHA 短码 + 徽标 显示「最新」徽标 显示「可升级」徽标 显示「未知」徽标
全文：.sillyspec/changes/archive/2026-07-04-2026-07-04-daemon-version-management/requirements.md#FR-06
最近确认：3849dbf33

## FR-unmapped-329 前端升级按钮调 self-update
变更：2026-07-04-2026-07-04-daemon-version-management
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given runtime 行显示「可升级」或「未知」，且 runtime 在线 self-update 端点返回 DaemonRuntimeOffline；When 管理员点击「升级到最新版」
全文：.sillyspec/changes/archive/2026-07-04-2026-07-04-daemon-version-management/requirements.md#FR-07
最近确认：3849dbf33

## FR-unmapped-330 前端 offline 禁用升级按钮
变更：2026-07-04-2026-07-04-daemon-version-management
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given runtime 离线；Then 升级按钮禁用（disabled），不可点击
全文：.sillyspec/changes/archive/2026-07-04-2026-07-04-daemon-version-management/requirements.md#FR-08
最近确认：3849dbf33

## FR-unmapped-331 兼容旧 daemon
变更：2026-07-04-2026-07-04-daemon-version-management
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 已部署的旧 daemon（不上报版本字段）；When 它 register/heartbeat；Then backend 不报错（字段 Optional），version/build_id 存 NULL，前端显示「未知」
全文：.sillyspec/changes/archive/2026-07-04-2026-07-04-daemon-version-management/requirements.md#FR-09
最近确认：3849dbf33

## FR-unmapped-332 AgentRunLog 加 tool_kind 结构化列
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-01
最近确认：3849dbf33

## FR-unmapped-333 classify_tool_kind 识别函数（Python + TS 同逻辑）
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-02
最近确认：3849dbf33

## FR-unmapped-334 daemon task-runner tool_use 分支打标（batch 路径）
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-03
最近确认：3849dbf33

## FR-unmapped-335 backend _extract_sdk_messages interactive 打标
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-04
最近确认：3849dbf33

## FR-unmapped-336 backend submit_messages batch 兜底
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-05
最近确认：3849dbf33

## FR-unmapped-337 publish payload 两处带 tool_kind（SSE 实时流）
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-06
最近确认：3849dbf33

## FR-unmapped-338 GET /logs 加 ?tool_kind= 筛选
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-07
最近确认：3849dbf33

## FR-unmapped-339 前端 AgentRunLogEntry 加 tool_kind 字段
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-08
最近确认：3849dbf33

## FR-unmapped-340 toolKindMeta 徽标映射
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-09
最近确认：3849dbf33

## FR-unmapped-341 agent-log-viewer 第二层筛选按钮组（多选）
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-10
最近确认：3849dbf33

## FR-unmapped-342 工具徽标渲染（含旧日志兼容）
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-11
最近确认：3849dbf33

## FR-unmapped-343 daemon 停止写 `.sillyspec-platform.json`
变更：2026-07-07-2026-07-07-platform-json-contract-align
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-07-2026-07-07-platform-json-contract-align/requirements.md#FR-01
最近确认：af41fac1d

## FR-unmapped-344 `spec_version` 状态独立文件
变更：2026-07-07-2026-07-07-platform-json-contract-align
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-07-2026-07-07-platform-json-contract-align/requirements.md#FR-02
最近确认：af41fac1d

## FR-unmapped-345 保鲜读写迁移到新位置
变更：2026-07-07-2026-07-07-platform-json-contract-align
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-07-2026-07-07-platform-json-contract-align/requirements.md#FR-03
最近确认：af41fac1d

## FR-unmapped-346 `hasUnsyncedLocalChanges` 读新位置
变更：2026-07-07-2026-07-07-platform-json-contract-align
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-07-2026-07-07-platform-json-contract-align/requirements.md#FR-04
最近确认：af41fac1d

## FR-unmapped-347 dead code 清理
变更：2026-07-07-2026-07-07-platform-json-contract-align
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-07-2026-07-07-platform-json-contract-align/requirements.md#FR-05
最近确认：af41fac1d

## FR-unmapped-348 AgentSession 持久化变更/工作空间绑定
变更：2026-07-09-2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 一条交互会话在创建时携带 `change_id` 与 `workspace_id` 创建会话时未携带 `change_id`/`workspace_id`（ru；When `create_session` 写入 `AgentSession` `create_session` 执行；Then `AgentSession.change_id` / `workspace_id` 被持久化（可空）；`workspace_id` 非空时 `cwd` 写入该工
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-change-detail-session/requirements.md#FR-01
最近确认：af41fac1d

## FR-unmapped-349 创建端点接收变更/工作空间字段
变更：2026-07-09-2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 前端调用 `POST /api/daemon/sessions`；When 请求体含可选 `change_id`/`workspace_id`；Then 后端接收并透传给 `create_session`；`AgentSessionRead` 响应回显这两字段。
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-change-detail-session/requirements.md#FR-02
最近确认：af41fac1d

## FR-unmapped-350 自动注入变更上下文前导
变更：2026-07-09-2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 会话绑定 `change_id` 会话未绑定 `change_id`；When 创建会话首轮 dispatch 创建会话；Then daemon 收到的 dispatch prompt = `【变更上下文】前导 + 用户消息`；前导含变更标题、当前阶段、工作目录、变更文档路径（design/
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-change-detail-session/requirements.md#FR-03
最近确认：af41fac1d

## FR-unmapped-351 变更级会话列表
变更：2026-07-09-2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 工作空间成员访问变更详情页；When 调用 `GET /api/workspaces/{wid}/changes/{cid}/sessions`；Then 返回该变更下全部会话（跨成员，不过滤 user_id），按 `last_active_at` desc；每条含 `id/provider/status/turn
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-change-detail-session/requirements.md#FR-04
最近确认：af41fac1d

## FR-unmapped-352 变更详情页内嵌会话区块
变更：2026-07-09-2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 用户进入变更详情页 用户切换历史会话；When 页面渲染 点击某条历史会话；Then 在「Agent 执行日志」区块之后出现「会话」区块：左侧该变更会话历史列表 + 「新建会话」按钮，右侧复用 `InteractiveSessionPanel`（
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-change-detail-session/requirements.md#FR-05
最近确认：af41fac1d

## FR-unmapped-353 工作区上下文 store（缓存层）
变更：2026-07-09-2026-07-09-workspace-prioritization
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-workspace-prioritization/requirements.md#FR-01
最近确认：af41fac1d

## FR-unmapped-354 登录后强制选工作区（客户端守卫）
变更：2026-07-09-2026-07-09-workspace-prioritization
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-workspace-prioritization/requirements.md#FR-02
最近确认：af41fac1d

## FR-unmapped-355 落地页改工作区选择器
变更：2026-07-09-2026-07-09-workspace-prioritization
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-workspace-prioritization/requirements.md#FR-03
最近确认：af41fac1d

## FR-unmapped-356 顶栏工作区切换器
变更：2026-07-09-2026-07-09-workspace-prioritization
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-workspace-prioritization/requirements.md#FR-04
最近确认：af41fac1d

## FR-unmapped-357 daemon 绑定弹窗
变更：2026-07-09-2026-07-09-workspace-prioritization
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-workspace-prioritization/requirements.md#FR-05
最近确认：af41fac1d

## FR-unmapped-358 daemon 状态数据接入
变更：2026-07-09-2026-07-09-workspace-prioritization
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-workspace-prioritization/requirements.md#FR-06
最近确认：af41fac1d

## FR-unmapped-359 AgentSession 持久化变更/工作空间绑定
变更：2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 一条交互会话在创建时携带 `change_id` 与 `workspace_id` 创建会话时未携带 `change_id`/`workspace_id`（ru；When `create_session` 写入 `AgentSession` `create_session` 执行；Then `AgentSession.change_id` / `workspace_id` 被持久化（可空）；`workspace_id` 非空时 `cwd` 写入该工
全文：.sillyspec/changes/archive/2026-07-09-change-detail-session/requirements.md#FR-01
最近确认：af41fac1d

## FR-unmapped-360 创建端点接收变更/工作空间字段
变更：2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 前端调用 `POST /api/daemon/sessions`；When 请求体含可选 `change_id`/`workspace_id`；Then 后端接收并透传给 `create_session`；`AgentSessionRead` 响应回显这两字段。
全文：.sillyspec/changes/archive/2026-07-09-change-detail-session/requirements.md#FR-02
最近确认：af41fac1d

## FR-unmapped-361 自动注入变更上下文前导
变更：2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 会话绑定 `change_id` 会话未绑定 `change_id`；When 创建会话首轮 dispatch 创建会话；Then daemon 收到的 dispatch prompt = `【变更上下文】前导 + 用户消息`；前导含变更标题、当前阶段、工作目录、变更文档路径（design/
全文：.sillyspec/changes/archive/2026-07-09-change-detail-session/requirements.md#FR-03
最近确认：af41fac1d

## FR-unmapped-362 变更级会话列表
变更：2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 工作空间成员访问变更详情页；When 调用 `GET /api/workspaces/{wid}/changes/{cid}/sessions`；Then 返回该变更下全部会话（跨成员，不过滤 user_id），按 `last_active_at` desc；每条含 `id/provider/status/turn
全文：.sillyspec/changes/archive/2026-07-09-change-detail-session/requirements.md#FR-04
最近确认：af41fac1d

## FR-unmapped-363 变更详情页内嵌会话区块
变更：2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 用户进入变更详情页 用户切换历史会话；When 页面渲染 点击某条历史会话；Then 在「Agent 执行日志」区块之后出现「会话」区块：左侧该变更会话历史列表 + 「新建会话」按钮，右侧复用 `InteractiveSessionPanel`（
全文：.sillyspec/changes/archive/2026-07-09-change-detail-session/requirements.md#FR-05
最近确认：af41fac1d

## FR-unmapped-364 删除 archive 死代码 + 补 status 投影
变更：2026-07-11-2026-07-11-daemon-client-container-overreach
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-11-2026-07-11-daemon-client-container-overreach/requirements.md#FR-1
最近确认：af41fac1d

## FR-unmapped-365 change_dir 删死路径
变更：2026-07-11-2026-07-11-daemon-client-container-overreach
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-11-2026-07-11-daemon-client-container-overreach/requirements.md#FR-2
最近确认：af41fac1d

## FR-unmapped-366 scanner/parser 扁平布局修复
变更：2026-07-11-2026-07-11-daemon-client-container-overreach
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-11-2026-07-11-daemon-client-container-overreach/requirements.md#FR-3
最近确认：af41fac1d

## FR-unmapped-367 SessionListLayout 公共组件
变更：2026-07-11-unify-runtime-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 两处会话列表（runtimes 弹窗 / 变更会话）需要一致的视觉 列表为空；When 调用方传入标准化 `SessionListEntry[]` + `onSelect`/`onNewSession`/`onRetry`（可选 `onDelete；Then 组件渲染圆角卡片（`rounded-md border bg-slate-50`）+ header + 顶部「新建会话」虚线按钮 + 列表项（`title ??
全文：.sillyspec/changes/archive/2026-07-11-unify-runtime-session-dialog/requirements.md#FR-01
最近确认：f7f73d86c

## FR-unmapped-368 RuntimeSessionDialog 样式对齐 + 二态化
变更：2026-07-11-unify-runtime-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户打开 `/runtimes?session=<id>` 弹窗 用户点击任意状态会话（active/pending/reconnecting/ended/fa；When 弹窗渲染 handleSelect 触发 触发 触发；Then 左侧使用 `SessionListLayout`（带删除按钮，字段=title/status/提供方·轮数/时间），右侧直接挂 `InteractiveSess
全文：.sillyspec/changes/archive/2026-07-11-unify-runtime-session-dialog/requirements.md#FR-02
最近确认：f7f73d86c

## FR-unmapped-369 ChangeSessionSection 改用公共组件 + ended/failed reopen
变更：2026-07-11-unify-runtime-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更详情页会话区块 用户点击 ended/failed 会话；When 渲染 handleSelect 触发；Then 左侧使用 `SessionListLayout`（不传 `onDelete`，`secondaryText`=作者·提供方），右侧 `InteractiveSe
全文：.sillyspec/changes/archive/2026-07-11-unify-runtime-session-dialog/requirements.md#FR-03
最近确认：f7f73d86c

## FR-unmapped-370 消息渲染 BUG 修复（sanitizeSessionLogContent + logsToTurns）
变更：2026-07-11-unify-runtime-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given attach 历史会话预填 turn 实时 SSE log attach 后 SSE 与 initialTurns 可能重叠；When `logsToTurns(getAgentSessionLogs)` 处理每条 log `renderLogContent` 处理 daemon 推送历史 lo；Then 对 `content_redacted` 先调 `sanitizeSessionLogContent(content, channel)` 过滤（`[SYSTE
全文：.sillyspec/changes/archive/2026-07-11-unify-runtime-session-dialog/requirements.md#FR-04
最近确认：f7f73d86c

## FR-unmapped-371 AgentSession.deleted_at 软删字段
变更：2026-07-11-unify-runtime-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given AgentSession 模型 migration downgrade；When migration apply 执行；Then 新增 `deleted_at TIMESTAMP NULL` 列 + `ix_agent_sessions_deleted_at` 索引；现有行 `delete
全文：.sillyspec/changes/archive/2026-07-11-unify-runtime-session-dialog/requirements.md#FR-05
最近确认：f7f73d86c

## FR-unmapped-372 delete_agent_session 改软删
变更：2026-07-11-unify-runtime-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户删除 active/pending/reconnecting 会话 用户删除 ended/failed 会话；When `delete_agent_session` 执行 执行；Then 先 best-effort `_end_session_for_delete`（WS SESSION_END + currentRun killed + lea
全文：.sillyspec/changes/archive/2026-07-11-unify-runtime-session-dialog/requirements.md#FR-06
最近确认：f7f73d86c

## FR-unmapped-373 list/get 过滤软删
变更：2026-07-11-unify-runtime-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 任一用户调 `list_agent_sessions` / `list_change_sessions`；When 查询；Then 仅返回 `deleted_at IS NULL` 的会话；`get_agent_session` 对软删会话抛 `DaemonSessionNotFound`（
全文：.sillyspec/changes/archive/2026-07-11-unify-runtime-session-dialog/requirements.md#FR-07
最近确认：f7f73d86c

## FR-unmapped-374 list_agent_sessions 补 title
变更：2026-07-11-unify-runtime-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given `list_agent_sessions` 返回 前端 `AgentSessionRead`；When 构造响应 类型定义；Then 每条含 `title`（首条 `channel=user_input` 的 AgentRunLog 摘要前 30 字，复用 `list_change_sessi
全文：.sillyspec/changes/archive/2026-07-11-unify-runtime-session-dialog/requirements.md#FR-08
最近确认：f7f73d86c

## FR-unmapped-375 per-worker 独立 worktree 创建
变更：2026-07-12-2026-07-12-worker-worktree-isolation
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-006@v1
全文：.sillyspec/changes/archive/2026-07-12-2026-07-12-worker-worktree-isolation/requirements.md#FR-01
最近确认：af41fac1d

## FR-unmapped-376 worker 在副本内写+commit（root_path 改向副本）
变更：2026-07-12-2026-07-12-worker-worktree-isolation
状态：active
摘要：（无场景名）
依据决策：D-002@v1、D-003@v1
全文：.sillyspec/changes/archive/2026-07-12-2026-07-12-worker-worktree-isolation/requirements.md#FR-02
最近确认：af41fac1d

## FR-unmapped-377 converge 分支合并
变更：2026-07-12-2026-07-12-worker-worktree-isolation
状态：active
摘要：（无场景名）
依据决策：D-003@v1、D-006@v1
全文：.sillyspec/changes/archive/2026-07-12-2026-07-12-worker-worktree-isolation/requirements.md#FR-03
最近确认：af41fac1d

## FR-unmapped-378 冲突主 agent 自动解决（converge_mission 可重入）
变更：2026-07-12-2026-07-12-worker-worktree-isolation
状态：active
摘要：（无场景名）
依据决策：D-004@v1
全文：.sillyspec/changes/archive/2026-07-12-2026-07-12-worker-worktree-isolation/requirements.md#FR-04
最近确认：af41fac1d

## FR-unmapped-379 合并后清理 + patch 采集
变更：2026-07-12-2026-07-12-worker-worktree-isolation
状态：active
摘要：（无场景名）
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-07-12-2026-07-12-worker-worktree-isolation/requirements.md#FR-05
最近确认：af41fac1d

## FR-unmapped-380 worker 副本 git identity（X-002）
变更：2026-07-12-2026-07-12-worker-worktree-isolation
状态：active
摘要：（无场景名）
依据决策：D-008@v1
全文：.sillyspec/changes/archive/2026-07-12-2026-07-12-worker-worktree-isolation/requirements.md#FR-06
最近确认：af41fac1d

## FR-unmapped-381 项目状态用 StatusBadge 渲染
变更：2026-07-14-2026-07-14-ppm-projects-style-redesign
状态：active
摘要：默认场景
依据决策：D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given projects 页项目状态字段 option 配置了 `statusKind` 状态 option 无 `statusKind`、仅有 `color`；When 表格渲染状态列 渲染状态列；Then 显示带圆点 pill（进行中=info蓝 / 已完成=success绿 / 已暂停=warning橙） 退化为 antd Tag（向后兼容，不影响 custom
全文：.sillyspec/changes/archive/2026-07-14-2026-07-14-ppm-projects-style-redesign/requirements.md#FR-01
最近确认：54207135f

## FR-unmapped-382 项目类型用 antd Tag 渲染
变更：2026-07-14-2026-07-14-ppm-projects-style-redesign
状态：active
摘要：默认场景
依据决策：D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 类型字段 `color` 为 `blue` / `cyan` / `default` `color="default"`；When 渲染类型列 渲染；Then 显示对应色块 Tag（研发=blue / 实施=cyan / 运维=default 灰） 显示无 color 的默认灰 `<Tag>`（非 antd 自定义色字
全文：.sillyspec/changes/archive/2026-07-14-2026-07-14-ppm-projects-style-redesign/requirements.md#FR-02
最近确认：54207135f

## FR-unmapped-383 浮层换 antd Drawer/Modal 且点遮罩不关
变更：2026-07-14-2026-07-14-ppm-projects-style-redesign
状态：active
摘要：默认场景
依据决策：D-002@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 用户打开编辑抽屉 / 删除确认 / 成员管理抽屉 projects 页点「成员管理」打开外层 Drawer，内嵌成员表；When 点击遮罩层（mask） 点击右上角 `✕` / 底部「取消」/ 按 ESC 在成员表内点「编辑成员」；Then 弹窗**不**关闭（`maskClosable={false}`） 弹窗关闭 内层 Drawer/Modal 正常打开，z-index 高于外层，ESC 关最上
全文：.sillyspec/changes/archive/2026-07-14-2026-07-14-ppm-projects-style-redesign/requirements.md#FR-03
最近确认：54207135f

## FR-unmapped-384 toast / error 提示语义化
变更：2026-07-14-2026-07-14-ppm-projects-style-redesign
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 操作成功 / 失败；When 显示 toast；Then 用语义色（success=emerald / error=red），无硬编码 `emerald-300`/`bg-emerald-50`
全文：.sillyspec/changes/archive/2026-07-14-2026-07-14-ppm-projects-style-redesign/requirements.md#FR-04
最近确认：54207135f

## FR-unmapped-385 搜索区布局保持现状
变更：2026-07-14-2026-07-14-ppm-projects-style-redesign
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given 搜索字段数 > 4 搜索字段数 ≤ 4；When 渲染搜索区 渲染搜索区；Then 操作按钮行在字段**上方右对齐**（数据组：导出/新增 在左；基础组：查询/重置/展开 在**最右**；中间分隔线）；字段 4 列网格显示前 4 个 + 「展开
全文：.sillyspec/changes/archive/2026-07-14-2026-07-14-ppm-projects-style-redesign/requirements.md#FR-05
最近确认：54207135f

## FR-unmapped-386 project_name 列加粗
变更：2026-07-14-2026-07-14-ppm-projects-style-redesign
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When 表格渲染项目名称列；Then `project_name` 文字加粗（font-medium），项目编号独立成列、不加粗
全文：.sillyspec/changes/archive/2026-07-14-2026-07-14-ppm-projects-style-redesign/requirements.md#FR-06
最近确认：54207135f

## FR-unmapped-387 前端按操作系统自动检测并显示对应安装命令
变更：2026-07-15-2026-07-14-daemon-install-os-aware
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 用户打开 `/runtimes` 页面且 `InstallDaemonBlock` 已在客户端 mount；When 读取 `navigator.userAgent` 判定 OS（`/Win/` → Windows，其余 → unix）；Then 默认显示对应平台的安装命令（Windows → PowerShell 一行；unix → curl\|bash），首屏不渲染命令以避免 hydration 不一
全文：.sillyspec/changes/archive/2026-07-15-2026-07-14-daemon-install-os-aware/requirements.md#FR-01
最近确认：af41fac1d

## FR-unmapped-388 Windows 显示 PowerShell 一行（后端动态内嵌 server_url）
变更：2026-07-15-2026-07-14-daemon-install-os-aware
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given OS 选中为 Windows 且 `serverUrl = window.location.origin` 已就绪；When 渲染 Windows 命令；Then 显示 `irm <serverUrl>/daemon/install.ps1 | iex`，并附琥珀提示「在 PowerShell 或 cmd 中运行」；复制按
全文：.sillyspec/changes/archive/2026-07-15-2026-07-14-daemon-install-os-aware/requirements.md#FR-02
最近确认：af41fac1d

## FR-unmapped-389 提供 OS 手动切换开关
变更：2026-07-15-2026-07-14-daemon-install-os-aware
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given `InstallDaemonBlock` 展开；When 用户点击「macOS / Linux」或「Windows」切换按钮；Then 命令与提示切换为对应平台；默认选中值跟随 FR-01 自动检测，可被手动覆盖
全文：.sillyspec/changes/archive/2026-07-15-2026-07-14-daemon-install-os-aware/requirements.md#FR-03
最近确认：af41fac1d

## FR-unmapped-390 macOS / Linux 命令保持现状
变更：2026-07-15-2026-07-14-daemon-install-os-aware
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given OS 选中为 unix；When 渲染命令；Then 显示 `curl -fsSL <serverUrl>/daemon/install.sh | bash -s -- --server-url <serverUr
全文：.sillyspec/changes/archive/2026-07-15-2026-07-14-daemon-install-os-aware/requirements.md#FR-04
最近确认：af41fac1d

## FR-unmapped-391 install.ps1 复刻 install.sh 全逻辑（含 mcp-server.js）
变更：2026-07-15-2026-07-14-daemon-install-os-aware
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given Windows 用户执行 `irm <serverUrl>/daemon/install.ps1 | iex`；When install.ps1 运行
全文：.sillyspec/changes/archive/2026-07-15-2026-07-14-daemon-install-os-aware/requirements.md#FR-05
最近确认：af41fac1d

## FR-unmapped-392 后端 GET /daemon/install.ps1 公开端点
变更：2026-07-15-2026-07-14-daemon-install-os-aware
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given backend 镜像已打包 install.ps1 模板 请求经前端 rewrite 反代到达 backend；When `GET /daemon/install.ps1`（无 /api 前缀） 推导 server_url；Then 返回 200 + `Content-Type: application/x-powershell`，body 为模板且 `{{SERVER_URL}}` 已替换
全文：.sillyspec/changes/archive/2026-07-15-2026-07-14-daemon-install-os-aware/requirements.md#FR-06
最近确认：af41fac1d

## FR-unmapped-393 明细变完成时自动创建关联任务
变更：2026-07-15-2026-07-15-milestone-detail-auto-task
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 一条里程碑明细 `execute_user_id` 已填写 明细 `execute_user_id` 为空；Then 系统创建一条 `PlanTask`，字段按 D-002 映射（user_id←execute_user_id、content←task_theme、start/
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-milestone-detail-auto-task/requirements.md#FR-01
最近确认：43f3d65dc

## FR-unmapped-394 Excel 导入即完成的明细批量建任务
变更：2026-07-15-2026-07-15-milestone-detail-auto-task
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given import_commit 中某行必填字段齐全（required_filled=true → 落 done） 导入行必填缺失（→ draft）或 valid=f；When 导入提交 导入提交 异常冒泡；Then 为每个 done 明细各建一条任务（按 FR-01 映射），与明细入库在同一事务内 该行不建任务（draft 明细不触发） 整批导入（明细 + 任务）回滚，无脏
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-milestone-detail-auto-task/requirements.md#FR-02
最近确认：43f3d65dc

## FR-unmapped-395 编辑已完成明细同步更新关联任务
变更：2026-07-15-2026-07-15-milestone-detail-auto-task
状态：active
摘要：默认场景
依据决策：D-002@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 一条明细已有 `ps_plan_node_detail_id` 关联任务 明细无关联任务（如 draft 明细被编辑）；When `update_detail` 修改了执行人 / 计划开始 / 计划完成 / 任务主题 / 工作量 / 所属模块 `update_detail`；Then 关联任务对应字段同步更新；`task.status` **不**被覆盖（保留任务自身推进） 不新建任务（仅变 done 才建）
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-milestone-detail-auto-task/requirements.md#FR-03
最近确认：43f3d65dc

## FR-unmapped-396 明细变更时任务迁移到新版本
变更：2026-07-15-2026-07-15-milestone-detail-auto-task
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 一条 done 明细已有任务 变更后的新版本 draft 随后被提交变 done；When `change_process`（旧 done→archived + 新建 draft 版本） `_transition`→DONE；Then 关联任务的 `ps_plan_node_detail_id` 迁移到新版本 draft.id（同事务） 命中已迁移的任务并更新字段（不新建第二条）
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-milestone-detail-auto-task/requirements.md#FR-04
最近确认：43f3d65dc

## FR-unmapped-397 删除明细解关联、保留任务
变更：2026-07-15-2026-07-15-milestone-detail-auto-task
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 一条明细有关联任务；When `delete_detail`；Then 关联任务 `ps_plan_node_detail_id` 置 null，任务行及其执行/工时记录保留
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-milestone-detail-auto-task/requirements.md#FR-05
最近确认：43f3d65dc

## FR-unmapped-398 强一致事务
变更：2026-07-15-2026-07-15-milestone-detail-auto-task
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 联动任一步（建/同步/迁移/解关联）失败；When 异常冒泡；Then 明细操作整体回滚（明细与任务同事务，要么都成功要么都回滚）
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-milestone-detail-auto-task/requirements.md#FR-06
最近确认：43f3d65dc

## FR-unmapped-399 历史数据不补建
变更：2026-07-15-2026-07-15-milestone-detail-auto-task
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given 上线前已存在的 done 明细；When 无新的提交/编辑/变更/删除/导入操作；Then 不产生任何任务（联动仅在实时触发时生效，无回填脚本）
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-milestone-detail-auto-task/requirements.md#FR-07
最近确认：43f3d65dc

## FR-unmapped-400 项目→成员两级可展开表
变更：2026-07-15-2026-07-15-project-members-rebuild
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 用户进入 `/ppm/project-members` 一级项目列表已加载 项目未展开；When 页面加载 用户点击某项目行（展开图标）；Then 显示**一级项目列表**（项目名称/项目编号/负责人/成员数/项目状态/项目类型/更新时间/操作），而非成员平铺 **懒加载**该项目成员（调 `GET /pr
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-project-members-rebuild/requirements.md#FR-01
最近确认：a4c99d382

## FR-unmapped-401 一级表展示负责人（推算）与成员数（聚合）
变更：2026-07-15-2026-07-15-project-members-rebuild
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — When 聚合接口返回该项目行 推算负责人 渲染负责人列 聚合接口返回；Then 「负责人」= 该类成员中 `created_at` **最早**者的 `user_name` 取 `created_at` 最早的一个（唯一确定） 显示「—」（
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-project-members-rebuild/requirements.md#FR-02
最近确认：a4c99d382

## FR-unmapped-402 6 维搜索
变更：2026-07-15-2026-07-15-project-members-rebuild
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 搜索区有 6 个筛选项（项目名/项目状态/项目类型/负责人姓名/成员姓名·账号/角色） 填「成员姓名/账号」= "zhang" 填「负责人」= "张" 点「重置；When 用户填写任意组合并点「查询」 查询 查询 重置搜索；Then 一级项目表按条件刷新（调 summary 接口带筛选），结果只命中匹配项目 命中「该项目下存在成员 `user_name` 或 `users.username`
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-project-members-rebuild/requirements.md#FR-03
最近确认：a4c99d382

## FR-unmapped-403 成员子表显示登录账号列
变更：2026-07-15-2026-07-15-project-members-rebuild
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 后端 `ProjectMemberService.page()` LEFT JOIN `users` 成员子表渲染 某成员 `username` 为空（None；When 返回成员 某成员有 `username` 渲染账号列；Then `ProjectMemberResp` 含可选 `username`（登录账号） 「账号」列显示其登录账号 显示「—」（兜底）
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-project-members-rebuild/requirements.md#FR-04
最近确认：a4c99d382

## FR-unmapped-404 两种新增成员入口
变更：2026-07-15-2026-07-15-project-members-rebuild
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given 用户点页头「+ 添加项目成员」（全局） 用户在某项目展开行的子表点「+ 新增成员」（项目内） 新增成员表单（选用户联动回填部门/姓名、角色多选逗号拼接）；When 打开成员表单抽屉 打开成员表单抽屉 提交；Then 抽屉显示「所属项目」选择（跨项目），提交后成员入所选项目 项目已锁定（不显示「所属项目」选择），提交后成员入当前项目 沿用现有 `PpmProjectMembe
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-project-members-rebuild/requirements.md#FR-05
最近确认：a4c99d382

## FR-unmapped-405 增删成员后成员数实时更新
变更：2026-07-15-2026-07-15-project-members-rebuild
状态：active
摘要：默认场景
依据决策：D-007@v1
场景正文：
- 场景：默认场景 — Given 用户在展开行子表新增/编辑/删除成员成功；When `PpmProjectMembersTable` 的 `onChanged` 回调触发；Then 父级 `PpmProjectMembersGroupTable` 重新拉 summary，该行「成员数」实时刷新
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-project-members-rebuild/requirements.md#FR-06
最近确认：a4c99d382

## FR-unmapped-406 projects 页成员抽屉不回归（兼容）
变更：2026-07-15-2026-07-15-project-members-rebuild
状态：active
摘要：默认场景
依据决策：D-004@v1、D-006@v1
场景正文：
- 场景：默认场景 — When 渲染 `<PpmProjectMembersTable projectId />` projects 抽屉不传这两个 prop；Then 行为与现状一致（CRUD/搜索/分页正常），`ProjectMember.username` 可选字段不破坏现有消费 行为同现状（不回调、非嵌入式渲染）
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-project-members-rebuild/requirements.md#FR-07
最近确认：a4c99d382

## FR-unmapped-407 默认排序（不做成员数排序）
变更：2026-07-15-2026-07-15-project-members-rebuild
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 一级项目表未指定排序 派生列 owner_name/member_count；When 加载 试图排序；Then 默认按 `updated_at` 倒序 不在排序白名单内，被静默忽略（仅支持 updated_at/created_at/project_name/projec
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-project-members-rebuild/requirements.md#FR-08
最近确认：a4c99d382

## FR-unmapped-408 左点负载按今天分界 — 过去看实际工时
变更：2026-07-15-workbench-calendar-load-actual
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-002@v1、D-004@v1、D-005@v1、D-006@v1
全文：.sillyspec/changes/archive/2026-07-15-workbench-calendar-load-actual/requirements.md#FR-01
最近确认：f7f73d86c

## FR-unmapped-409 过去无实际记录 → 灰点
变更：2026-07-15-workbench-calendar-load-actual
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-15-workbench-calendar-load-actual/requirements.md#FR-02
最近确认：f7f73d86c

## FR-unmapped-410 未来侧剩余负载
变更：2026-07-15-workbench-calendar-load-actual
状态：active
摘要：（无场景名）
依据决策：D-006@v1、D-007@v1
全文：.sillyspec/changes/archive/2026-07-15-workbench-calendar-load-actual/requirements.md#FR-03
最近确认：f7f73d86c

## FR-unmapped-411 已用 ≥ 计划总量 → 剩余 0
变更：2026-07-15-workbench-calendar-load-actual
状态：active
摘要：（无场景名）
依据决策：D-007@v1
全文：.sillyspec/changes/archive/2026-07-15-workbench-calendar-load-actual/requirements.md#FR-04
最近确认：f7f73d86c

## FR-unmapped-412 右点零回归
变更：2026-07-15-workbench-calendar-load-actual
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-15-workbench-calendar-load-actual/requirements.md#FR-05
最近确认：f7f73d86c

## FR-unmapped-413 actual 区间缺失兜底
变更：2026-07-15-workbench-calendar-load-actual
状态：active
摘要：（无场景名）
依据决策：D-003@v1
全文：.sillyspec/changes/archive/2026-07-15-workbench-calendar-load-actual/requirements.md#FR-06
最近确认：f7f73d86c

## FR-unmapped-414 未来侧兜底（无 work_load / 无 end_time）
变更：2026-07-15-workbench-calendar-load-actual
状态：active
摘要：（无场景名）
依据决策：D-007@v1
全文：.sillyspec/changes/archive/2026-07-15-workbench-calendar-load-actual/requirements.md#FR-07
最近确认：f7f73d86c

## FR-unmapped-415 前端图例口径说明
变更：2026-07-15-workbench-calendar-load-actual
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-15-workbench-calendar-load-actual/requirements.md#FR-08
最近确认：f7f73d86c

## FR-unmapped-416 设备自动分流（middleware rewrite，无 FOUC）
变更：2026-07-22-2026-07-22-mobile-app-ui
状态：active
摘要：（无场景名）
依据决策：D-002@v2、D-005@v1
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-mobile-app-ui/requirements.md#FR-01
最近确认：1326f184d

## FR-unmapped-417 移动外壳 + 底部 5 Tab 导航
变更：2026-07-22-2026-07-22-mobile-app-ui
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-004@v1
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-mobile-app-ui/requirements.md#FR-02
最近确认：1326f184d

## FR-unmapped-418 移动登录页
变更：2026-07-22-2026-07-22-mobile-app-ui
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-mobile-app-ui/requirements.md#FR-03
最近确认：1326f184d

## FR-unmapped-419 个人工作台移动视图（全功能）
变更：2026-07-22-2026-07-22-mobile-app-ui
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-008@v1
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-mobile-app-ui/requirements.md#FR-04
最近确认：1326f184d

## FR-unmapped-420 计划任务移动视图（全功能）
变更：2026-07-22-2026-07-22-mobile-app-ui
状态：active
摘要：（无场景名）
依据决策：D-007@v1、D-008@v1
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-mobile-app-ui/requirements.md#FR-05
最近确认：1326f184d

## FR-unmapped-421 问题清单移动视图（全功能）
变更：2026-07-22-2026-07-22-mobile-app-ui
状态：active
摘要：（无场景名）
依据决策：D-007@v1、D-008@v1
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-mobile-app-ui/requirements.md#FR-06
最近确认：1326f184d

## FR-unmapped-422 工作区选择移动视图（列表全功能 + 详情提示电脑端）
变更：2026-07-22-2026-07-22-mobile-app-ui
状态：active
摘要：（无场景名）
依据决策：D-006@v1、D-008@v1
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-mobile-app-ui/requirements.md#FR-07
最近确认：1326f184d

## FR-unmapped-423 数据层 100% 复用 + 桌面完全零回归
变更：2026-07-22-2026-07-22-mobile-app-ui
状态：active
摘要：（无场景名）
依据决策：D-003@v1
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-mobile-app-ui/requirements.md#FR-08
最近确认：1326f184d

## FR-unmapped-424 断点 token + 样式文档
变更：2026-07-22-2026-07-22-mobile-app-ui
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-mobile-app-ui/requirements.md#FR-09
最近确认：1326f184d

## FR-unmapped-425 TaskExecute 支持 file_urls 字段
变更：2026-07-22-2026-07-22-task-execute-attachments
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given `ppm_task_execute` 表；When migration 升级；Then 表新增 `file_urls` JSON 列（`nullable=False`, `server_default='[]'`），旧记录 `file_urls=[
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-task-execute-attachments/requirements.md#FR-01
最近确认：ce86a8f49

## FR-unmapped-426 计划任务执行填报上传附件（按天）
变更：2026-07-22-2026-07-22-task-execute-attachments
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1、D-005@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 进行中的计划任务，打开 `task-detail-modal` execute 模式，有 in-flight 记录；When 用户在填报区某天上传附件 + 填耗时/说明 + 提交；Then 当天附件 id 存入对应 `TaskExecute.file_urls`；重开时首天已上传附件回填预填；不传 file_urls 时保留原值不清空
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-task-execute-attachments/requirements.md#FR-02
最近确认：ce86a8f49

## FR-unmapped-427 问题执行填报上传附件（按天）
变更：2026-07-22-2026-07-22-task-execute-attachments
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1、D-005@v1、D-006@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 进行中的问题，打开 `problem-detail-modal` execute 模式，有 in-flight 记录；When 用户填报区上传附件 + 提交；Then `file_urls` 经 `problem/router.py` 拆包（`file_urls=body.file_urls`）→ `execute_probl
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-task-execute-attachments/requirements.md#FR-03
最近确认：ce86a8f49

## FR-unmapped-428 执行记录表回显附件
变更：2026-07-22-2026-07-22-task-execute-attachments
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 执行记录表（task/problem-detail-modal）；When 记录有 `file_urls`；Then 附件列行内 `FileViewer` 显示（图片缩略图点击预览 / 文件图标点击下载）；无附件显示空
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-task-execute-attachments/requirements.md#FR-04
最近确认：ce86a8f49

## FR-unmapped-429 跨天填报每天各自附件
变更：2026-07-22-2026-07-22-task-execute-attachments
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 跨天填报（多天 DetailDay）；When 每天各自上传附件 + 提交；Then 每天的 `executePlanTask`/`executeProblem` 携带当天 `file_urls`，各自落独立 `TaskExecute` 记录
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-task-execute-attachments/requirements.md#FR-05
最近确认：ce86a8f49

## FR-unmapped-430 daemon 共享标记（lender）
变更：2026-07-26-2026-07-25-daemon-borrow-for-business
状态：active
摘要：默认场景
依据决策：D-003@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 开发人员是某工作空间成员且已绑定自己的 daemon shared 已为 true；When 开发人员调用 `PUT /workspaces/{ws}/my-binding/shared {shared:true}` lender 设 `shared=f；Then 该 binding 行 `shared=True`，可被同工作空间业务人员借用 共享撤销，借用查询不再命中该 daemon
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-daemon-borrow-for-business/requirements.md#FR-01
最近确认：f608584d8

## FR-unmapped-431 owner 管理共享 daemon
变更：2026-07-26-2026-07-25-daemon-borrow-for-business
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 工作空间存在共享 daemon；When owner 调用 `GET /workspaces/{ws}/shared-daemons` owner 撤销某共享；Then 返回所有 shared daemon 列表（含 lender、在线状态、可撤销） 对应 binding `shared=false`
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-daemon-borrow-for-business/requirements.md#FR-02
最近确认：f608584d8

## FR-unmapped-432 业务人员借用权限 + 端点鉴权
变更：2026-07-26-2026-07-25-daemon-borrow-for-business
状态：active
摘要：默认场景
依据决策：D-001@v1、D-006@v2
场景正文：
- 场景：默认场景 — Given owner 把某用户加为 business_member 角色（`task:run_agent` + `daemon:borrow` + workspace 读；When 该用户（无自有 daemon）触发 agent run 触发 agent run 且无自有 daemon；Then 端点鉴权通过（`task:run_agent`），placement 发现无自有 daemon → 回退借用查询（需 `daemon:borrow`） 报"工作
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-daemon-borrow-for-business/requirements.md#FR-03
最近确认：f608584d8

## FR-unmapped-433 借用派发回退（4 路一致）
变更：2026-07-26-2026-07-25-daemon-borrow-for-business
状态：active
摘要：默认场景
依据决策：D-002@v1、D-008@v1
场景正文：
- 场景：默认场景 — Given actor 是 business_member，工作空间有 shared+online 的 daemon 工作空间无 shared 或全离线；When actor 触发 agent run（任意 SillySpec 阶段 / quick-chat） actor 触发借用；Then 4 路 resolver（`_resolve_dispatch_runtime` / `_resolve_decide_runtime` / `resolve_
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-daemon-borrow-for-business/requirements.md#FR-04
最近确认：f608584d8

## FR-unmapped-434 daemon 沙箱只读隔离
变更：2026-07-26-2026-07-25-daemon-borrow-for-business
状态：active
摘要：默认场景
依据决策：D-007@v2
场景正文：
- 场景：默认场景 — Given 借用 lease 派发到 lender daemon 借用 agent 尝试写 lender 代码区；When daemon 起 agent 进程；Then cwd=独立 sandbox（slug=`borrow-<actor>-<run>`），写策略按 lease 隔离只读 root_path，不命中 lender
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-daemon-borrow-for-business/requirements.md#FR-05
最近确认：f608584d8

## FR-unmapped-435 方案落文件中心
变更：2026-07-26-2026-07-25-daemon-borrow-for-business
状态：active
摘要：默认场景
依据决策：D-001@v1、D-009@v1、D-010@v1
场景正文：
- 场景：默认场景 — Given 借用 agent run 完成（`close_interactive_run` / `complete_lease` 回调）；When backend 拿到方案文本；Then 调 `FileService.upload_file` 落 file（`owner_type=workspace`, `uploaded_by=borrower
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-daemon-borrow-for-business/requirements.md#FR-06
最近确认：f608584d8

## FR-unmapped-436 借用审计
变更：2026-07-26-2026-07-25-daemon-borrow-for-business
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 每次借用发生；When lease 创建/完成；Then 写 `daemon_borrow_audit`（borrower / lender / daemon / workspace / agent_run / bor
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-daemon-borrow-for-business/requirements.md#FR-07
最近确认：f608584d8

## FR-unmapped-437 进门自由化（4 入口点）
变更：2026-07-26-2026-07-26-ungate-workspace-entry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户是某工作区成员（或平台管理员） 用户非该工作区成员（且非平台管理员）；When 用户在列表页 / 顶栏 switcher / 移动端点击该工作区 点击该工作区；Then 直接导航/切换进入工作区（不弹 daemon 绑定 Dialog），与有无 binding 无关 不可进（后端 membership 鉴权拒绝，前端不展示或引导
全文：.sillyspec/changes/archive/2026-07-26-2026-07-26-ungate-workspace-entry/requirements.md#FR-01
最近确认：ffb9a7cc1

## FR-unmapped-438 Guard 降级（不再阻断详情页）
变更：2026-07-26-2026-07-26-ungate-workspace-entry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 成员进入工作区详情页 成员已绑定 daemon；When 成员未绑定 daemon（unbound） 进入详情页；Then WorkspaceBindingGuard 不渲染绑定表单（return null），详情页内容（tabs/概览/文档）正常展示，不阻断 guard 显示"编辑
全文：.sillyspec/changes/archive/2026-07-26-2026-07-26-ungate-workspace-entry/requirements.md#FR-02
最近确认：ffb9a7cc1

## FR-unmapped-439 概览 binding 配置（复用既有 WorkspaceConfigCard）
变更：2026-07-26-2026-07-26-ungate-workspace-entry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 成员在工作区概览页 成员已绑定 daemon；When 成员未绑定 daemon 在概览页；Then 概览的 WorkspaceConfigCard 渲染首次绑定引导（含 WorkspaceAccessGuide），作为**可选**配置入口，非阻断，与文档/变更
全文：.sillyspec/changes/archive/2026-07-26-2026-07-26-ungate-workspace-entry/requirements.md#FR-03
最近确认：ffb9a7cc1

## FR-unmapped-440 daemon 依赖功能统一内联空态（DaemonRequiredNotice）
变更：2026-07-26-2026-07-26-ungate-workspace-entry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 成员无自有 daemon（无 binding），访问 daemon 依赖页（运行时 / 扫描文档 / 组件拓扑源码） 成员已绑定/可借；When 页面主数据需 daemon（host_fs / daemon 实体） 访问 daemon 依赖页；Then 主区渲染 `DaemonRequiredNotice`："⚠ {feature} 需要守护进程" + [配置我的 daemon]（展开 WorkspaceAcc
全文：.sillyspec/changes/archive/2026-07-26-2026-07-26-ungate-workspace-entry/requirements.md#FR-04
最近确认：ffb9a7cc1

## FR-unmapped-441 文档类页面 daemon 无关（不动）
变更：2026-07-26-2026-07-26-ungate-workspace-entry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 成员（任意绑定状态）；When 访问文件中心 / 变更中心 / 成员管理 / 知识库 / 审计 / 审批 / 发布 / 事故；Then 正常浏览（数据在服务器，不经 daemon），无 daemon 要求、无空态
全文：.sillyspec/changes/archive/2026-07-26-2026-07-26-ungate-workspace-entry/requirements.md#FR-05
最近确认：ffb9a7cc1

## FR-unmapped-442 预设供应商模版一键填表单
变更：2026-07-28-2026-07-28-llm-provider-presets-and-usage
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户进入「新建供应商」表单 用户点「＋自定义」预设；When 用户点一个预设（如 Kimi For Coding） 进入表单；Then 表单自动填好 name / base_url / auth_field / 默认模型 / 官网（api_key 留空给用户填） 所有字段空白，用户手填（行为同现
全文：.sillyspec/changes/archive/2026-07-28-2026-07-28-llm-provider-presets-and-usage/requirements.md#FR-01
最近确认：13920f895

## FR-unmapped-443 预设分类排序展示
变更：2026-07-28-2026-07-28-llm-provider-presets-and-usage
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 预设选择器展示；Then 按分类分组：官方 → 国内官方 → 聚合站，每家带图标；支持用量的标「💰 可查用量」
全文：.sillyspec/changes/archive/2026-07-28-2026-07-28-llm-provider-presets-and-usage/requirements.md#FR-02
最近确认：13920f895

## FR-unmapped-444 用量查询端点
变更：2026-07-28-2026-07-28-llm-provider-presets-and-usage
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户有一个支持用量的供应商（如 DeepSeek） 供应商 base_url 识别不到对应 handler；When 前端调 `POST /api/llm-providers/{id}/usage` 查询
全文：.sillyspec/changes/archive/2026-07-28-2026-07-28-llm-provider-presets-and-usage/requirements.md#FR-03
最近确认：13920f895

## FR-unmapped-445 用量查询错误两态
变更：2026-07-28-2026-07-28-llm-provider-presets-and-usage
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 上游瞬时失败（网络 / 5xx / 429 / 超时） 上游确定性失败（401 / 403 鉴权失败）；When 查询 查询；Then 后端 raise（HTTP 5xx），前端保留上次成功值 10 分钟 返回 `success:false, is_valid:false`，前端翻红（仍保留上次
全文：.sillyspec/changes/archive/2026-07-28-2026-07-28-llm-provider-presets-and-usage/requirements.md#FR-04
最近确认：13920f895

## FR-unmapped-446 用量多窗口展示
变更：2026-07-28-2026-07-28-llm-provider-presets-and-usage
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 供应商返回多 tier（如智谱 5 小时窗 + 周限额）；When 前端展示；Then 每个 tier 一行（plan_name / used / remaining / unit + 重置时间 + 进度条）
全文：.sillyspec/changes/archive/2026-07-28-2026-07-28-llm-provider-presets-and-usage/requirements.md#FR-05
最近确认：13920f895

## FR-unmapped-447 用量触发方式
变更：2026-07-28-2026-07-28-llm-provider-presets-and-usage
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户进入供应商列表页 用户点某行「查余额」按钮；When 页面加载完成 触发；Then 对支持用量的供应商自动查一次余额 手动刷新该供应商余额
全文：.sillyspec/changes/archive/2026-07-28-2026-07-28-llm-provider-presets-and-usage/requirements.md#FR-06
最近确认：13920f895

## FR-unmapped-448 不支持用量的友好提示
变更：2026-07-28-2026-07-28-llm-provider-presets-and-usage
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 不支持用量的供应商（百炼 / Anthropic 官方 / detect 不到）；When 列表展示；Then 显示「该供应商暂不支持余额查询」（不带 cc-switch 字样），不报错
全文：.sillyspec/changes/archive/2026-07-28-2026-07-28-llm-provider-presets-and-usage/requirements.md#FR-07
最近确认：13920f895

## FR-unmapped-449 安全（SSRF + api_key）
变更：2026-07-28-2026-07-28-llm-provider-presets-and-usage
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用量查询代查外部 URL api_key 处理；When 发请求前 全链路；Then 过 SSRF 防护（复用 `tool_policy.assert_public_hostname`，IPv4+IPv6） 明文不出后端 / 不入响应 / 不入日
全文：.sillyspec/changes/archive/2026-07-28-2026-07-28-llm-provider-presets-and-usage/requirements.md#FR-08
最近确认：13920f895

## FR-unmapped-450 claude 模型调用失败归类为结构化错误
变更：2026-07-29-model-error-visibility
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1、D-005@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given claude code 交互会话中 claude 调模型失败（result.is_error=true 或 api_retry 带 error 或 assist；When daemon 收到 result / 错误事件；Then 归类为 ModelError{type, code, message, retryable, hint, raw}；type ∈ {auth_failed, q
全文：.sillyspec/changes/archive/2026-07-29-model-error-visibility/requirements.md#FR-01
最近确认：aae96b965

## FR-unmapped-451 错误结构化存储与透传
变更：2026-07-29-model-error-visibility
状态：active
摘要：默认场景
依据决策：D-005@v1、D-007@v1、D-009@v1
场景正文：
- 场景：默认场景 — Given daemon 归类出 ModelError；When notifyRunResult 回传后端（payload 带 error）；Then AgentRun.error_detail（JSON）存储完整 ModelError；run status=failed；`GET /sessions/{id}
全文：.sillyspec/changes/archive/2026-07-29-model-error-visibility/requirements.md#FR-02
最近确认：aae96b965

## FR-unmapped-452 错误项展示与操作
变更：2026-07-29-model-error-visibility
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given run failed 且有 error_detail；When 前端渲染会话；Then 消息流插入 RunErrorItem（图标按 type + 「运行失败」+ message + hint）；run/session 标 failed（标红）；带
全文：.sillyspec/changes/archive/2026-07-29-model-error-visibility/requirements.md#FR-03
最近确认：aae96b965

## FR-unmapped-453 成功路径与既有日志不回归
变更：2026-07-29-model-error-visibility
状态：active
摘要：默认场景
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — Given run is_error=false（成功）或历史 run 无 error_detail；When 前端渲染；Then 成功路径无 ModelError（error_detail=None，不受影响）；历史 failed run 兜底显示「运行失败（无详情）」；agent-log
全文：.sillyspec/changes/archive/2026-07-29-model-error-visibility/requirements.md#FR-04
最近确认：aae96b965

## FR-unmapped-454 菜单按功能域重组
变更：2026-07-30-sidebar-menu-restructure
状态：active
摘要：默认场景
依据决策：D-001@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 用户已登录 SillyHub 且处于非 ppm 路径；When 查看侧边栏；Then 菜单按 5 组渲染（工作区/智能体/配置中心/协作治理/系统管理），各菜单项归属符合 design §5.1，且守护进程运行时位于配置中心组。
全文：.sillyspec/changes/archive/2026-07-30-sidebar-menu-restructure/requirements.md#FR-01
最近确认：82c01fcfc

## FR-unmapped-455 我的供应商独立菜单直达
变更：2026-07-30-sidebar-menu-restructure
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 用户具有 `llm_provider:read` 权限或为 platform admin 用户无 `llm_provider:read` 且非 platform；When 点击侧边栏"我的供应商" 查看侧边栏；Then 直达 `/settings/providers` 页面，可管理自己的供应商（复用 `LlmProviderSection`）。 不显示"我的供应商"菜单项。
全文：.sillyspec/changes/archive/2026-07-30-sidebar-menu-restructure/requirements.md#FR-02
最近确认：82c01fcfc

## FR-unmapped-456 技能管理 / MCP 管理独立菜单（平台级）
变更：2026-07-30-sidebar-menu-restructure
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 用户具有 `settings:admin` 权限或为 platform admin；When 点击侧边栏"技能管理"或"MCP 管理"；Then 分别直达 `/settings/skills`、`/settings/mcp`（平台级页面）。
全文：.sillyspec/changes/archive/2026-07-30-sidebar-menu-restructure/requirements.md#FR-03
最近确认：82c01fcfc

## FR-unmapped-457 设置页瘦身
变更：2026-07-30-sidebar-menu-restructure
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 用户打开 `/settings`；When 页面渲染；Then 仅显示工作区信息/智能体配置/安全策略/集成 4 个 Tab，默认选中工作区信息；无供应商 Tab、无 4 个 EntryCard 卡片入口。
全文：.sillyspec/changes/archive/2026-07-30-sidebar-menu-restructure/requirements.md#FR-04
最近确认：82c01fcfc

## FR-unmapped-458 供应商可见性可分配
变更：2026-07-30-sidebar-menu-restructure
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 后端 `permissions.py` 已含 `llm_provider:read`；When 重启后端；Then `seed_platform_admin_role` 自动将该权限绑定至 platform_admin 角色（无需 migration），且角色管理中可为任意角
全文：.sillyspec/changes/archive/2026-07-30-sidebar-menu-restructure/requirements.md#FR-05
最近确认：82c01fcfc

## FR-unmapped-459 菜单视觉统一
变更：2026-07-30-sidebar-menu-restructure
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 侧边栏渲染；When 查看任意菜单项；Then 图标均为 lucide 线条图标（含新增 3 项）、无 emoji；分组间距与选中高亮样式统一；ppm 隔离与 `navHidden` 二级页逻辑保持不变。
全文：.sillyspec/changes/archive/2026-07-30-sidebar-menu-restructure/requirements.md#FR-06
最近确认：82c01fcfc

## FR-unmapped-460 proxy-create 不再 500（消除 changes 表并发）
变更：2026-08-02-proxy-create-race-fix
状态：active
摘要：（无场景名）
依据决策：D-001@v2、D-006@v1
全文：.sillyspec/changes/archive/2026-08-02-proxy-create-race-fix/requirements.md#FR-01
最近确认：d089b492d

## FR-unmapped-461 change_documents 表无并发撞键（消除 docs 同源竞态）
变更：2026-08-02-proxy-create-race-fix
状态：active
摘要：（无场景名）
依据决策：D-001@v2、D-006@v1
全文：.sillyspec/changes/archive/2026-08-02-proxy-create-race-fix/requirements.md#FR-02
最近确认：d089b492d

## FR-unmapped-462 proxy 状态权威（owner_id 守卫）
变更：2026-08-02-proxy-create-race-fix
状态：active
摘要：（无场景名）
依据决策：D-002@v1
全文：.sillyspec/changes/archive/2026-08-02-proxy-create-race-fix/requirements.md#FR-03
最近确认：d089b492d

## FR-unmapped-463 极端并发撞键兜底
变更：2026-08-02-proxy-create-race-fix
状态：active
摘要：（无场景名）
依据决策：D-004@v1
全文：.sillyspec/changes/archive/2026-08-02-proxy-create-race-fix/requirements.md#FR-04
最近确认：d089b492d

## FR-unmapped-464 失败回滚
变更：2026-08-02-proxy-create-race-fix
状态：active
摘要：（无场景名）
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-08-02-proxy-create-race-fix/requirements.md#FR-05
最近确认：d089b492d

## FR-unmapped-465 中文标题 change_key 可读
变更：2026-08-02-proxy-create-race-fix
状态：active
摘要：（无场景名）
依据决策：D-003@v1
全文：.sillyspec/changes/archive/2026-08-02-proxy-create-race-fix/requirements.md#FR-06
最近确认：d089b492d

## FR-unmapped-466 backend SSE envelope 透传 segment_id（覆盖 D-001@v1）
变更：2026-08-03-session-stream-partial-revoke
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given backend `run_sync/service.py` 处理一条 session 消息（partial 或 complete）；When 构造 `published_logs`（:595）与 `session_payload`（:164）；Then envelope 含 `segment_id` 字段；**partial 行 = `main:msg_xxx:N`（非空），complete/其他行 = `No
全文：.sillyspec/changes/archive/2026-08-03-session-stream-partial-revoke/requirements.md#FR-01
最近确认：f7f73d86c

## FR-unmapped-467 backend override 信号 publish 到 SSE 且不落库（覆盖 D-001@v1）
变更：2026-08-03-session-stream-partial-revoke
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given backend override 分支（:413 thinking / :445 assistant）收到 `[ASSISTANT_OVERRIDE]/[THI；When 处理该信号；Then (1) 保留 task-14 的 `_revoke_committed_partials` DELETE + `flushed_partials.pop`（落库
全文：.sillyspec/changes/archive/2026-08-03-session-stream-partial-revoke/requirements.md#FR-02
最近确认：f7f73d86c

## FR-unmapped-468 frontend SessionStreamEnvelope 加字段（覆盖 D-002@v1）
变更：2026-08-03-session-stream-partial-revoke
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given `frontend/src/lib/daemon.ts` `SessionStreamEnvelope`（:711）；When 定义类型；Then 含 `segment_id: string | null` 与 `stale: boolean`（默认 false，override 行 true）。
全文：.sillyspec/changes/archive/2026-08-03-session-stream-partial-revoke/requirements.md#FR-03
最近确认：f7f73d86c

## FR-unmapped-469 frontend classifySessionLog 识别 override（覆盖 D-002@v1）
变更：2026-08-03-session-stream-partial-revoke
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given `session-log-sanitize.ts` `classifySessionLog`（:60）收到 content `sanitizeSessionLo；When content 匹配 `^\[(ASSISTANT_OVERRIDE|THINKING_OVERRIDE)\]\s+(\S+)` 处理；Then 返回 `{kind:"override", segmentId:<捕获>, variant:"assistant"|"thinking", text:""}`；
全文：.sillyspec/changes/archive/2026-08-03-session-stream-partial-revoke/requirements.md#FR-04
最近确认：f7f73d86c

## FR-unmapped-470 frontend onLog 按 segmentId 撤回 partial（覆盖 D-002@v1）
变更：2026-08-03-session-stream-partial-revoke
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given onLog 收到 `seg.kind==="reply"` 且 `env.segment_id` 非空（半截） onLog 收到 `seg.kind==="ov；When 处理 处理 turn 收尾 并发 partial + override；Then 记录 `partialSegments[segmentId] = {outputStart: turn.output.length}`，再 concat 文本（
全文：.sillyspec/changes/archive/2026-08-03-session-stream-partial-revoke/requirements.md#FR-05
最近确认：f7f73d86c

## FR-unmapped-471 frontend logsToTurns 历史兼容
变更：2026-08-03-session-stream-partial-revoke
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 历史回看 `logsToTurns`；When 处理 GET `/sessions/{id}/logs` 返回的历史数据；Then 不加撤回逻辑（数据本就干净：partial 已 DELETE、override 不落库）；envelope 新字段在历史 GET 不返回（DTO 不含），`lo
全文：.sillyspec/changes/archive/2026-08-03-session-stream-partial-revoke/requirements.md#FR-06
最近确认：f7f73d86c

## FR-unmapped-472 测试覆盖（覆盖 D-001/D-002/D-003）
变更：2026-08-03-session-stream-partial-revoke
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given backend + frontend 实现；When 跑测试；Then backend：override publish 到 SSE + 不落库（断言 `agent_run_logs` 无 override 行）+ segment_
全文：.sillyspec/changes/archive/2026-08-03-session-stream-partial-revoke/requirements.md#FR-07
最近确认：f7f73d86c

## FR-unmapped-473 侧边栏一级菜单入口
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-007@v1
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-01
最近确认：63710e533

## FR-unmapped-474 全局聚合视图
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-004@v1
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-02
最近确认：63710e533

## FR-unmapped-475 聚合端点可见性越权防护
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
依据决策：D-004@v1
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-03
最近确认：63710e533

## FR-unmapped-476 卡片墙列表
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
依据决策：D-002@v1
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-04
最近确认：63710e533

## FR-unmapped-477 搜索与筛选
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
依据决策：D-001@v1
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-05
最近确认：63710e533

## FR-unmapped-478 带实时预览的重做表单
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
依据决策：D-003@v1、D-006@v1
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-06
最近确认：63710e533

## FR-unmapped-479 人设预览
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-07
最近确认：63710e533

## FR-unmapped-480 系统预置档案只读(保留前置变更行为)
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-08
最近确认：63710e533

## FR-unmapped-481 选档下拉视觉对齐
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-09
最近确认：63710e533

## FR-unmapped-482 工作区内页复用卡片墙
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
依据决策：D-001@v1
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-10
最近确认：63710e533

## FR-unmapped-483 daemon 上报 started_at（覆盖 D-001@v1）
变更：2026-08-05-daemon-start-time
状态：active
摘要：（无场景名）
依据决策：D-001@v1
全文：.sillyspec/changes/archive/2026-08-05-daemon-start-time/requirements.md#FR-01
最近确认：b9b0454bb

## FR-unmapped-484 backend 存储 + machines 返回 started_at（覆盖 D-001@v1, D-002@v1）
变更：2026-08-05-daemon-start-time
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-002@v1
全文：.sillyspec/changes/archive/2026-08-05-daemon-start-time/requirements.md#FR-02
最近确认：b9b0454bb

## FR-unmapped-485 前端机器头显示 started_at
变更：2026-08-05-daemon-start-time
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-05-daemon-start-time/requirements.md#FR-03
最近确认：b9b0454bb

## FR-unmapped-486 runtime 读端点返回 daemon 版本（覆盖 D-004@v1）
变更：2026-08-05-daemon-version
状态：active
摘要：（无场景名）
依据决策：D-004@v1
全文：.sillyspec/changes/archive/2026-08-05-daemon-version/requirements.md#FR-01
最近确认：9afbfe036

## FR-unmapped-487 构建号每次 build 自动变化（覆盖 D-001@v1, D-002@v1）
变更：2026-08-05-daemon-version
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-002@v1
全文：.sillyspec/changes/archive/2026-08-05-daemon-version/requirements.md#FR-02
最近确认：9afbfe036

## FR-unmapped-488 build-id.ts 移出版控后 tsc 不缺文件（覆盖 D-003@v1）
变更：2026-08-05-daemon-version
状态：active
摘要：（无场景名）
依据决策：D-003@v1
全文：.sillyspec/changes/archive/2026-08-05-daemon-version/requirements.md#FR-03
最近确认：9afbfe036

## FR-unmapped-489 三端点路径契约（D-001）
变更：2026-08-10-sillyhub-platform-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-sillyhub-platform-sync/requirements.md#FR-01
最近确认：9f7e0732f

## FR-unmapped-490 Bearer 鉴权（D-002）
变更：2026-08-10-sillyhub-platform-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-sillyhub-platform-sync/requirements.md#FR-02
最近确认：9f7e0732f

## FR-unmapped-491 platform_change_progress 存储（D-003）
变更：2026-08-10-sillyhub-platform-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-sillyhub-platform-sync/requirements.md#FR-03
最近确认：9f7e0732f

## FR-unmapped-492 base_ts 冲突检测算法（D-004 / 契约 §4.2）
变更：2026-08-10-sillyhub-platform-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-sillyhub-platform-sync/requirements.md#FR-04
最近确认：9f7e0732f

## FR-unmapped-493 元字段走 HTTP header（D-005 / 契约 §4.1）
变更：2026-08-10-sillyhub-platform-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-sillyhub-platform-sync/requirements.md#FR-05
最近确认：9f7e0732f

## FR-unmapped-494 冲突不 auto-merge（D-006 / 契约 §9）
变更：2026-08-10-sillyhub-platform-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-sillyhub-platform-sync/requirements.md#FR-06
最近确认：9f7e0732f

## FR-unmapped-495 GET 响应裸形态（D-007 / 契约 §5/§6）
变更：2026-08-10-sillyhub-platform-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-sillyhub-platform-sync/requirements.md#FR-07
最近确认：9f7e0732f

## FR-unmapped-496 name 全局唯一寻址（D-008 / 契约 §3）
变更：2026-08-10-sillyhub-platform-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-sillyhub-platform-sync/requirements.md#FR-08
最近确认：9f7e0732f

## FR-unmapped-497 左主右辅布局
变更：2026-08-11-change-detail-layout-rework
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 用户打开任一变更详情页（桌面宽屏 ≥1024px） 视口宽度 <1024px；When 页面渲染完成 页面渲染；Then 主体为两栏：左侧主线区（当前阶段操作 + 智能体执行日志），右侧 320px 次线侧栏（变更文件/会话调试/审核历史/任务看板） 退化为单列：主线在上，次线卡片
全文：.sillyspec/changes/archive/2026-08-11-change-detail-layout-rework/requirements.md#FR-01
最近确认：12ea22a84

## FR-unmapped-498 会话与执行日志分离
变更：2026-08-11-change-detail-layout-rework
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 详情页已加载；When 用户查看主线区；Then 只见「智能体执行日志」（流程自动 run），不见「会话」；「会话调试」出现在次线侧栏
全文：.sillyspec/changes/archive/2026-08-11-change-detail-layout-rework/requirements.md#FR-02
最近确认：12ea22a84

## FR-unmapped-499 审核历史读真实数据
变更：2026-08-11-change-detail-layout-rework
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 某变更存在审核记录（`change.stages.review_history` 非空） `review_history` 数组同时含 gate 形状（`{de；When 用户展开次线「审核历史」卡 渲染审核历史
全文：.sillyspec/changes/archive/2026-08-11-change-detail-layout-rework/requirements.md#FR-03
最近确认：12ea22a84

## FR-unmapped-500 删除旧区块
变更：2026-08-11-change-detail-layout-rework
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 详情页已加载；When 渲染完成；Then 不再出现「审批状态」区块；「审查记录」旧实现（读 listReviews 死表）被「审核历史」取代
全文：.sillyspec/changes/archive/2026-08-11-change-detail-layout-rework/requirements.md#FR-04
最近确认：12ea22a84

## FR-unmapped-501 智能体入口收敛
变更：2026-08-11-change-detail-layout-rework
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 详情页已加载且当前阶段有待办操作 主线「智能体执行日志」内含子步骤进度（SillySpecStepProgress）；When 用户查看主线「当前阶段操作区」 渲染；Then 推进/审核/触发智能体/运行验证门禁/Agent 供应商·模型/团队开关集中在该区内，页面其它位置无重复入口 其内嵌「触发智能体/执行下一步」按钮不渲染（组合时
全文：.sillyspec/changes/archive/2026-08-11-change-detail-layout-rework/requirements.md#FR-05
最近确认：12ea22a84

## FR-unmapped-502 组件化与死代码清除
变更：2026-08-11-change-detail-layout-rework
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 本变更完成；When 查看代码结构；Then page.tsx 瘦身为编排层；7 个区块组件位于 `components/changes/detail/` 并各有测试；`handleExecute`/`ha
全文：.sillyspec/changes/archive/2026-08-11-change-detail-layout-rework/requirements.md#FR-06
最近确认：12ea22a84

## FR-unmapped-503 workspace-scoped token 签发
变更：2026-08-11-change-progress-projection
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given workspace 成员持 WORKSPACE_WRITE 权限；When 调 `POST /api/workspaces/{wid}/platform-sync-tokens`；Then 201 返回 `shpsync_` 明文 token 一次；`platform_sync_tokens` 存 sha256(token_hash) + work
全文：.sillyspec/changes/archive/2026-08-11-change-progress-projection/requirements.md#FR-01
最近确认：c769ce3d6

## FR-unmapped-504 收件箱按 workspace 隔离
变更：2026-08-11-change-progress-projection
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given `platform_change_progress` 加 workspace_id + 复合唯一 `(workspace_id, change_name)`；When 持 `shpsync_` token 上行 `POST /api/changes/{name}/progress`；Then `require_platform_sync` 派生 (User=created_by, workspace_id)，upsert 按复合键隔离；workspa
全文：.sillyspec/changes/archive/2026-08-11-change-progress-projection/requirements.md#FR-02
最近确认：c769ce3d6

## FR-unmapped-505 connect 自动下发 + 权限校验
变更：2026-08-11-change-progress-projection
状态：active
摘要：默认场景
依据决策：D-005@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 用户跑 `sillyspec platform connect` 且持 user 级 shk_live_；When connect 调 `POST /api/workspaces/resolve-by-root-path`（body=root_path）；Then 反查 workspace（不到→404）→ 校验调用者 WORKSPACE_WRITE（无→403）→ 签发 shpsync_ 返回 `{workspace_i
全文：.sillyspec/changes/archive/2026-08-11-change-progress-projection/requirements.md#FR-03
最近确认：c769ce3d6

## FR-unmapped-506 变更中心实时 join 投影 current_stage
变更：2026-08-11-change-progress-projection
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 变更中心查列表/详情；When `enrich_summaries`（list 批量 IN join）/`enrich_with_workspace_ids`（single = 匹配）join；Then 取 `latest_progress.changes[0].current_stage` 覆盖猜值；read-only 不写 changes 表；无 N+1
全文：.sillyspec/changes/archive/2026-08-11-change-progress-projection/requirements.md#FR-04
最近确认：c769ce3d6

## FR-unmapped-507 未上行 fallback
变更：2026-08-11-change-progress-projection
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 工具从未上行的 change（或 quick-<uuid8> 不建目录）；When join 不命中；Then fallback 到 changes 表现有 current_stage，不崩
全文：.sillyspec/changes/archive/2026-08-11-change-progress-projection/requirements.md#FR-05
最近确认：c769ce3d6

## FR-unmapped-508 不投 status（已撤销 D-004@v2）
变更：2026-08-11-change-progress-projection
状态：active
摘要：默认场景
依据决策：D-004@v2
场景正文：
- 场景：默认场景 — Given sillyspec status 仅 active/archived 两值；When 投影；Then 只覆盖 current_stage；status 维持变更中心派生（current_stage==archive → 已归档）
全文：.sillyspec/changes/archive/2026-08-11-change-progress-projection/requirements.md#FR-06
最近确认：c769ce3d6

## FR-unmapped-509 gen:types 同步
变更：2026-08-11-change-progress-projection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When 后端 schema 改动；Then 跑 `pnpm gen:types` 同步 `api-types.ts` + `openapi.json` 并提交
全文：.sillyspec/changes/archive/2026-08-11-change-progress-projection/requirements.md#FR-07
最近确认：c769ce3d6

## FR-unmapped-510 migration 棕地免回填
变更：2026-08-11-change-progress-projection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When `alembic upgrade`；Then 建 `platform_sync_tokens` 表 + `platform_change_progress` 加 workspace_id 复合唯一；老数据不
全文：.sillyspec/changes/archive/2026-08-11-change-progress-projection/requirements.md#FR-08
最近确认：c769ce3d6

## FR-unmapped-511 McpToken 列表展示
变更：2026-08-11-mcp-token-management-ui
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-11-mcp-token-management-ui/requirements.md#FR-01
最近确认：23ffff4b7

## FR-unmapped-512 签发 McpToken
变更：2026-08-11-mcp-token-management-ui
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-11-mcp-token-management-ui/requirements.md#FR-02
最近确认：23ffff4b7

## FR-unmapped-513 吊销 McpToken
变更：2026-08-11-mcp-token-management-ui
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-11-mcp-token-management-ui/requirements.md#FR-03
最近确认：23ffff4b7

## FR-unmapped-514 workspace 子导航入口
变更：2026-08-11-mcp-token-management-ui
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-11-mcp-token-management-ui/requirements.md#FR-04
最近确认：23ffff4b7

## FR-unmapped-515 viewer 无权限兜底
变更：2026-08-11-mcp-token-management-ui
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-11-mcp-token-management-ui/requirements.md#FR-05
最近确认：23ffff4b7

## FR-unmapped-516 统计卡片
变更：2026-08-11-mcp-token-management-ui
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-11-mcp-token-management-ui/requirements.md#FR-06
最近确认：23ffff4b7

## FR-unmapped-517 init claim 时签发两个 workspace-scoped token
变更：2026-08-12-init-provision-local-yaml
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 workspace 已 ensure_spec_workspace 且成员已绑定 daemon；When daemon claim 该 workspace 的 init lease（mode='init'）
全文：.sillyspec/changes/archive/2026-08-12-init-provision-local-yaml/requirements.md#FR-01
最近确认：a34d556ff

## FR-unmapped-518 get_or_issue 吊销旧未吊销 + 签新（逻辑复用，不堆积）
变更：2026-08-12-init-provision-local-yaml
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 同一 (workspace_id, created_by) 已存在未吊销的 shpsync_/shmcp_ token 同一 (workspace_id, cr；When init claim 调 get_or_issue init claim 调 get_or_issue；Then 旧 token 被 revoke（revoked_at=now），新 token 签发返回明文；同维度始终仅一条活 token 直接签新 token 返回明文
全文：.sillyspec/changes/archive/2026-08-12-init-provision-local-yaml/requirements.md#FR-02
最近确认：a34d556ff

## FR-unmapped-519 明文 token 不落 lease.metadata
变更：2026-08-12-init-provision-local-yaml
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given init lease 正被 claim；When build_claim_payload 注入 local_yaml；Then 明文 token 只存在于 claim 请求的内存 payload，**不写** lease.metadata_（DB 持久化 JSON 列、被审计服务读取）；
全文：.sillyspec/changes/archive/2026-08-12-init-provision-local-yaml/requirements.md#FR-03
最近确认：a34d556ff

## FR-unmapped-520 daemon 写 local.yaml platform 段（权威覆盖）
变更：2026-08-12-init-provision-local-yaml
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 收到含 local_yaml 的 init payload + rootPath；When handleInitLease 执行 writeLocalYaml；Then `<rootPath>/.sillyspec/local.yaml` 的 `platform:` 顶层段被文本级覆盖为 `{url: <serverOrigin
全文：.sillyspec/changes/archive/2026-08-12-init-provision-local-yaml/requirements.md#FR-04
最近确认：a34d556ff

## FR-unmapped-521 daemon 写 local.yaml mcp 段（有才留）
变更：2026-08-12-init-provision-local-yaml
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 收到含 local_yaml 的 init payload；When handleInitLease 执行 writeLocalYaml；Then 若 `mcp:` 顶层段**不存在**，写入 `{url: <serverOrigin>/mcp, token: <mcp_token>}`；若**已存在**（
全文：.sillyspec/changes/archive/2026-08-12-init-provision-local-yaml/requirements.md#FR-05
最近确认：a34d556ff

## FR-unmapped-522 url 由 daemon 端决定
变更：2026-08-12-init-provision-local-yaml
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 写 local.yaml；Then platform_url = daemon `config.server_url`（去尾斜杠），mcp_url = platform_url + `/mcp`；
全文：.sillyspec/changes/archive/2026-08-12-init-provision-local-yaml/requirements.md#FR-06
最近确认：a34d556ff

## FR-unmapped-523 写 local.yaml 失败 = init 整体失败
变更：2026-08-12-init-provision-local-yaml
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given writeLocalYaml 因任何原因失败（无写权限/磁盘满/路径无效）；When handleInitLease 第 4 步 catch 到错误；Then 返回 `ok:false`，`_runInitLease` 据 result.ok 走 `_finish(false)`，lease 标 failed，init
全文：.sillyspec/changes/archive/2026-08-12-init-provision-local-yaml/requirements.md#FR-07
最近确认：a34d556ff

## FR-unmapped-524 mcp token scope 合法
变更：2026-08-12-init-provision-local-yaml
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given McpTokenService.get_or_issue 签发；Then scope 必须取 `MCP_SCOPES` 合法值（read/dispatch/converge，backend/app/modules/mcp_gateway/auth.py:44）；init 场景用 `['dispat
全文：.sillyspec/changes/archive/2026-08-12-init-provision-local-yaml/requirements.md#FR-08
最近确认：a34d556ff

## FR-unmapped-525 主 tab 维度统一 + 待我处理聚焦筛选
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-01
最近确认：b76ab5517

## FR-unmapped-526 「待我处理」语义 = 全局待人工
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-02
最近确认：b76ab5517

## FR-unmapped-527 ChangeSummary 携带 pending_review（零 migration，走 PG 镜像）
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-03
最近确认：b76ab5517

## FR-unmapped-528 默认排序「最近活动优先」+ 可切换
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-04
最近确认：b76ab5517

## FR-unmapped-529 待办状态徽标
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-05
最近确认：b76ab5517

## FR-unmapped-530 负责人列
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-06
最近确认：b76ab5517

## FR-unmapped-531 查询区消除留白
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-07
最近确认：b76ab5517

## FR-unmapped-532 新建变更升主按钮
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-08
最近确认：b76ab5517

## FR-unmapped-533 空状态引导 CTA
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-09
最近确认：b76ab5517

## FR-unmapped-534 tab 挂计数
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-10
最近确认：b76ab5517

## FR-unmapped-535 副标题修正
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-11
最近确认：b76ab5517

## FR-unmapped-536 删除死代码
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-12
最近确认：b76ab5517

## FR-unmapped-537 接口类型同步
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-13
最近确认：b76ab5517

## FR-unmapped-538 增量推送（只推变化）
变更：2026-08-13-platform-managed-file-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-platform-managed-file-sync/requirements.md#FR-01
最近确认：a830df116

## FR-unmapped-539 多写者乐观锁
变更：2026-08-13-platform-managed-file-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-platform-managed-file-sync/requirements.md#FR-02
最近确认：a830df116

## FR-unmapped-540 服务器权威清单（独立 spec_file_manifest 表）
变更：2026-08-13-platform-managed-file-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-platform-managed-file-sync/requirements.md#FR-03
最近确认：a830df116

## FR-unmapped-541 软删除备份（move 出 spec_root）
变更：2026-08-13-platform-managed-file-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-platform-managed-file-sync/requirements.md#FR-04
最近确认：a830df116

## FR-unmapped-542 rename 显式 op
变更：2026-08-13-platform-managed-file-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-platform-managed-file-sync/requirements.md#FR-05
最近确认：a830df116

## FR-unmapped-543 `.runtime/` 移出增量范围
变更：2026-08-13-platform-managed-file-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-platform-managed-file-sync/requirements.md#FR-06
最近确认：a830df116

## FR-unmapped-544 兼容
变更：2026-08-13-platform-managed-file-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-platform-managed-file-sync/requirements.md#FR-07
最近确认：a830df116

## FR-unmapped-545 目录树浏览（懒加载）
变更：2026-08-18-workspace-file-browser
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 用户已登录且对 workspace 有 workspace:read 权限，且当前用户有 daemon 绑定且 daemon 在线 daemon 离线 当前用户；When 打开「文件」标签页 / 展开某目录节点 打开文件页 打开文件页；Then 前端调用 `GET /explorer/tree?path=<rel>`，backend 按当前用户绑定解析 daemon 并转发 `explorer_list
全文：.sillyspec/changes/archive/2026-08-18-workspace-file-browser/requirements.md#FR-01
最近确认：860cfdb41

## FR-unmapped-546 文件预览
变更：2026-08-18-workspace-file-browser
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 用户在树中选中一个文件 文件为 utf8 解码失败的非文本文件；When 前端调用 `GET /explorer/file?path=<rel>` daemon explorer_read_file 处理；Then 按类型渲染：代码→语法高亮（react-syntax-highlighter）；Markdown→渲染视图；图片→blob 内联；二进制或 >10MB→元信息卡
全文：.sillyspec/changes/archive/2026-08-18-workspace-file-browser/requirements.md#FR-02
最近确认：860cfdb41

## FR-unmapped-547 文件下载
变更：2026-08-18-workspace-file-browser
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 用户选中任意已列出文件；When 点击下载；Then `GET /explorer/download?path=<rel>` 经 daemon `encoding=base64` 通道回传，StreamingRes
全文：.sillyspec/changes/archive/2026-08-18-workspace-file-browser/requirements.md#FR-03
最近确认：860cfdb41

## FR-unmapped-548 文件名全局搜索
变更：2026-08-18-workspace-file-browser
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 用户已加载文件页；When 在搜索框输入关键词提交；Then `GET /explorer/search?q=` → daemon 全树递归（跳过 node_modules/.git 等噪声目录）大小写不敏感子串匹配文件名
全文：.sillyspec/changes/archive/2026-08-18-workspace-file-browser/requirements.md#FR-04
最近确认：860cfdb41

## FR-unmapped-549 路径安全
变更：2026-08-18-workspace-file-browser
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 任意 explorer 端点收到恶意 path（`../`、绝对路径、UNC、工作区内 symlink 指向 root 外）；When backend 预检或 daemon 校验执行；Then backend 预检拒绝（422）或 daemon realpath 落点校验拒绝（forbidden→403），无任何 root 外内容泄漏
全文：.sillyspec/changes/archive/2026-08-18-workspace-file-browser/requirements.md#FR-05
最近确认：860cfdb41

## FR-unmapped-550 版本兼容降级
变更：2026-08-18-workspace-file-browser
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 用户本机 daemon 为旧版（未注册 explorer_* 方法）；When 调用任意 explorer 端点；Then daemon 回 method_not_found，backend 映射 422，前端显示「daemon 版本过旧请升级」卡；平台其它功能不受影响
全文：.sillyspec/changes/archive/2026-08-18-workspace-file-browser/requirements.md#FR-06
最近确认：860cfdb41

## FR-unmapped-551 新建会话四选择器联动
变更：2026-08-19-sessions-portal
状态：active
摘要：默认场景
依据决策：D-005@v1、D-010@v1、D-013@v1
场景正文：
- 场景：默认场景 — Given 用户在 /sessions 点「新建会话」；When 提交；Then 表单依次为：守护进程（必选，仅在线机器可选、离线置灰；默认=上次选择(localStorage)→最近会话的在线机器→最新心跳）、智能体（必选，所选机器在线 r
全文：.sillyspec/changes/archive/2026-08-19-sessions-portal/requirements.md#FR-01
最近确认：6453d9ca0

## FR-unmapped-552 会话列表（所有会话）
变更：2026-08-19-sessions-portal
状态：active
摘要：默认场景
依据决策：D-003@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 用户进入 /sessions；When 点击会话；Then 左侧列出跨机器/智能体的全部会话（含已结束/失败），紧凑两行条目（状态点+标题+相对时间 / 机器+引擎+档案+供应商+轮数 chips，chips 读会话快照
全文：.sillyspec/changes/archive/2026-08-19-sessions-portal/requirements.md#FR-02
最近确认：6453d9ca0

## FR-unmapped-553 未选供应商/档案零回归
变更：2026-08-19-sessions-portal
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 用户不选供应商和档案（或经 /runtimes 弹窗开会在话）；When 会话执行；Then 行为与现状一致：全局默认供应商配置注入、无人格、模型走既有覆盖链
全文：.sillyspec/changes/archive/2026-08-19-sessions-portal/requirements.md#FR-03
最近确认：6453d9ca0

## FR-unmapped-554 会话级配置生效
变更：2026-08-19-sessions-portal
状态：active
摘要：默认场景
依据决策：D-011@v1、D-013@v1
场景正文：
- 场景：默认场景 — Given 用户选了档案和/或供应商；When 会话执行；Then 档案只注入人格提示词（system_prompt，Claude）+ mcp/skill 透传，不派生引擎/模型/供应商；供应商优先级=会话选择 > 全局默认（不
全文：.sillyspec/changes/archive/2026-08-19-sessions-portal/requirements.md#FR-04
最近确认：6453d9ca0

## FR-unmapped-555 会话内配置热切换（样式 B）
变更：2026-08-19-sessions-portal
状态：active
摘要：默认场景
依据决策：D-004@v2、D-007@v1、D-012@v1
场景正文：
- 场景：默认场景 — Given 会话 active 且当前轮完成（idle） 当前轮运行中；When 用户点输入框下方配置控件条中「供应商/档案」并选择新值、发送消息；Then inject 携带新配置+prompt；后端建新 AgentRun（新快照）并下发 SESSION_SWITCH_CONFIG；daemon 在轮次边界 rel
全文：.sillyspec/changes/archive/2026-08-19-sessions-portal/requirements.md#FR-05
最近确认：6453d9ca0

## FR-unmapped-556 切换合法性校验
变更：2026-08-19-sessions-portal
状态：active
摘要：默认场景
依据决策：D-004@v2、D-013@v1
场景正文：
- 场景：默认场景 — Given 用户绕过前端以不匹配供应商（agent_kind 与引擎不符、非本人供应商）发起切换；When 后端 inject_session 校验；Then 返回 4xx 中文错误；会话状态不变（档案无引擎属性，无需引擎校验，D-013）
全文：.sillyspec/changes/archive/2026-08-19-sessions-portal/requirements.md#FR-06
最近确认：6453d9ca0

## FR-unmapped-557 每轮配置快照（历史不跟随）
变更：2026-08-19-sessions-portal
状态：active
摘要：默认场景
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — Given 会话发生过配置切换；When 渲染消息流；Then 每条回复 who 行显示该轮生效配置（`档案 · 智能体 · 供应商`，未选如实显示「未指定/本机默认」），切换后旧消息保持原配置不变
全文：.sillyspec/changes/archive/2026-08-19-sessions-portal/requirements.md#FR-07
最近确认：6453d9ca0

## FR-unmapped-558 上下文用量 + 供应商额度
变更：2026-08-19-sessions-portal
状态：active
摘要：默认场景
依据决策：D-009@v1、D-014@v1
场景正文：
- 场景：默认场景 — Given 会话面板；When 切换供应商；Then 输入框上方一行显示上下文用量环形进度（累计 usage/模型窗口，分母=供应商配置派生（1M 勾选→1000k）→模型默认常量表（200k）→无则只显示累计 t
全文：.sillyspec/changes/archive/2026-08-19-sessions-portal/requirements.md#FR-08
最近确认：6453d9ca0

## FR-unmapped-559 新建会话表单新增工作区选择器
变更：2026-08-19-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-19-sessions-workspace-selector/requirements.md#FR-01
最近确认：b0f2a115c

## FR-unmapped-560 选工作区后自动联动机器选择器
变更：2026-08-19-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-19-sessions-workspace-selector/requirements.md#FR-02
最近确认：b0f2a115c

## FR-unmapped-561 选工作区后表单显示上下文提示
变更：2026-08-19-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-19-sessions-workspace-selector/requirements.md#FR-03
最近确认：b0f2a115c

## FR-unmapped-562 提交体携带 workspace_id
变更：2026-08-19-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-19-sessions-workspace-selector/requirements.md#FR-04
最近确认：b0f2a115c

## FR-unmapped-563 后端 workspace 归属校验
变更：2026-08-19-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-19-sessions-workspace-selector/requirements.md#FR-05
最近确认：b0f2a115c

## FR-unmapped-564 NewSessionFormValues 增加 workspaceId 字段
变更：2026-08-19-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-19-sessions-workspace-selector/requirements.md#FR-06
最近确认：b0f2a115c

## FR-unmapped-565 主题注册表与 brand 语义色阶
变更：2026-08-20-frontend-ai-native-style
状态：active
摘要：默认场景
依据决策：D-101@v1、D-003@v2
场景正文：
- 场景：默认场景 — Given `themes.ts` 定义 `blue`/`ai-native` 两套完整 ThemeDef（radius/shadow/font/spacing 共享）；When 前端构建；Then `:root` 注入 ai-native 变量值 + brand 阶紫阶值，`[data-theme="blue"]` 覆盖为旧蓝值 + brand 阶蓝阶值；
全文：.sillyspec/changes/archive/2026-08-20-frontend-ai-native-style/requirements.md#FR-01
最近确认：f7f73d86c

## FR-unmapped-566 主题切换与持久化
变更：2026-08-20-frontend-ai-native-style
状态：active
摘要：默认场景
依据决策：D-101@v1、D-102@v1
场景正文：
- 场景：默认场景 — Given 用户在任一页面；When 点击顶栏主题切换按钮 刷新页面 / 新开标签 localStorage 无值或值非法；Then `<html data-theme>` 与 antd token 同步切换，全站即时生效；`localStorage["sillyhub-theme"]` 写入
全文：.sillyspec/changes/archive/2026-08-20-frontend-ai-native-style/requirements.md#FR-02
最近确认：f7f73d86c

## FR-unmapped-567 antd 主题动态跟随
变更：2026-08-20-frontend-ai-native-style
状态：active
摘要：默认场景
依据决策：D-101@v1
场景正文：
- 场景：默认场景 — Given antd ConfigProvider token/components 改从 `useThemeStore` 当前主题取；When 切换主题；Then antd 组件（按钮/菜单选中/表格头/Tabs/Tag/Badge 等）跟随变色，无散落 hex
全文：.sillyspec/changes/archive/2026-08-20-frontend-ai-native-style/requirements.md#FR-03
最近确认：f7f73d86c

## FR-unmapped-568 蓝色清扫
变更：2026-08-20-frontend-ai-native-style
状态：active
摘要：默认场景
依据决策：D-003@v2
场景正文：
- 场景：默认场景 — Given 198 处 `bg/text/border-blue-*`（56 文件）与 17 处 hex 及登录页渐变、kanban PALETTE、globals.css；When 执行清扫；Then 品牌用途（含全部浅档）改 `brand-*` 类或主题引用；真信息蓝保留 blue 阶（逐一判断）；grep 复核模式 `bg-blue|text-blue|b
全文：.sillyspec/changes/archive/2026-08-20-frontend-ai-native-style/requirements.md#FR-04
最近确认：f7f73d86c

## FR-unmapped-569 会话页 AI 原生细节
变更：2026-08-20-frontend-ai-native-style
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given /sessions 聊天流（turn-timeline 等）；When SSE 流式输出进行中；Then 末尾显示闪烁光标；等待首个响应块时显示 typing 三点指示；上下文引用以 chip 样式展示（数据源=turn 快照 whoLine，无自然接入位则仅交付样
全文：.sillyspec/changes/archive/2026-08-20-frontend-ai-native-style/requirements.md#FR-05
最近确认：f7f73d86c

## FR-unmapped-570 blue 主题原样平移
变更：2026-08-20-frontend-ai-native-style
状态：active
摘要：默认场景
依据决策：D-102@v1、D-003@v2
场景正文：
- 场景：默认场景 — Given 用户切回 blue 主题；When 逐页核对核心页（工作区/会话/PPM 表格/登录/kanban）；Then 主色/选中态/表格头/卡片边框/按钮/徽章色与重构前同页一致（语义色位逐项核对，不要求像素 diff）
全文：.sillyspec/changes/archive/2026-08-20-frontend-ai-native-style/requirements.md#FR-06
最近确认：f7f73d86c

## FR-unmapped-571 新建会话表单新增工作区选择器
变更：2026-08-20-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-20-sessions-workspace-selector/requirements.md#FR-01
最近确认：dc34d63a9

## FR-unmapped-572 选工作区后自动联动机器选择器
变更：2026-08-20-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-20-sessions-workspace-selector/requirements.md#FR-02
最近确认：dc34d63a9

## FR-unmapped-573 选工作区后表单显示上下文提示
变更：2026-08-20-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-20-sessions-workspace-selector/requirements.md#FR-03
最近确认：dc34d63a9

## FR-unmapped-574 提交体携带 workspace_id
变更：2026-08-20-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-20-sessions-workspace-selector/requirements.md#FR-04
最近确认：dc34d63a9

## FR-unmapped-575 后端 workspace 归属校验
变更：2026-08-20-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-20-sessions-workspace-selector/requirements.md#FR-05
最近确认：dc34d63a9

## FR-unmapped-576 NewSessionFormValues 增加 workspaceId 字段
变更：2026-08-20-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-20-sessions-workspace-selector/requirements.md#FR-06
最近确认：dc34d63a9

## FR-unmapped-577 入口唯一化
变更：2026-08-20-workspace-nav-consolidate
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 概览页；Then 无快速入口宫格（QuickEntryGrid 退役删除，全仓引用清零）
全文：.sillyspec/changes/archive/2026-08-20-workspace-nav-consolidate/requirements.md#FR-01
最近确认：4c9827c38

## FR-unmapped-578 菜单全量与滑动
变更：2026-08-20-workspace-nav-consolidate
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 任一非 standalone 子页；Then 顶部菜单 13 项（概览/组件/变更/会话/文件/扫描文档/运行时/智能体档案/Skills/MCP/MCP 令牌/成员/方案文件），href 与原宫格/现菜单
全文：.sillyspec/changes/archive/2026-08-20-workspace-nav-consolidate/requirements.md#FR-02
最近确认：4c9827c38

## FR-unmapped-579 子页菜单补全
变更：2026-08-20-workspace-nav-consolidate
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given components / changes / changes-[cid] 等页；Then 渲染于 workspace layout 内含顶部菜单；topology 整屏页保留 standalone（无菜单，h-screen 零回归）
全文：.sillyspec/changes/archive/2026-08-20-workspace-nav-consolidate/requirements.md#FR-03
最近确认：4c9827c38

## FR-unmapped-580 头部横幅
变更：2026-08-20-workspace-overview-redesign
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 工作区详情页已加载；Then 顶部渲染渐变横幅（from-brand-700 via-brand-800 to-slate-950，blue 主题自动回旧蓝渐变），含工作区名（大字白）、状态
全文：.sillyspec/changes/archive/2026-08-20-workspace-overview-redesign/requirements.md#FR-01
最近确认：040fbc235

## FR-unmapped-581 统计卡行
变更：2026-08-20-workspace-overview-redesign
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 工作区详情页已加载；Then 统计四卡（项目组组件/进行中变更/已归档变更/运行时阶段）以图标+数值+标签形态渲染，图标软底 bg-brand-50 text-brand-600
全文：.sillyspec/changes/archive/2026-08-20-workspace-overview-redesign/requirements.md#FR-02
最近确认：040fbc235

## FR-unmapped-582 快速入口宫格
变更：2026-08-20-workspace-overview-redesign
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 工作区详情页已加载；Then 6 个入口（项目组件/变更中心/扫描文档/运行时/智能体档案/方案文件）以图标卡片宫格渲染（grid 3 列），lucide 图标+中文标签，href 与现状一
全文：.sillyspec/changes/archive/2026-08-20-workspace-overview-redesign/requirements.md#FR-03
最近确认：040fbc235

## FR-unmapped-583 分组信息区
变更：2026-08-20-workspace-overview-redesign
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 工作区详情页已加载；Then antd Collapse ghost 两组：「基本信息」默认展开（路径字段/类型/角色/用途/时间戳/编辑态/绑定守护进程区 WorkspaceDaemonS
全文：.sillyspec/changes/archive/2026-08-20-workspace-overview-redesign/requirements.md#FR-04
最近确认：040fbc235

## FR-unmapped-584 行为等价与测试
变更：2026-08-20-workspace-overview-redesign
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 重构完成；Then 所有数据 hook/编辑保存/绑定交互行为与重构前等价（九块映射表 10 行对账）
全文：.sillyspec/changes/archive/2026-08-20-workspace-overview-redesign/requirements.md#FR-05
最近确认：040fbc235

## FR-unmapped-585 统一错误条
变更：2026-08-20-workspace-subpages-style-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 任一子页面加载失败；Then 渲染公共 ErrorBanner（destructive 主题色+可选重试按钮），8 处（含 explorer:124-131 与 shared-daemon-
全文：.sillyspec/changes/archive/2026-08-20-workspace-subpages-style-unify/requirements.md#FR-01
最近确认：5959b30d9

## FR-unmapped-586 返回链接规范化
变更：2026-08-20-workspace-subpages-style-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given components/skills/mcp/mcp-tokens 页头；Then 无 title 内 hack；PageHeader actions 统一"← 工作区"链接，目标一致 /workspaces/${id}
全文：.sillyspec/changes/archive/2026-08-20-workspace-subpages-style-unify/requirements.md#FR-02
最近确认：5959b30d9

## FR-unmapped-587 空态与列表卡质感
变更：2026-08-20-workspace-subpages-style-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given skills/mcp/members/components 无数据；Then 渲染现成 EmptyState；skills/mcp 列表卡 SectionCard hover="lift"
全文：.sillyspec/changes/archive/2026-08-20-workspace-subpages-style-unify/requirements.md#FR-03
最近确认：5959b30d9

## FR-unmapped-588 语义色主题化
变更：2026-08-20-workspace-subpages-style-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given changes/explorer/mcp/mcp-tokens 的 tone 卡与提示文字；Then amber/emerald/red/blue 硬编码（5 处）改 warning/success/error/info 语义色+透明度修饰，双主题跟随
全文：.sillyspec/changes/archive/2026-08-20-workspace-subpages-style-unify/requirements.md#FR-04
最近确认：5959b30d9

## FR-unmapped-589 表格/按钮/文案规格统一
变更：2026-08-20-workspace-subpages-style-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given members 与 mcp-tokens 手写表、3 页 h-7 小按钮、members 英文文案；Then 两表表头规格逐字段一致（px-4 py-3 bg-muted/40/行 hover）；小按钮换 shadcn Button size=sm（components
全文：.sillyspec/changes/archive/2026-08-20-workspace-subpages-style-unify/requirements.md#FR-05
最近确认：5959b30d9

## FR-unmapped-590 容器与锚修正
变更：2026-08-20-workspace-subpages-style-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given sessions 右侧面板与 explorer 布局；Then session-section 自写容器换 SectionCard；explorer 高度锚 56px→64px、antd Button（2 处）换 shadc
全文：.sillyspec/changes/archive/2026-08-20-workspace-subpages-style-unify/requirements.md#FR-06
最近确认：5959b30d9

## FR-unmapped-591 可拖拽手柄
变更：2026-08-21-table-column-resize
状态：active
摘要：默认场景
依据决策：D-502@v2
场景正文：
- 场景：默认场景 — Given DataTable 渲染的表格；Then `typeof width === "number"` 的列表头右缘渲染拖拽手柄（col 光标/hover 主题高亮）；无 width 或 string wid
全文：.sillyspec/changes/archive/2026-08-21-table-column-resize/requirements.md#FR-01
最近确认：16c8fa5dc

## FR-unmapped-592 拖拽不误触排序
变更：2026-08-21-table-column-resize
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 排序列的表头手柄；When 按住手柄拖拽；Then 不触发 onChange(sorter)；3px 内微动视为点击不误判拖拽
全文：.sillyspec/changes/archive/2026-08-21-table-column-resize/requirements.md#FR-02
最近确认：16c8fa5dc

## FR-unmapped-593 PPM 资源表覆盖
变更：2026-08-21-table-column-resize
状态：active
摘要：默认场景
依据决策：D-502@v2
场景正文：
- 场景：默认场景 — Given PpmResourceTable（projects/customers/project-stakeholders）；Then 业务列经默认宽兜底（类型映射 110-200px）全部可拖
全文：.sillyspec/changes/archive/2026-08-21-table-column-resize/requirements.md#FR-03
最近确认：16c8fa5dc

## FR-unmapped-594 受控回调接口
变更：2026-08-21-table-column-resize
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 页面传 onColumnsResize；Then 拖拽结束回调 { [dataIndex]: width }；不传=纯本地拖拽
全文：.sillyspec/changes/archive/2026-08-21-table-column-resize/requirements.md#FR-04
最近确认：16c8fa5dc

## FR-unmapped-595 适配层删除与消费方直迁
变更：2026-08-22-session-panel-unify
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given `interactive-session-panel.tsx`（127 行适配层）存在且被 4 个渲染消费方引用；When 执行本变更；Then 该文件整文件删除；4 消费方（runtime-session-dialog.tsx...:338 /
全文：.sillyspec/changes/archive/2026-08-22-session-panel-unify/requirements.md#FR-01
最近确认：4d7adc1d9

## FR-unmapped-596 类型 import 归位
变更：2026-08-22-session-panel-unify
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 4 消费方从适配层 import 5 个类型（SessionProcessItem / SessionToolEvent /；When 适配层删除；Then import 路径改指 `@/components/daemon/turn-timeline`（5 类型已全部导出于
全文：.sillyspec/changes/archive/2026-08-22-session-panel-unify/requirements.md#FR-02
最近确认：4d7adc1d9

## FR-unmapped-597 dialog 分支 chrome 基元 antd 化
变更：2026-08-22-session-panel-unify
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given session-panel.tsx dialog 分支含 5 处 shadcn 基元（UiButton :2334/2352/2398/2409、；When 统一 antd；Then UiButton×4 → antd Button（新建/团队分析默认 32px；打断 size="small" 24px；
全文：.sillyspec/changes/archive/2026-08-22-session-panel-unify/requirements.md#FR-03
最近确认：4d7adc1d9

## FR-unmapped-598 TurnStatusBadge antd 化
变更：2026-08-22-session-panel-unify
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given frontend/src/components/daemon/turn-timeline.tsx:930-983 TurnStatusBadge 为纯样式 span 胶囊（两模式共用）；When 统一 antd；Then 内部渲染改 antd Badge status：running/interrupting→processing、
全文：.sillyspec/changes/archive/2026-08-22-session-panel-unify/requirements.md#FR-04
最近确认：4d7adc1d9

## FR-unmapped-599 SessionInputBar 基元 antd 化
变更：2026-08-22-session-panel-unify
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given session-input-bar.tsx 含 2 处 shadcn Button（发送 :196、📎 ghost :169）；When 统一 antd；Then 发送 → antd Button type="primary"；📎 → antd Button type="text"；
全文：.sillyspec/changes/archive/2026-08-22-session-panel-unify/requirements.md#FR-05
最近确认：4d7adc1d9

## FR-unmapped-600 测试迁移与守护
变更：2026-08-22-session-panel-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 3 套 ISP 测试（interactive-session-panel{,-offline,-changeid}.test.tsx，；When 适配层删除；Then 迁移为 `session-panel-dialog{,-offline,-changeid}.test.tsx` 直测
全文：.sillyspec/changes/archive/2026-08-22-session-panel-unify/requirements.md#FR-06
最近确认：4d7adc1d9

## FR-unmapped-601 主题铁律合规
变更：2026-08-22-session-panel-unify
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given FRONTEND_PAGE_STYLE §0.5 双主题系统（blue/ai-native）；When 本次 antd 化；Then 新增代码零硬编码 hex；antd 组件色不写 style 覆盖（差异走 ConfigProvider
全文：.sillyspec/changes/archive/2026-08-22-session-panel-unify/requirements.md#FR-07
最近确认：4d7adc1d9

## FR-unmapped-602 团队变更顺序协调
变更：2026-08-22-session-panel-unify
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given team-unify task-11 allowed_paths 与本变更正面重叠；When 本变更执行；Then 硬前置门：本变更先于 task-11 执行并合入 main；执行期若发现 task-11 已
全文：.sillyspec/changes/archive/2026-08-22-session-panel-unify/requirements.md#FR-08
最近确认：4d7adc1d9

## FR-unmapped-603 注释锚点校正
变更：2026-08-22-session-panel-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 3 个文件注释含适配层历史锚点（frontend/src/components/ask-user-dialog-card.tsx:15、；When 适配层删除；Then 注释中指向已删文件的行号锚点按 CLAUDE.md 规则 18 校正（仅注释零逻辑改动）。
全文：.sillyspec/changes/archive/2026-08-22-session-panel-unify/requirements.md#FR-09
最近确认：4d7adc1d9

## FR-unmapped-604 共享门户组件
变更：2026-08-22-workspace-sessions-portal
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given /sessions 页现有外壳（列表+两态+page 面板+页级数据）；When 提取为 SessionsPortal；Then 组件接受可选 scope（WorkspaceScope{kind,workspaceId} | ChangeScope{kind,workspaceId,cha
全文：.sillyspec/changes/archive/2026-08-22-workspace-sessions-portal/requirements.md#FR-01
最近确认：3f7192561

## FR-unmapped-605 工作区入口
变更：2026-08-22-workspace-sessions-portal
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given /workspaces/[id]/sessions 页；When 本变更后；Then 整页渲染 `<SessionsPortal scope={kind:workspace, workspaceId}>`——列表仅该工作区、创建锁定绑定 work
全文：.sillyspec/changes/archive/2026-08-22-workspace-sessions-portal/requirements.md#FR-02
最近确认：3f7192561

## FR-unmapped-606 变更级入口
变更：2026-08-22-workspace-sessions-portal
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 变更详情侧边窄卡与无专属会话页；When 本变更后；Then 侧卡变入口（listChangeSessions 仅本人过滤取前 3 条预览 + 打开工作台按钮）；新路由 /workspaces/[id]/changes/[
全文：.sillyspec/changes/archive/2026-08-22-workspace-sessions-portal/requirements.md#FR-03
最近确认：3f7192561

## FR-unmapped-607 列表 scope 化
变更：2026-08-22-workspace-sessions-portal
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given SessionListPanel 现仅支持全局真分页；When 加可选 scope；Then workspace/change 模式切 listWorkspaceAgentSessions(include_ended)/listChangeSession
全文：.sillyspec/changes/archive/2026-08-22-workspace-sessions-portal/requirements.md#FR-04
最近确认：3f7192561

## FR-unmapped-608 深链恢复
变更：2026-08-22-workspace-sessions-portal
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 旧工作区页有 ?session= 初始选中；When 门户化后；Then SessionsPortal 统一支持 ?session=<id> 挂载时解析初始选中（无效/无参静默忽略），三入口通用；变更入口卡直达经此链路。
全文：.sillyspec/changes/archive/2026-08-22-workspace-sessions-portal/requirements.md#FR-05
最近确认：3f7192561

## FR-unmapped-609 退役清理
变更：2026-08-22-workspace-sessions-portal
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given workspace-session-section 与 change-session-section 两组件及其测试；When 消费面重组完成后；Then 两组件与两测试文件删除，全仓无 dangling import；语义迁移四项（仅本人过滤/创建绑定/ended 恢复/深链）均有新测试落点；ended 会话恢复
全文：.sillyspec/changes/archive/2026-08-22-workspace-sessions-portal/requirements.md#FR-06
最近确认：3f7192561

## FR-unmapped-610 回归与实证
变更：2026-08-22-workspace-sessions-portal
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 全部改动；When 收尾；Then 全量 vitest/tsc/lint 零失败；受影响测试（sessions 页 18 用例、list-panel、new-session-form、change
全文：.sillyspec/changes/archive/2026-08-22-workspace-sessions-portal/requirements.md#FR-07
最近确认：3f7192561

## FR-unmapped-611 Bash 命令实时反馈
变更：2026-08-24-platform-session-feedback-fix
状态：active
摘要：（无场景名）
依据决策：D-002@v1
全文：.sillyspec/changes/archive/2026-08-24-platform-session-feedback-fix/requirements.md#FR-01
最近确认：df0da49ed

## FR-unmapped-612 Plan 模式强确认
变更：2026-08-24-platform-session-feedback-fix
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-002@v1
全文：.sillyspec/changes/archive/2026-08-24-platform-session-feedback-fix/requirements.md#FR-02
最近确认：df0da49ed

## FR-unmapped-613 后台 Agent 任务进度可见
变更：2026-08-24-platform-session-feedback-fix
状态：active
摘要：（无场景名）
依据决策：D-002@v1
全文：.sillyspec/changes/archive/2026-08-24-platform-session-feedback-fix/requirements.md#FR-03
最近确认：df0da49ed

## FR-unmapped-614 AskUser 弹窗可最小化
变更：2026-08-24-platform-session-feedback-fix
状态：active
摘要：（无场景名）
依据决策：D-003@v1
全文：.sillyspec/changes/archive/2026-08-24-platform-session-feedback-fix/requirements.md#FR-04
最近确认：df0da49ed

## FR-unmapped-615 Git 日志列表与泳道拓扑展示
变更：2026-08-25-workspace-git-log
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 工作区为 git 仓库（git_mode=git）且用户已绑定可用 daemon 仓库存在分叉与合并；When 用户打开「Git 日志」tab 渲染泳道；Then 显示泳道 SVG（commit 圆点按 lane 取色板、HEAD 虚线环）+ 提交列表（message/作者/短哈希/refs 标签/时间），默认全分支（gi
全文：.sillyspec/changes/archive/2026-08-25-workspace-git-log/requirements.md#FR-01
最近确认：5d86ddb17

## FR-unmapped-616 提交详情与变更文件目录树
变更：2026-08-25-workspace-git-log
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 用户点击列表某行；When 打开右侧 Drawer；Then 展示哈希/作者/时间/message 全文 + 变更文件**目录树**（--numstat 平铺路径按 / 前端聚合，目录节点聚合 +x/-y，叶子显示单文件增
全文：.sillyspec/changes/archive/2026-08-25-workspace-git-log/requirements.md#FR-02
最近确认：5d86ddb17

## FR-unmapped-617 文件级 diff 查看
变更：2026-08-25-workspace-git-log
状态：active
摘要：默认场景
依据决策：D-003@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given Drawer 文件树中某叶子文件被点击；When 按需请求该文件 diff（此前不请求）；Then 展示 unified diff（+绿/-红语义 token，行号列，hunk 头）；binary 文件显示「二进制文件」提示；超 64KB 截断并标记 trun
全文：.sillyspec/changes/archive/2026-08-25-workspace-git-log/requirements.md#FR-03
最近确认：5d86ddb17

## FR-unmapped-618 分支与作者过滤
变更：2026-08-25-workspace-git-log
状态：active
摘要：默认场景
依据决策：D-005@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 工具栏分支下拉（数据源=响应 top-level branches[]，git_refs 全量）与作者文本输入框；When 用户设定过滤并触发；Then 请求携带 branch/author 参数（git log <branch> 替代 --all；--author 独立 argv），结果集更新；过滤后结果集外的
全文：.sillyspec/changes/archive/2026-08-25-workspace-git-log/requirements.md#FR-04
最近确认：5d86ddb17

## FR-unmapped-619 异常与降级形态
变更：2026-08-25-workspace-git-log
状态：active
摘要：默认场景
依据决策：D-002@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 工作区非 git 仓库（probe=direct） daemon 离线 / RPC 超时 / 旧版 daemon（method_not_found）/ 用户未绑
全文：.sillyspec/changes/archive/2026-08-25-workspace-git-log/requirements.md#FR-05
最近确认：5d86ddb17

## FR-unmapped-620 分页与性能
变更：2026-08-25-workspace-git-log
状态：active
摘要：默认场景
依据决策：D-004@v1、D-005@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 大仓库历史 长列表滚动；When 用户翻页（skip/limit，默认 100/页）；Then daemon 每页从 HEAD 拉 skip+limit+lookahead(50) 条，backend 全前缀确定性 lane 计算只返回窗口——任意页 la
全文：.sillyspec/changes/archive/2026-08-25-workspace-git-log/requirements.md#FR-06
最近确认：5d86ddb17

## FR-unmapped-621 只读与参数安全
变更：2026-08-25-workspace-git-log
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 全部后端链路 sha/branch/author/path 输入；Then 只使用只读 git 子命令（log/for-each-ref/show/rev-parse），无 DB 写入，无状态迁移 sha 匹配 ^[0-9a-fA-F]
全文：.sillyspec/changes/archive/2026-08-25-workspace-git-log/requirements.md#FR-07
最近确认：5d86ddb17

## FR-unmapped-622 三主题视觉合规
变更：2026-08-25-workspace-git-log
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given blue / ai-native / dark 任一主题；When 打开 Git 日志页；Then 颜色全部走 themes.ts 消费链（CSS 变量 / brand-* / semantic token），泳道色板三主题各配亮暗档；tab 内无 md: 等
全文：.sillyspec/changes/archive/2026-08-25-workspace-git-log/requirements.md#FR-08
最近确认：5d86ddb17

## FR-unmapped-623 工作区入口解除门禁
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 已登录用户在 `/m/workspaces` 列表页看到工作区卡片；When 点击卡片；Then 导航到 `/m/workspaces/[id]`（经主页 redirect 落到变更列表），不再提示"请在电脑端打开"
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-01
最近确认：976a21965

## FR-unmapped-624 工作区主页与双 Tab 导航
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户位于 `/m/workspaces/[id]/changes` 或 `/m/workspaces/[id]/sessions`；When 顶栏段控切换「变更中心 / 会话」；Then 路由跳转到对应列表页（真实路由，非 query）；顶栏显示返回箭头（→ /m/workspaces）与工作区名
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-02
最近确认：976a21965

## FR-unmapped-625 变更列表（三 Tab + 搜索 + 筛选）
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户位于 `/m/workspaces/[id]/changes`；When 切换 进行中/已归档/快速修复 Tab 输入关键词或打开筛选抽屉（阶段/只看待我处理）后应用 点击变更卡片；Then 列表与计数徽标（["changesTabTotals"]）刷新；进行中列表按 changesRefetchInterval 语义智能轮询 列表按条件过滤（que
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-03
最近确认：976a21965

## FR-unmapped-626 变更详情与审批操作
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户位于变更详情页；When 点击 通过/驳回 点击文档 点击关联会话卡；Then 可见：阶段步骤条、审批操作卡（有待办时默认展开）、规范文档列表、阶段时间线、执行日志（折叠）、关联会话卡、任务区桌面引导条 调 submitStageRevie
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-04
最近确认：976a21965

## FR-unmapped-627 快速修复（quicklog）Tab
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户在变更列表切到「快速修复」Tab；When 点击条目；Then 展示 quicklog 卡片列表（listQuicklogEntries + quicklogPollInterval 轮询语义） MobileDetailSh
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-05
最近确认：976a21965

## FR-unmapped-628 会话列表
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户位于 `/m/workspaces/[id]/sessions`；When 点击会话卡片 通过卡片菜单执行 删除/归档/取消归档；Then 展示按机器分组的会话卡片（在线/离线分组、状态 Tab 全部/进行中/已归档）；数据用 listAgentSessions + workspace_id，que
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-06
最近确认：976a21965

## FR-unmapped-629 会话对话（SessionPanel 第四宿主，完整内核）
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户位于 `/m/workspaces/[id]/sessions/[sid]`；When 会话被切换（路由 sid 变化）；Then 直接渲染 SessionPanel(mode="page", key=sid)，具备桌面同等全部能力：SSE 流式对话、发消息、中断、结束/重开、消息队列、子代
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-07
最近确认：976a21965

## FR-unmapped-630 新建会话（两步浮层移动化）
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户在会话列表点 ＋；When 依次选择机器、智能体（PreSessionPicker variant="bottomSheet" 底部抽屉两步）；Then 进入预会话态（SessionPanel sessionId=null + preContext），首句发送 createSession 成功后切真会话路由
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-08
最近确认：976a21965

## FR-unmapped-631 布局层级（列表 vs 钻取）
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户位于列表页（changes / sessions）；Then 保留底部 5 Tab（平台切换高亮）；位于钻取页（changes/[cid]、sessions/[sid]） 隐藏底部 Tab，页面自渲染返回顶栏（m/layo
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-09
最近确认：976a21965

## FR-unmapped-632 深链兜底
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 手机 UA 访问桌面专属门户 URL `/workspaces/[id]/changes/[cid]/sessions` 或 `/workspaces/[id]；Then redirect 到 `/m/workspaces/[id]/sessions`（不落 404）
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-10
最近确认：976a21965

## FR-unmapped-633 桌面零回归
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 桌面 UA 或未传 variant 的既有调用点；Then SessionPanel/PreSessionPicker 行为与改动前完全一致；`(dashboard)/**` 全部既有测试保持绿色；m/ 既有页面（log
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-11
最近确认：976a21965

## FR-unmapped-634 Office 高保真预览
变更：2026-08-26-onlyoffice-preview
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 预览的文件为 docx/xlsx/pptx/doc/xls/ppt 且 DS 已启用；When 打开预览窗；Then 经 DS 呈现高保真只读视图（样式/列宽/合并还原）；pdf/图片/md 走现有渲染器不变
全文：.sillyspec/changes/archive/2026-08-26-onlyoffice-preview/requirements.md#FR-01
最近确认：3f5e39780

## FR-unmapped-635 降级链
变更：2026-08-26-onlyoffice-preview
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given DS 未启用（config 503）、api.js 加载失败或 DocEditor 初始化出错；When office 文件预览；Then 自动回落本地渲染器（docx→docx-preview；xlsx/xls→SheetJS；ppt/pptx→fallback 下载），
全文：.sillyspec/changes/archive/2026-08-26-onlyoffice-preview/requirements.md#FR-02
最近确认：3f5e39780

## FR-unmapped-636 一次性文件令牌
变更：2026-08-26-onlyoffice-preview
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given DS 需拉取文件（无 JWT 能力）；When backend 签发 file token；Then token HS256 签名、TTL 5 分钟、redis jti 一次性消费（重放 410）、绑定 object_key；
全文：.sillyspec/changes/archive/2026-08-26-onlyoffice-preview/requirements.md#FR-03
最近确认：3f5e39780

## FR-unmapped-637 归属校验
变更：2026-08-26-onlyoffice-preview
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户请求 office-config（source=session_attachment|file, id）；When 附件/文件不属于该用户或不存在；Then 404（资源隐藏语义，与既有端点一致）
全文：.sillyspec/changes/archive/2026-08-26-onlyoffice-preview/requirements.md#FR-04
最近确认：3f5e39780

## FR-unmapped-638 前端零构建配置
变更：2026-08-26-onlyoffice-preview
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 局域网 IP/端口变化；When 运维仅改 .env 的 ONLYOFFICE_PUBLIC_URL 并重启 backend；Then 前端无需重新构建即用新地址（config 端点下发 ds_url）
全文：.sillyspec/changes/archive/2026-08-26-onlyoffice-preview/requirements.md#FR-05
最近确认：3f5e39780

## FR-unmapped-639 部署门禁
变更：2026-08-26-onlyoffice-preview
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Docker VM Total Memory < 6GB；When 尝试部署 onlyoffice 服务；Then 验证步骤明确拒绝并提示先调 Docker Desktop 内存（文档+检查命令）
全文：.sillyspec/changes/archive/2026-08-26-onlyoffice-preview/requirements.md#FR-06
最近确认：3f5e39780

## FR-unmapped-640 Git 状态数据端点
变更：2026-08-26-workspace-git-status
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 工作区为 git 仓库且用户已绑定在线 daemon；When GET /api/workspaces/{wid}/git-log/status；Then 返回 branch/detached/upstream/ahead/behind/dirty{files_changed,additions,deletions
全文：.sillyspec/changes/archive/2026-08-26-workspace-git-status/requirements.md#FR-01
最近确认：69bf8e3c5

## FR-unmapped-641 自动 fetch 与降级
变更：2026-08-26-workspace-git-status
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 打开任一挂载页；When useGitLogStatus 触发（staleTime 60s，两页共享缓存）；Then daemon 侧先 git fetch --quiet（15s 超时）；成功→ahead/behind 为新鲜值且 fetch.performed=true；超
全文：.sillyspec/changes/archive/2026-08-26-workspace-git-status/requirements.md#FR-02
最近确认：69bf8e3c5

## FR-unmapped-642 未提交改动统计
变更：2026-08-26-workspace-git-status
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 工作区有未提交改动；When 采集 git diff HEAD --numstat --no-renames；Then additions/deletions 为行数汇总（staged+unstaged 合并），files_changed ≡ numstat 行数（单源；inde
全文：.sillyspec/changes/archive/2026-08-26-workspace-git-status/requirements.md#FR-03
最近确认：69bf8e3c5

## FR-unmapped-643 状态条双形态展示
变更：2026-08-26-workspace-git-status
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given Git 日志页打开 会话页打开且 scope.kind=workspace 加载中 / fetch 失败；When 状态条渲染（variant=full） 状态条渲染（variant=compact，PageHeader actions 槽）；Then 分支徽标（⎇）+ 跟踪名 + ↑N 未推送 + ↓N 远程新提交 + 改动 +A/−D（N 文件）+ 未跟踪 N + "已同步 · HH:MM" 分支/↑/↓/
全文：.sillyspec/changes/archive/2026-08-26-workspace-git-status/requirements.md#FR-04
最近确认：69bf8e3c5

## FR-unmapped-644 边界形态
变更：2026-08-26-workspace-git-status
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 无 upstream（本地新分支）→ 无 ↑↓（ahead/behind null） detached HEAD → 分支徽标显示 head_short + "
全文：.sillyspec/changes/archive/2026-08-26-workspace-git-status/requirements.md#FR-05
最近确认：69bf8e3c5

## FR-unmapped-645 只读与安全
变更：2026-08-26-workspace-git-status
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 全链路；Then 本地零写操作（fetch 为网络同步）；root 唯一入参（零新增注入面）；全部 argv 独立经 execFile；无 DB 写入
全文：.sillyspec/changes/archive/2026-08-26-workspace-git-status/requirements.md#FR-06
最近确认：69bf8e3c5

## FR-unmapped-646 主题与缓存合规
变更：2026-08-26-workspace-git-status
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 三主题任一；Then 状态条颜色全走 themes.ts 消费链（brand 徽标/accent ↑/warning ↓与黄条/success +/error −）零硬编码 hex；
全文：.sillyspec/changes/archive/2026-08-26-workspace-git-status/requirements.md#FR-07
最近确认：69bf8e3c5

## FR-unmapped-647 daemon 消费 SDK 任务生命周期消息（D-001@v1）
变更：2026-08-27-background-subagent-progress
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When daemon session-manager `_onMessage` 识别到上述 subtype；Then 注册/更新/注销会话级任务表，并发出对应 `agent_task_status` 事件：started→running（含 task_id/tool_use_i
全文：.sillyspec/changes/archive/2026-08-27-background-subagent-progress/requirements.md#FR-01
最近确认：c7f48562c

## FR-unmapped-648 异步启动回执解析兜底（D-001@v1）
变更：2026-08-27-background-subagent-progress
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Task/Agent 工具的 tool_result 文本含 "Async agent launched successfully" 与 agentId（CLI；When daemon user tool_result 分支解析命中；Then 以该 tool_use_id 注册任务表并发出 `agent_task_status {status:'running', async:true, task_i
全文：.sillyspec/changes/archive/2026-08-27-background-subagent-progress/requirements.md#FR-02
最近确认：c7f48562c

## FR-unmapped-649 [TASK_*] 持久日志行（D-002@v1）
变更：2026-08-27-background-subagent-progress
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given FR-01/02 的任一生命周期节点触发；When daemon 落库通道写入
全文：.sillyspec/changes/archive/2026-08-27-background-subagent-progress/requirements.md#FR-03
最近确认：c7f48562c

## FR-unmapped-650 backend 事件 schema 扩展与透传（D-001@v1）
变更：2026-08-27-background-subagent-progress
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 发出扩展字段的 agent_task_status；When backend `notify_agent_task_status` 接收并发布到 Redis `agent_session:{id}`；Then 新字段（status 终态值/tool_use_id/summary/last_tool_name/elapsed_ms/total_tokens/tool_u
全文：.sillyspec/changes/archive/2026-08-27-background-subagent-progress/requirements.md#FR-04
最近确认：c7f48562c

## FR-unmapped-651 子代理日志跨轮归位（D-003@v1）
变更：2026-08-27-background-subagent-progress
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given submit_messages 收到带 parent_tool_use_id 的日志行，且该 tool_use 属于早前已完成的派发 run；When backend 落库；Then 行的 run_id 归写为派发 run（进程内 LRU + tool_call 行冷启动反查）；查不到映射时保持现状不报错；历史行不迁移。
全文：.sillyspec/changes/archive/2026-08-27-background-subagent-progress/requirements.md#FR-05
最近确认：c7f48562c

## FR-unmapped-652 后台卡片全生命周期展示（D-005@v1）
变更：2026-08-27-background-subagent-progress
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 头部"后台"下拉中的 AgentTaskCard 处于 running；Then 显示"正在做什么"（last_tool_name+summary）、走秒计时（本地 tick + elapsed_ms 校准）、tokens/工具次数、最后活跃
全文：.sillyspec/changes/archive/2026-08-27-background-subagent-progress/requirements.md#FR-06
最近确认：c7f48562c

## FR-unmapped-653 子代理目录与会话块异步感知（D-005@v1）
变更：2026-08-27-background-subagent-progress
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 子代理块/目录行对应异步派发（async 标记或 [TASK_*] 元数据）；When tool_result（启动回执）到达；Then 块状态保持"后台运行中"且时长走秒（不判 done/不用往返差值）；终态由 TASK_NOTIFICATION 驱动显示服务端真实时长；前台（阻塞式）子代理状态
全文：.sillyspec/changes/archive/2026-08-27-background-subagent-progress/requirements.md#FR-07
最近确认：c7f48562c

## FR-unmapped-654 空 prompt 注入防御（D-004@v1）
变更：2026-08-27-background-subagent-progress
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 调用方 POST /inject 且 prompt strip 后为空；When backend `inject_session` 处理；Then 返回 422（中文文案，不创建 AgentRun/不写 user_input 行）；前端发送按钮对空内容 disabled。
全文：.sillyspec/changes/archive/2026-08-27-background-subagent-progress/requirements.md#FR-08
最近确认：c7f48562c

## FR-unmapped-655 spike 验证 SDK 运行时发射（R-01）
变更：2026-08-27-background-subagent-progress
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本地 daemon + 后台 Agent 会话；When session-manager 记录 task_* 到达情况；Then 验证结论（发/不发、task_progress 频率）回填 design.md §10，确定兜底路径权重与节流参数。
全文：.sillyspec/changes/archive/2026-08-27-background-subagent-progress/requirements.md#FR-09
最近确认：c7f48562c

## FR-unmapped-656 Playwright 基础设施
变更：2026-08-29-frontend-e2e-playwright
状态：active
摘要：默认场景
依据决策：D-001@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given frontend 目录存在 @playwright/test devDep；When 新增 `frontend/playwright.config.ts`（chromium 单浏览器 / workers:1 / timeout 60s / ret；Then `pnpm test:e2e` 可发现并执行 `frontend/e2e/*.spec.ts`，不配置 webServer（本机手动前置）
全文：.sillyspec/changes/archive/2026-08-29-frontend-e2e-playwright/requirements.md#FR-01
最近确认：0ea257289

## FR-unmapped-657 测试身份与数据准备
变更：2026-08-29-frontend-e2e-playwright
状态：active
摘要：默认场景
依据决策：D-002@v2
场景正文：
- 场景：默认场景 — Given bootstrap 平台管理员凭据（E2E_BOOTSTRAP_EMAIL/PASSWORD，本机 backend/.env 或 CI env）；When 每次测试运行；Then admin 先 `POST /api/admin/roles` 幂等创建角色（key=`e2e_smoke_<runid>` 下划线、permission_ke
全文：.sillyspec/changes/archive/2026-08-29-frontend-e2e-playwright/requirements.md#FR-02
最近确认：0ea257289

## FR-unmapped-658 API 登录与会话注入
变更：2026-08-29-frontend-e2e-playwright
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given FR-02 创建的冒烟用户；When TestApiClient 调 `POST /api/auth/login`（首登无 captcha）+ `GET /api/auth/me`；Then `page.addInitScript` 注入 `localStorage["multi-agent-platform.session"]`，格式 `{stat
全文：.sillyspec/changes/archive/2026-08-29-frontend-e2e-playwright/requirements.md#FR-03
最近确认：0ea257289

## FR-unmapped-659 真实 UI 登录链路用例（auth.spec）
变更：2026-08-29-frontend-e2e-playwright
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given dev 环境前后端在跑；When 执行 4 用例：A1 未登录访问 /workspaces 重定向 /login；A2 表单登录成功跳 /workspaces 且 PageHeader/侧边栏可；Then 全部断言通过；等待策略一律关键元素/文本，禁用 networkidle（SSE 长连接）
全文：.sillyspec/changes/archive/2026-08-29-frontend-e2e-playwright/requirements.md#FR-04
最近确认：0ea257289

## FR-unmapped-660 导航冒烟用例（navigation.spec）
变更：2026-08-29-frontend-e2e-playwright
状态：active
摘要：默认场景
依据决策：D-002@v2
场景正文：
- 场景：默认场景 — Given FR-03 注入登录的冒烟用户（挂 workspace:read）；When 执行 4 用例：N1 /workspaces 列表页渲染（PageHeader「选择工作区」/列表容器）；N2 侧边栏→智能体会话 /sessions；N3 侧；Then 全部断言通过
全文：.sillyspec/changes/archive/2026-08-29-frontend-e2e-playwright/requirements.md#FR-05
最近确认：0ea257289

## FR-unmapped-661 本机运行文档与凭据卫生
变更：2026-08-29-frontend-e2e-playwright
状态：active
摘要：默认场景
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — Given 开发者首次使用 e2e 体系；When 阅读 `frontend/e2e/README.md`；Then 可按文档完成前置（dev compose 起 pg/redis、backend/.env 含 bootstrap admin + `AUTH_LOGIN_RAT
全文：.sillyspec/changes/archive/2026-08-29-frontend-e2e-playwright/requirements.md#FR-06
最近确认：0ea257289

## FR-unmapped-662 CI e2e job
变更：2026-08-29-frontend-e2e-playwright
状态：active
摘要：默认场景
依据决策：D-004@v1、D-007@v1、D-008@v1
场景正文：
- 场景：默认场景 — Given push/PR 触发 paths frontend/**（或手动 workflow_dispatch）；When e2e-ci.yml 执行：services postgres:16 + redis:7 → uv sync → uvicorn（env 含 AUTH_LOGI；Then job 在 20min 超时内全绿；失败时 playwright-report/ 与 test-results/ 上传为 artifact
全文：.sillyspec/changes/archive/2026-08-29-frontend-e2e-playwright/requirements.md#FR-07
最近确认：0ea257289

## FR-unmapped-663 双测试栈隔离与类型覆盖
变更：2026-08-29-frontend-e2e-playwright
状态：active
摘要：默认场景
依据决策：D-009@v1
场景正文：
- 场景：默认场景 — Given vitest.config.ts 无 include 配置（默认必扫 e2e/*.spec.ts）；Then `pnpm test` 不收集 e2e 用例（157 个现有测试不受影响）；`pnpm typecheck` 覆盖 e2e 代码
全文：.sillyspec/changes/archive/2026-08-29-frontend-e2e-playwright/requirements.md#FR-08
最近确认：0ea257289

## FR-unmapped-664 依赖清理
变更：2026-08-29-frontend-e2e-playwright
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given frontend devDependencies 含零引用的 puppeteer；When 移除 puppeteer 并更新 pnpm-lock.yaml（与 package.json 同 commit）；Then 依赖树无 puppeteer，`pnpm install --frozen-lockfile` 一致，@playwright/test 保留
全文：.sillyspec/changes/archive/2026-08-29-frontend-e2e-playwright/requirements.md#FR-09
最近确认：0ea257289

## FR-unmapped-665 sillyspec 版本显示
变更：2026-08-31-machine-sillyspec-version
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 机器在线且 daemon 已探测到本机 sillyspec 版本；When 用户查看机器列表；Then 机器卡 meta 行显示 `sillyspec <版本>` 徽标：已最新=常色；落后=橙色「当前 → 最新」+「有新版本」小标签；未安装=红色「未安装」
全文：.sillyspec/changes/archive/2026-08-31-machine-sillyspec-version/requirements.md#FR-01
最近确认：26abd5305

## FR-unmapped-666 手动远程升级
变更：2026-08-31-machine-sillyspec-version
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 机器在线；When 用户点击「升级 sillyspec」（未安装时文案为「安装 sillyspec」，失败后为「重试升级」）；Then 后端校验归属后经 WS `daemon:sillyspec_update` 触发 daemon 执行 `npm install -g sillyspec@lat
全文：.sillyspec/changes/archive/2026-08-31-machine-sillyspec-version/requirements.md#FR-02
最近确认：26abd5305

## FR-unmapped-667 升级过程可见
变更：2026-08-31-machine-sillyspec-version
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 升级已触发；When daemon 状态流转；Then 机器卡横幅按 `sillyspec_update.state` 显示四态：running=info「正在升级（from → to）」、deferred=warn
全文：.sillyspec/changes/archive/2026-08-31-machine-sillyspec-version/requirements.md#FR-03
最近确认：26abd5305

## FR-unmapped-668 运行期自动定期升级
变更：2026-08-31-machine-sillyspec-version
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 运行中且 `sillyspec_update_interval_sec` > 0（默认 3600）；When 定时循环发现本机落后于 npm 最新版或未安装；Then 自动触发升级（trigger=auto），机器忙时推迟不打断进行中的会话/任务（复用 `_isBusyForUpdate` 三臂忙判定）
全文：.sillyspec/changes/archive/2026-08-31-machine-sillyspec-version/requirements.md#FR-04
最近确认：26abd5305

## FR-unmapped-669 数据链与兼容
变更：2026-08-31-machine-sillyspec-version
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 与 backend 版本可能不齐；Then register 对 sillyspec_version/latest 直接落值（含 null）；心跳对二者非 None 才覆盖、对 sillyspec_upd
全文：.sillyspec/changes/archive/2026-08-31-machine-sillyspec-version/requirements.md#FR-05
最近确认：26abd5305

## FR-unmapped-670 统一 current_stage 枚举
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Change 模型的 current_stage 字段；When 系统初始化；Then current_stage 枚举为：draft, scan, brainstorm, propose, plan, execute, verify, quick
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-671 新增 human_gate 字段
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Change 模型；When 执行 DB 迁移；Then Change 表新增 human_gate 字段（VARCHAR(50), DEFAULT 'none'）
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-672 旧数据迁移
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 已有 Change 记录的 current_stage 为 rework_required 已有 Change 记录的 current_stage 为 acce；When 迁移脚本执行 迁移脚本执行；Then current_stage 更新为 'verify'，human_gate 更新为 'blocked' current_stage 更新为 'verify'，h
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-673 Agent 驱动流转规则
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Change 的 current_stage 为 draft intake agent 判断需求明确 intake agent 判断需求不明确；When 创建完成 AgentRun 完成 AgentRun 完成；Then 自动 dispatch intake agent 分析需求 current_stage = propose，dispatch propose agent cur
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-674 propose 文档确认 Gate
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given propose agent 完成四件套生成；When AgentRun 状态为 completed；Then current_stage = propose，human_gate = need_proposal_review
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-675 proposal-review API
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given current_stage = propose 且 human_gate = need_proposal_review current_stage = prop；When POST /changes/{id}/proposal-review { decision: "approve" } POST /changes/{id}/pr；Then current_stage = plan，dispatch plan agent，human_gate = none dispatch propose agen
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-676 plan 文档确认 Gate
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given plan agent 完成计划生成；When AgentRun 状态为 completed；Then current_stage = plan，human_gate = need_plan_review
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-07
最近确认：98d3e56dd

## FR-unmapped-677 plan-review API
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given current_stage = plan 且 human_gate = need_plan_review current_stage = plan 且 huma；When POST /changes/{id}/plan-review { decision: "approve" } POST /changes/{id}/plan-r；Then current_stage = execute，dispatch execute agent，human_gate = none dispatch plan a
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-08
最近确认：98d3e56dd

## FR-unmapped-678 execute 完成自动 verify
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given execute agent 完成；When AgentRun 状态为 completed；Then 自动 dispatch verify agent，current_stage = verify，human_gate = none
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-09
最近确认：98d3e56dd

## FR-unmapped-679 verify 自动修复闭环
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given verify agent 完成 verify agent 完成 verify agent 完成；When AgentRun 状态为 completed 且验证通过 AgentRun 状态为 completed 且验证不通过 AgentRun 状态为 complete；Then current_stage = verify，human_gate = need_human_test dispatch quick agent 修复，修复后自
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-10
最近确认：98d3e56dd

## FR-unmapped-680 human-test API
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given current_stage = verify 且 human_gate = need_human_test current_stage = verify 且 h；When POST /changes/{id}/human-test { result: "pass" } POST /changes/{id}/human-test {；Then current_stage = archive，human_gate = need_archive_confirm dispatch quick agent c
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-11
最近确认：98d3e56dd

## FR-unmapped-681 前端按 gate 渲染交互
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Change 详情页加载；When 读取 human_gate 值；Then 按 human_gate 值渲染对应的操作面板（非技术阶段名）
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-12
最近确认：98d3e56dd

## FR-unmapped-682 简化新建变更
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户点击新建变更；When 填写需求描述（必填）和模块（可选）；Then 创建 Change（current_stage=draft, human_gate=none）
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-13
最近确认：98d3e56dd

## FR-unmapped-683 归档 Gate
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given current_stage = archive 且 human_gate = need_archive_confirm；When 所有检查项通过；Then 用户可确认归档
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-14
最近确认：98d3e56dd

## FR-unmapped-684 创建变更
变更：change-center-redesign
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-center-redesign/requirements.md#FR-1
最近确认：98d3e56dd

## FR-unmapped-685 变更列表展示阶段
变更：change-center-redesign
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-center-redesign/requirements.md#FR-2
最近确认：98d3e56dd

## FR-unmapped-686 启动变更执行
变更：change-center-redesign
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-center-redesign/requirements.md#FR-3
最近确认：98d3e56dd

## FR-unmapped-687 实时进度展示
变更：change-center-redesign
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-center-redesign/requirements.md#FR-4
最近确认：98d3e56dd

## FR-unmapped-688 查看变更文档
变更：change-center-redesign
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-center-redesign/requirements.md#FR-5
最近确认：98d3e56dd

## FR-unmapped-689 变更执行完成
变更：change-center-redesign
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-center-redesign/requirements.md#FR-6
最近确认：98d3e56dd

## FR-unmapped-690 创建变更自动进入 clarifying 阶段
变更：change-workflow-engine
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-workflow-engine/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-691 状态机转换必须遵循合法转换规则
变更：change-workflow-engine
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-workflow-engine/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-692 Agent 仅在 ready_for_dev 阶段可启动执行
变更：change-workflow-engine
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-workflow-engine/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-693 业务验收必须选择反馈分类
变更：change-workflow-engine
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-workflow-engine/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-694 归档必须通过 6 项门禁检查
变更：change-workflow-engine
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-workflow-engine/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-695 旧数据兼容迁移
变更：change-workflow-engine
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-workflow-engine/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-696 配置 spec_data_root
变更：workspace-spec-root-managed-p0
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/workspace-spec-root-managed-p0/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-697 补建 spec_workspaces 记录
变更：workspace-spec-root-managed-p0
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/workspace-spec-root-managed-p0/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-698 迁移已有 scan 文档
变更：workspace-spec-root-managed-p0
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/workspace-spec-root-managed-p0/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-699 ScanDocsService 从 spec_root 读取
变更：workspace-spec-root-managed-p0
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/workspace-spec-root-managed-p0/requirements.md#FR-04
最近确认：98d3e56dd

变更：workspace-spec-root-managed-p0
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/workspace-spec-root-managed-p0/requirements.md#FR-05
最近确认：98d3e56dd

变更：2026-09-20-workspace-member-visibility
状态：active
摘要：默认场景；非成员持平台级 workspace:read 访问工作区详情；非成员持平台级 mcp:read 读工作区 MCP 配置
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 用户不是工作区 W 的成员，且不是平台管理员（`is_platform_admin=False` 且平台级角色不含 `platform:admin`），但平台级；When 以工作区 W 为上下文判定权限 P（`has_permission(workspace_id=W)`，即所有 `require_permission` 路由）；Then 判定为 False（403），P 为任意 Permission 枚举值均如此
- 场景：非成员持平台级 workspace:read 访问工作区详情 — Given 180490 绑定 developer 角色（平台级 `workspace:read`），不是工作区 W 成员；When GET /api/workspaces/{W}；Then HTTP 403
- 场景：非成员持平台级 mcp:read 读工作区 MCP 配置 — Given 同上用户，权限为 `mcp:read`；When 访问 W 的 mcp-config 读端点；Then HTTP 403
全文：.sillyspec/changes/archive/2026-09-20-workspace-member-visibility/requirements.md#FR-01
最近确认：3642c3d0

变更：2026-09-20-workspace-member-visibility
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 用户 `is_platform_admin=True`，或平台级角色含 `platform:admin`；When 访问任意工作区（成员或非成员）或列表；Then 行为与改动前完全一致（放行、全量列表）
全文：.sillyspec/changes/archive/2026-09-20-workspace-member-visibility/requirements.md#FR-02
最近确认：3642c3d0

变更：2026-09-20-workspace-member-visibility
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 用户非平台管理员、平台级角色不含 `platform:admin`，但持平台级 `workspace:read`；When GET /api/workspaces；Then 仅返回该用户为成员的工作区（无成员身份则空列表）；ql-20260917-007 的「平台级 workspace:read → 全量」分支废止
全文：.sillyspec/changes/archive/2026-09-20-workspace-member-visibility/requirements.md#FR-03
最近确认：3642c3d0

变更：2026-09-20-workspace-member-visibility
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 工作区 W 发生需广播事件（`list_user_ids_with_permission(workspace_id=W, permission=P)` 被调用）；When 查找收件人
全文：.sillyspec/changes/archive/2026-09-20-workspace-member-visibility/requirements.md#FR-04
最近确认：3642c3d0

变更：2026-09-20-workspace-member-visibility
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 用户持平台级权限 P（如 developer 角色的 `workspace:read`）；When 以无工作区上下文判定 P（`require_permission_any`，如创建工作区前的入口校验）或经 `/api/auth/me` 聚合权限驱动菜单显隐；Then 行为与改动前完全一致（菜单仍可见、入口判定仍放行）
全文：.sillyspec/changes/archive/2026-09-20-workspace-member-visibility/requirements.md#FR-05
最近确认：3642c3d0

变更：2026-09-20-workspace-member-visibility
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 用户持平台级 `workspace:write` 并创建工作区；When 创建完成（新建/复用/复活任一路径，`backend/app/modules/workspace/service.py` `_ensure_creator_as；Then 创建者自动成为该工作区 `workspace_owner` 成员，随后对该工作区的访问走成员判定、正常放行
全文：.sillyspec/changes/archive/2026-09-20-workspace-member-visibility/requirements.md#FR-06
最近确认：3642c3d0
