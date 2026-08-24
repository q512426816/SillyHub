---
author: qinyi
created_at: 2026-08-24 10:50:00
plan_level: full
---

# 实现计划（Plan）— 平台会话实时反馈修复

## 复杂度分类

```
plan_level: full
reason: 跨 backend/daemon/frontend 三子项目，14 个 task，涉及事件协议、REST API、UI 组件与状态流转
estimated_files: 14+
cross_module: true
has_schema_change: false
has_state_machine_change: true
needs_parallel_execution: true
needs_human_review: false
```

## Spike 前置验证

| Spike | 验证内容 | 通过标准 | 不通过后果 |
|---|---|---|---|
| spike-01 | daemon `session-manager.ts` 中识别 `EnterPlanMode` / Bash tool_use 的具体 hook 点 | 能在 turn 事件流中稳定捕获到 plan/Bash 事件 | task-04 推翻重设计，改用 SDK callback 或日志文本匹配 |

## Wave 1：后端事件协议与发布

- task-01
- task-02

## Wave 2：daemon 事件上报

- task-03
- task-04

## Wave 3：前端事件消费与新组件

- task-05
- task-06
- task-07
- task-08
- task-09

## Wave 4：测试与类型同步

- task-10
- task-11
- task-12
- task-13

## Wave 5：端到端验证

- task-14

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端新增 plan/bash/agent_task SSE 事件 DTO 与 Redis 发布逻辑 | W1 | P0 | — | FR-01, FR-02, FR-03, D-002@v1 | 扩展 `run_sync/service.py` 发布到 `agent_session:{id}` |
| task-02 | 后端新增 plan-response REST 端点与 WebSocket 通知 daemon | W1 | P0 | task-01 | FR-02, D-001@v1, D-002@v1 | 新增 `POST /api/daemon/sessions/{session_id}/plan-response` |
| task-03 | daemon 新增 plan/bash/agent_task 事件上报 HubClient 方法 | W2 | P0 | task-01 | FR-01, FR-02, FR-03, D-002@v1 | `hub-client.ts` 新增 notify 系列方法 |
| task-04 | daemon 在 session-manager turn 事件流中识别 plan/Bash/后台任务 | W2 | P0 | task-03 | FR-01, FR-02, FR-03, D-002@v1 | 依赖 spike-01 确认的 hook 点 |
| task-05 | 前端新增 SessionStreamEnvelope 事件解析分支 | W3 | P0 | task-01 | FR-01, FR-02, FR-03, D-002@v1 | `lib/daemon.ts` 识别新事件类型 |
| task-06 | 前端新增 PlanApprovalCard 组件与 plan-response 提交 | W3 | P0 | task-02, task-05 | FR-02, D-001@v1 | 强确认交互卡片 |
| task-07 | 前端新增 BashProgressCard 组件 | W3 | P0 | task-05 | FR-01, D-002@v1 | 命令进度与实时输出 |
| task-08 | 前端 askuser / permission 弹窗支持最小化 | W3 | P0 | — | FR-04, D-003@v1 | 展示层改造，不改 dialog 状态机 |
| task-09 | 前端 SessionPanel 接入新事件与卡片渲染 | W3 | P0 | task-06, task-07, task-08 | FR-01, FR-02, FR-04 | 主面板事件分发 |
| task-10 | 后端测试覆盖新事件与 plan-response 端点 | W4 | P0 | task-01, task-02 | FR-01, FR-02, FR-03 | pytest 覆盖 |
| task-11 | daemon 测试覆盖事件上报 | W4 | P0 | task-03, task-04 | FR-01, FR-02, FR-03 | vitest 覆盖 |
| task-12 | 前端测试覆盖新组件与事件分发 | W4 | P0 | task-06, task-07, task-08, task-09 | FR-01, FR-02, FR-04 | vitest 覆盖 |
| task-13 | gen:types 同步与 openapi.json 更新 | W4 | P0 | task-02 | FR-02 | 类型同步 |
| task-14 | 端到端验证 plan/bash/askuser 最小化在真实会话中可用 | W5 | P0 | task-01~task-13 | FR-01, FR-02, FR-04 | 本地 e2e |

## 关键路径

task-01 → task-03 → task-04 → task-05 → task-06 → task-09

该路径决定最短交付周期。task-02/07/08 可并行。

## 全局验收标准

1. 所有新增事件类型后端能发布、daemon 能上报、前端能消费并渲染对应卡片。
2. `POST /api/daemon/sessions/{session_id}/plan-response` 端点 200/422/404 行为正确，决策能回传 daemon。
3. askuser / permission 弹窗最小化后不影响决策提交，未决角标显示正确。
4. 未配置/旧版本 daemon/前端默认行为不变（向后兼容）。
5. backend / daemon / frontend 三端新增单测通过，全量 CI 绿。
6. 本地 e2e：真实会话中触发 plan/Bash/askuser，Web 侧反馈符合原型。

## 覆盖矩阵

| 决策 ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02, task-06 | PlanApprovalCard 弹出且 Agent 收到 decision 才继续 |
| D-002@v1 | task-01, task-03, task-04, task-05 | 新事件走现有 `agent_session:{id}` 通道，单测验证 |
| D-003@v1 | task-08, task-09 | askuser 弹窗可最小化/还原，角标显示正确 |

## 风险缓解

- **R-01（daemon 识别时机）**：spike-01 先确认 hook 点，task-04 再落实现上报逻辑。
- **R-02（plan 状态同步）**：task-02 中通过现有 `ws_hub.send_to_runtime` 发送 `daemon:plan_response`，daemon 收到后 resolve 等待 Promise。
- **R-03（bash_chunk 性能）**：task-01 中实现 100ms 节流 + 8KB 上限，task-07 中实现输出截断与展开。

## 验证门

每个 Wave 完成后跑对应测试：

- Wave 1：`cd backend && uv run pytest app/modules/daemon -q -k plan_bash --no-cov -n auto`
- Wave 2：`cd sillyhub-daemon && pnpm exec vitest run tests/session-plan-bash-events.test.ts`
- Wave 3：`cd frontend && pnpm exec vitest run src/components/daemon/__tests__/plan-approval-card.test.tsx src/components/daemon/__tests__/bash-progress-card.test.tsx`
- Wave 4：`make test`（backend + frontend + daemon 全量）
- Wave 5：本地 e2e 验证
