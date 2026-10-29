---
author: flow-machine-draft
created_at: 2026-10-29T23:20:12.378Z
---
# 任务注册表（Tasks）— 2026-10-30-task-resume-revive-notify-retry

- [x] task-01: daemon 对「已终态注销后再收到同 task_id 的 running 帧」的事件打 resumed=true 标记并上报平台
- [x] task-02: backend AgentTaskStatusEvent 增可选 resumed 字段（DTO 透传）；upsert 终态行收 running 事件时仅 resumed=true 放行复活（status 回 running、finished_at 清空），无标记维持吸收
- [x] task-03: 前端 SSE 事件类型与归约同步：resumed=true 的 running 事件可把已定格卡片翻回运行中，无标记维持定格
- [x] task-04: daemon agent-task-status 上报失败（5xx/网络错误）有限次数退避重试，upsert 幂等保证重试安全
- [x] task-05: schema 改动双端 gen:types 同步（frontend api-types.ts + sillyhub-daemon/src/api-types.ts + openapi.json 同一变更内提交）
- [x] task-06: daemon/backend/frontend 三侧新增单测通过且既有相关测试零回归
