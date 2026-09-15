---
author: qinyi
created_at: '2026-09-15 16:27:23'
---

# 需求规格（Requirements）— 2026-09-15-background-task-permission-lockout

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在会话页与 agent 对话、审批权限请求/回答问答卡的人 |
| 后台 Task 子代理 | 主轮派生的异步 Task 工具子代理，存活期可跨越主轮收尾 |
| daemon | sillyhub-daemon，会话/权限/写策略的本地执行体 |
| backend | 权限受理、run 终态化、审计的权威端 |

## 功能需求

### FR-01: 后台锚点与守卫放行
覆盖决策：D-001@v1

Given 会话主轮收尾（`onResult`）且后台任务注册表非空
When 该会话再无新 inject，后台子代理发起写类工具调用进入 `canUseTool`
Then `currentRunId` 保留为后台锚点（status=active），`writeChannelGuardDeny` 经
`hasBackgroundTaskGrace` 放行（active + currentRunId 在 + 注册表非空），调用进入
写策略/人审链路而非被守卫拒绝

Given 注册表最后一个任务终态注销（task_notification）
When 注销后注册表清空且 `state.status==='active' && state.currentRunId`
Then 锚点被清除，守卫恢复 fail-closed

Given 新 inject 到达（后台任务仍在跑）
When inject 切换 `currentRunId` 到新 run、status=running
Then 后续工具调用按新 run 正常校验（锚点语义不干扰轮次切换）

### FR-02: background_task 标记与后端受理放宽 + 有界拒收
覆盖决策：D-001@v1

Given 后台锚点态（`status!=='running' && 注册表非空`）
When 4 处可达 register 调用点（默认普通审批 :524 / AskUserQuestion 拦截 :362 /
ExitPlanMode :441 / requestPermissionImpl :209）发起 PERMISSION_REQUEST
Then payload 携带 `background_task: true`（主轮进行中恒 false；2 处不可达路径
requestUserDialogImpl/buildOnUserDialogCallback 维持锚点态 cancelled，不注入）

Given backend 收到 `background_task=true` 的请求
When 校验（session 存在/runtime 归属/session active/manual_approval 通过）
Then active-turn 与 run 匹配校验替换为「按 run_id 直查 + `run.agent_session_id==session_id`
归属校验」，受理通过则正常落 dialog 行/挂 timer/SSE

Given backend 任一校验失败
When 即将 fail-soft 丢弃
Then 先经 `send_permission_response` 推即时 deny（payload 带 runtime_id ack 键 +
`PLATFORM_PERMISSION_DROPPED: <原因> — retry in a new turn`，best-effort），再 return False

Given daemon 侧 `backgroundTask===true` 的请求（含 dialog）
When 等待应答
Then 5 分钟 fallback timer 兜底 deny（覆盖 dialog）；主轮进行中的 dialog 维持现状
不设超时

### FR-03: 守卫/拒收 deny 带稳定平台故障码
覆盖决策：D-001@v1

Given 守卫残留 deny（`writeChannelGuardDeny` 两处 message）或 backend 拒收 deny
When deny 文案生成
Then message 以 `PLATFORM_NO_RUNNING_TURN:`（守卫）/ `PLATFORM_PERMISSION_DROPPED:`
（后端拒收）前缀开头，agent 可程序化区分平台故障与用户权限拒绝；主轮普通人审
deny 文案不变

### FR-04: 重启终态化补错误码 + 用量归属标注
覆盖决策：D-001@v1

Given backend 重启清理终态化在跑 run
When 标 failed
Then `error_code='SERVICE_RESTART_INTERRUPTED'` +
`error_detail={"reason": ..., "finished_by": "startup_cleanup"}`（completed 恢复分支不写）

Given run 收口上报用量时该会话注册表非空
When 上报 run result
Then 向正在收口的 runId 追加一条 stdout 日志行
`[USAGE_NOTE] 本轮上报用量含仍在运行的后台任务消耗（SDK 为会话级累计快照，无法按任务拆分）`

## 非功能需求

- 兼容性：旧 daemon + 新 backend 行为与现状逐字节一致（`background_task` 缺省
  None）；新 daemon + 旧 backend 最坏 5 分钟有界 deny，均不劣于现状。部署顺序
  backend 先行或同时。
- 可回退：协议字段可选、缺省即回退旧行为；守卫新放行条件随注册表空自动失效。
- 可测试：锚点保留/清除、守卫三态、4 处注入点透传、受理放宽、即时 deny payload、
  error_code、USAGE_NOTE 均有单测断言（daemon vitest / backend pytest）。
- 审计：即时 deny 复用既有 PERMISSION_RESPONSE 通道与 deny 下行 payload 先例
  （含 runtime_id ack 键），不新增审计面。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02, FR-03, FR-04 | 方案 A（锚点+协议标记）全部落点：锚点=FR-01、标记+受理+有界兜底=FR-02、故障码=FR-03、error_code+标注=FR-04 |
