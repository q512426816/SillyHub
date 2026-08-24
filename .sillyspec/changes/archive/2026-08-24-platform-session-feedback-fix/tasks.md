---
author: qinyi
created_at: 2026-08-24 10:45:00
---

# 任务清单（Tasks）— 平台会话实时反馈修复

- [x] task-01: 后端新增 plan/bash/agent_task SSE 事件 DTO 与 Redis 发布逻辑 (depends_on: none) [model: sonnet]
- [x] task-02: 后端新增 plan-response REST 端点与 WebSocket 通知 daemon (depends_on: task-01) [model: sonnet]
- [x] task-03: daemon 新增 plan/bash/agent_task 事件上报 HubClient 方法 (depends_on: task-01) [model: sonnet]
- [x] task-04: daemon 在 session-manager turn 事件流中识别 plan/Bash/后台任务 (depends_on: task-03) [model: sonnet]
- [x] task-05: 前端新增 SessionStreamEnvelope 事件解析分支 (depends_on: task-01) [model: sonnet]
- [x] task-06: 前端新增 PlanApprovalCard 组件与 plan-response 提交 (depends_on: task-02, task-05) [model: sonnet]
- [x] task-07: 前端新增 BashProgressCard 组件 (depends_on: task-05) [model: sonnet]
- [x] task-08: 前端 askuser / permission 弹窗支持最小化 (depends_on: none) [model: sonnet]
- [x] task-09: 前端 SessionPanel 接入新事件与卡片渲染 (depends_on: task-06, task-07, task-08) [model: sonnet]
- [x] task-10: 后端测试覆盖新事件与 plan-response 端点 (depends_on: task-01, task-02) [model: sonnet]
- [x] task-11: daemon 测试覆盖事件上报 (depends_on: task-03, task-04) [model: sonnet]
- [x] task-12: 前端测试覆盖新组件与事件分发 (depends_on: task-06, task-07, task-08, task-09) [model: sonnet]
- [x] task-13: gen:types 同步与 openapi.json 更新 (depends_on: task-02) [model: sonnet]
- [x] task-14: 端到端验证 plan/bash/askuser 最小化在真实会话中可用 (depends_on: task-01~task-13) [model: sonnet]
