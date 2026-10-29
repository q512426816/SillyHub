---
author: flow-machine-draft
created_at: 2026-10-29T23:20:12.378Z
---
# 提案书（Proposal）— 2026-10-30-task-resume-revive-notify-retry

## 动机

任务原话转写：子代理续唤复活终态任务行+上报502重试

后台子代理 task-notification 语义是「本轮停止」而非终结：被主代理续唤重跑后，平台任务行永久卡「已完成」（实证会话 ee002255 子代理 ad80ad96 于 13:10 与 13:14 收到两次同 task-id 完成通知，中间续唤重跑期平台一直显示已完成）。根因两处：backend agent_task_store 语义②终态吸收一切 running 事件（复活分支仅对清扫 stopped 行开放）；daemon 侧续唤重跑的 running 帧即使上报也被吸收。另外 daemon→平台 agent-task-status HTTP 上报失败（实测多次 502）仅 console.error 无重试，状态事件永久丢失。

成功标准：
- daemon 对「已终态注销后再收到同 task_id 的 running 帧」的事件打 resumed=true 标记并上报平台
- backend AgentTaskStatusEvent 增可选 resumed 字段（DTO 透传）；upsert 终态行收 running 事件时仅 resumed=true 放行复活（status 回 running、finished_at 清空），无标记维持吸收
- 前端 SSE 事件类型与归约同步：resumed=true 的 running 事件可把已定格卡片翻回运行中，无标记维持定格
- daemon agent-task-status 上报失败（5xx/网络错误）有限次数退避重试，upsert 幂等保证重试安全
- schema 改动双端 gen:types 同步（frontend api-types.ts + sillyhub-daemon api-types.ts + openapi.json 同一变更内提交）
- daemon/backend/frontend 三侧新增单测通过且既有相关测试零回归

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. daemon 对「已终态注销后再收到同 task_id 的 running 帧」的事件打 resumed=true 标记并上报平台
2. backend AgentTaskStatusEvent 增可选 resumed 字段（DTO 透传）；upsert 终态行收 running 事件时仅 resumed=true 放行复活（status 回 running、finished_at 清空），无标记维持吸收
3. 前端 SSE 事件类型与归约同步：resumed=true 的 running 事件可把已定格卡片翻回运行中，无标记维持定格
4. daemon agent-task-status 上报失败（5xx/网络错误）有限次数退避重试，upsert 幂等保证重试安全
5. schema 改动双端 gen:types 同步（frontend api-types.ts + sillyhub-daemon api-types.ts + openapi.json 同一变更内提交）
6. daemon/backend/frontend 三侧新增单测通过且既有相关测试零回归

## 成功标准（可验证）

1. daemon 对「已终态注销后再收到同 task_id 的 running 帧」的事件打 resumed=true 标记并上报平台
2. backend AgentTaskStatusEvent 增可选 resumed 字段（DTO 透传）；upsert 终态行收 running 事件时仅 resumed=true 放行复活（status 回 running、finished_at 清空），无标记维持吸收
3. 前端 SSE 事件类型与归约同步：resumed=true 的 running 事件可把已定格卡片翻回运行中，无标记维持定格
4. daemon agent-task-status 上报失败（5xx/网络错误）有限次数退避重试，upsert 幂等保证重试安全
5. schema 改动双端 gen:types 同步（frontend api-types.ts + sillyhub-daemon api-types.ts + openapi.json 同一变更内提交）
6. daemon/backend/frontend 三侧新增单测通过且既有相关测试零回归
