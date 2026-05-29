---
author: qinyi
created_at: 2026-05-28 13:25:00
---

# Tasks

## Wave 1 — 后端数据通路

- [ ] ClaudeCodeAdapter 逐行流式读取 + Redis Pub/Sub 发布
  - `backend/app/modules/agent/adapters/claude_code.py`

- [ ] SSE 端点 + Redis subscribe 服务方法
  - `backend/app/modules/agent/router.py`
  - `backend/app/modules/agent/service.py`

## Wave 2 — 前端消费

- [ ] EventSource 消费函数
  - `frontend/src/lib/agent.ts`

- [ ] Agent Console 页面 running 时 SSE 模式
  - `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx`

## Wave 3 — 测试与验证

- [ ] 后端单元测试（SSE 端点、Redis 发布）
  - `backend/app/modules/agent/tests/test_streaming.py`

- [ ] 前端测试 + 集成验证
  - 部署验证 SSE 实时流
