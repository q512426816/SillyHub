---
author: qinyi
created_at: 2026-08-24 11:44:10
---

# 符号影响面报告

> tasks.md 内容指纹（生成时）: 97f1c8d3907063b7——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无既有签名级变更。schema.py 纯新增 DTO（PlanModeEnteredEvent/BashStatusEvent/BashChunkEvent/AgentTaskStatusEvent/PlanSummary/PlanResponseDecision/PlanResponseRequest，additive）；run_sync/service.py 新增 publish_session_event helper（additive 函数），既有 publish_submitted_messages（service.py:108，发布 agent_session:{id} 于 162/191/208 行）签名与调用点不变。
- task-02: 无既有签名级变更。router.py 纯新增端点（POST /sessions/{session_id}/plan-response + 4 个 ingestion 端点 plan-mode-entered/bash-status/bash-chunk/agent-task-status，沿用现有 /sessions/{session_id}/ready（router.py:1394）装饰器模式）；session/service.py 新增 handle_plan_response 方法（additive）。既有端点与 service 方法签名不变。
- task-03: 无既有签名级变更。hub-client.ts 纯新增 4 个 notify 方法与 body 类型（additive），HubClient 既有方法（notifyRunResult/submitMessages/notifySessionEnd）签名不变；新方法调用点仅 task-04（范围内）。
- task-04: 签名级变更（additive-optional）：SessionManagerDeps（types.ts:364）新增 optional onSessionEvent 回调字段——既有构造调用点 cli.ts:640 与既有测试 mock 不传该字段零影响（optional）；cli.ts 新增 1 个闭包接线（同 onTurnResult/onTurnMessage 模式，cli.ts:657-669）。识别点锚定 _onMessage（session-manager.ts:3446）：assistant tool_use blocks 遍历（3459-3476 已有遍历可扩展）+ user 消息通用转发分支（3582-3585）前拦截 tool_result。spike-01 结论：hook 点可行，PASS。
- task-05: 签名级变更（additive-optional）：SessionEventKind 联合扩展 3 个字面量、SessionStreamEnvelope 新增 optional 字段、SessionStreamHandlers 新增 3 个 optional 回调——消费方 session-panel.tsx 不传新回调零影响（在其任务范围内接入）；新增 submitPlanResponse 独立函数（additive）。streamSession 函数签名不变。
- task-06: 无签名级变更。新文件 plan-approval-card.tsx（additive 组件），消费 task-05 的 submitPlanResponse；无既有调用点。
- task-07: 无签名级变更。新文件 bash-progress-card.tsx（additive 组件），props 驱动；无既有调用点。
- task-08: 无跨文件签名级变更。ask-user-dialog-card.tsx / permission-approval-card.tsx 组件内部新增 minimized 状态与 optional 内部回调（渲染调用点 session-permission-panel.tsx 同属本任务 allowed_paths，范围内自洽）；respondSessionPermission 等对外契约不变。
- task-09: 无签名级变更。session-panel.tsx 内部新增状态与挂接 task-05 回调、渲染 task-06/07 组件、复用 task-08 最小化能力；组件导出签名不变。
- task-10: 无签名级变更。新增测试文件 test_session_plan_bash_events.py（additive），不触及生产签名。
- task-11: 无签名级变更。新增测试文件 session-plan-bash-events.test.ts（additive）。
- task-12: 无签名级变更。新增/扩展前端测试文件（additive）。
- task-13: 无签名级变更。openapi.json 与 api-types.ts 为生成产物（pnpm gen:types 重跑），不手改签名。
- task-14: 无签名级变更。e2e 验证报告，无代码符号变更。

## spike-01 结论（plan.md Spike 前置验证）

**PASS**。hook 点确认：daemon session-manager `_onMessage`（session-manager.ts:3446）是全部 SDK 消息总线——
1. assistant message 的 tool_use blocks 已有遍历点（3459-3476），可读 name（Bash/EnterPlanMode/ExitPlanMode/Task）、input.command、tool_use.id → 触发 bash_status(running) / plan_mode_entered / agent_task_status(running)；
2. user message（tool_result）走 3582 通用转发分支，可在该分支前拦截 tool_use_id 匹配 → bash_chunk(is_final) + bash_status(completed/failed，is_error 派生)；
3. run_id 取 state.currentRunId、sessionId 可用，上报所需字段齐备；
4. 生产接线点：cli.ts:640 SessionManagerDeps 构造处新增 onSessionEvent 闭包（client=HubClient 在作用域内）→ **task-04 allowed_paths 需补 cli.ts**（否则新 deps 字段无生产注入，事件永不触发）；
5. EnterPlanMode 的 input 不含计划内容，objective/tasks 实际随 ExitPlanMode tool_use（input.plan）到达——task-04 按「plan 相关 tool_use」识别（卡片已允许），EnterPlanMode 事件 summary 可为空骨架；
6. Claude SDK 不流式推送 Bash stdout，bash_chunk 实际在 tool_result 到达时一次性发出（is_final=true），100ms 节流仍保留作为防御。

## 执行层补正（流入对应 TaskCard，非方案变更）

design.md「接口定义 §daemon → 后端 HTTP 上报」已定义 NotifyPlanModeEnteredBody/NotifyBashStatusBody/NotifyBashChunkBody，但文件变更清单 router.py 行漏列 4 个 ingestion 端点、接口定义缺 NotifyAgentTaskStatusBody（FR-03）。补正：
- design.md 文件清单 router.py 行补 ingestion 端点说明；接口定义补 NotifyAgentTaskStatusBody；
- task-02 卡 implementation 补 4 个 ingestion 端点（body 复用 task-01 DTO 校验后经 task-01 helper 发布）；
- task-04 卡 allowed_paths 补 cli.ts（仅接线 1 个闭包）。
Wave 分组与同 Wave 文件冲突不受影响（cli.ts 仅 task-04、router.py 仅 task-02 触碰）。
