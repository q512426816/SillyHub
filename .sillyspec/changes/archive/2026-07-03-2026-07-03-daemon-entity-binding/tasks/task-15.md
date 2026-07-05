---
id: task-15
title: 测试补全：backend/daemon/frontend 三端 + 端到端验收 8 条
author: qinyi
created_at: 2026-07-03 11:30:00
priority: P0
depends_on: [task-01..14]
blocks: []
allowed_paths:
  - backend/app/modules/daemon/tests/
  - backend/app/modules/workspace/member_runtimes/tests/
  - backend/app/modules/agent/tests/
  - sillyhub-daemon/tests/
  - frontend/src/components/__tests__/
  - frontend/src/lib/__tests__/
covers: [NFR-02, NFR-03, NFR-04]
---

## goal
> 补全 daemon 实体化后三端测试，覆盖注册/心跳/WS 握手/派发/前端选择器，并跑通 design §11 全局验收 8 条。

## implementation
- backend daemon：daemon_instance 注册 upsert、单条心跳更新 daemon_instances+runtimes、stale 联动 offline、ws_hub 改 daemon_id 后 connect/send/replaced（code=4000）用例。
- backend workspace：resolver 返回 daemon_id + PUT /my-binding 写 daemon_id；agent placement：daemon_id+default_agent 命中、不匹配抛 NoOnlineDaemonError（D-008）、旧 binding daemon_id 空报「未绑定」、provider 单次覆盖。
- daemon：config 按 server_hash 隔离 + 旧 config.json 迁移 daemon_local_id、单条 WS 握手带 daemon_local_id + 按 payload.runtime_id 分发用例。
- frontend：switcher 选 daemon+provider 徽标、详情页 default_agent 独立选择器（有/无在线 provider）、agent 页单次覆盖；端到端按 design §11 / plan 全局验收 8 条逐条核对。

## acceptance
- backend daemon/runtime/workspace/agent placement 测试全通过，daemon_instance 注册/心跳/WS 握手用例齐备。
- daemon config 隔离 + 单 WS 用例通过；frontend switcher/default_agent/单次覆盖用例通过。
- design §11 全局验收 8 条逐条有对应测试或手动核验记录。

## verify
- `cd backend && uv run pytest --cov=app` / `cd sillyhub-daemon && pnpm test` / `cd frontend && pnpm test`
- 端到端：起 daemon → 查 daemon_instances/daemon_runtimes 行数 + WS 连接数

## constraints
- brownfield 用例：旧 daemon 握手失败、重置后重绑（D-007）；lease/change_write.runtime_id 不变性断言（D-003）。
- 不绑死 SQL 方言函数名（backend-test-sqlite-vs-pg），日期用行数+整点；前端动态组件按 frontend-markdown-text-jsdom-null mock。
- 测试逻辑本身有误才改，禁止为通过而改（CLAUDE.md 规则8）。
