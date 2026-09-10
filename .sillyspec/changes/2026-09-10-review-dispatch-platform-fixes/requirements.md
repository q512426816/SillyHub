---
author: qinyi
created_at: 2026-09-10 21:06:00
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台派发调用方 | sillyspec review-dispatch 等经 MCP/HTTP 派发 worker 的主控 agent，消费 get_worker_result artifacts |
| 平台 worker | 经 interactive 子会话派发的执行 agent（pi/codex/claude...），产出审查/执行结论 |
| 平台管理员 | 配置 workspace default_agent、创建 llm_providers 凭证、绑定 agent profile |
| daemon | 本地执行守护进程，承接 lease、spawn agent、上报终态 |

## 功能需求

### FR-01: PI worker 终态结论沉淀为 summary artifact
覆盖决策：D-001@v1
Given 一个 `stage=mission_worker` 且 provider caps `mcp=false`（如 pi）的 interactive 分身会话
When 该会话一轮 turn 以 success 收敛且轮内存在完整 assistant 文本（override text 事件）
Then daemon 在 `onTurnResult` 的 `await notifyRunResult` 之后，以分身会话 id 为 X-Session-Id 调 `worker_done`（summary=轮终 assistant 全文），backend 落 `AgentArtifact(kind=summary, content_ref=全文)` 挂分身首 run，`get_worker_result` 返回至少一条带正文的 artifact

Given worker 多轮会话（追问重开工）
When 每一轮 success 收敛
Then 每轮各代报一次，artifact 按 created_at 递增、最新为终态（backend 可重复置位取最新语义）

Given turn 以 error 收敛、或轮内无完整 assistant 文本、或会话非 mission_worker、或 provider caps `mcp=true`（claude）
Then daemon 不代报（claude 走 worker_prompt 约定的 MCP 自报，防 artifact 双写）

Given 代报请求失败（409 迟到 / 422 / 网络错误）
Then 仅 warn 不重试不阻塞主流程（消费方仍有 sillyspec 侧日志兜底）

### FR-02: PI turn result 携带轮终全文
覆盖决策：D-001@v1
Given pi-rpc-driver 一轮 turn 内到达 assistant message_end（override text 全文事件）
When turn 以 success 收敛上报 result
Then result 含 `result`=轮内最后一条 override text 全文；error 轮维持既有 error 语义（result=错误信息）；轮状态在每轮重置区清空

### FR-03: pi 凭证可独立配置并注入 worker 子进程
覆盖决策：D-002@v1
Given 平台管理员经 API/表单创建 `agent_kind=pi` 的 LlmProvider（独立 api_key，auth_field 为合法 env 变量名如 ZAI_API_KEY）
When pi 会话（interactive 或 batch）claim lease 且解析到该 provider_config
Then daemon spawn-env 第 0 层经 PiCredentialInjector 注入 `env[auth_field ?? 'ANTHROPIC_API_KEY']=api_key` 与 extra_env；base_url/litellm_proxy/model 字段不映射（v1 边界）

Given 用户未配置任何 pi 凭证
When pi 会话 claim
Then provider_config 缺省 → 第 0 层跳过 → 行为与现状逐字一致（本机凭证）

Given auth_field 非法（非 `^[A-Z][A-Z0-9_]*$`）
Then backend pydantic 拒绝；前端表单同 pattern 即时报错

### FR-04: get_daemon_status 暴露生效执行器
覆盖决策：D-003@v1
Given token 绑定 workspace 的 get_daemon_status 查询
When 响应返回
Then 顶层含 `default_agent`（workspace 原值，可为 null）与 `effective_agent`（default_agent 非空即它；否则 daemons 返回序首个 online 项的首个 online provider，可为 null）；`daemons[]` 每项含 `providers:[{provider, status, version}]`（DaemonRuntime online 行按 daemon 分组）

## 非功能需求

- 兼容性：未配置新功能时行为不变（FR-01 门控隔离 claude、FR-03 缺省跳过、FR-04 纯增量键）；旧 daemon/旧 backend 组合零破坏；api-types 再生成不改既有字段形状。
- 可回退：daemon 代报分支为纯增量代码路径（门控不中即零行为差）；schema 放开仅扩值域不迁列（回退=改回 Literal）。
- 可测试：全部 FR 有单测覆盖（daemon vitest / backend pytest / frontend vitest）；`gen:types:check` 零漂移。
- 安全：auth_field 只作 env 键名（pattern 校验防注入 env 覆盖敏感保留名的风险面已由大写字母形状限制）；api_key 不落日志（沿用 redactEnv/redactProviderConfig 既有铁律，injector 不打日志）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02 | worker_done 通道复用 + kind=summary + PI result 补全 |
| D-002@v1 | FR-03 | 开放 pi kind + injector，账号级/profile/workspace 双路独立池 |
| D-003@v1 | FR-04 | get_daemon_status 实时暴露（弃 mcp-tokens 快照） |
