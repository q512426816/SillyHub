---
author: qinyi
created_at: 2026-06-24 10:45:30
---

# Tasks

> 任务编号 = 实现顺序(TDD:测试任务排在前),与 plan.md / tasks/task-NN.md 蓝图一致。
> 本文件为 brainstorm 阶段粗任务清单,细化见 plan.md。

## 后端(Phase 1)

- **task-01** · config 新增 grace + 调整 TTL
  文件:`backend/app/core/config.py`
  覆盖:FR-03, D-002@v1, D-003@v1

- **task-02** · Session 新增 rotated_at 字段
  文件:`backend/app/modules/auth/model.py`
  覆盖:FR-02, D-002@v1

- **task-03** · migration add_session_rotated_at
  文件:`backend/migrations/versions/202606241000_add_session_rotated_at.py`(新增)
  覆盖:FR-02
  说明:`down_revision` = `alembic heads` 当前 head

- **task-04** · 后端测试:grace window(TDD,先红)
  文件:`backend/tests/modules/auth/test_refresh_grace_window.py`(新增)
  覆盖:FR-01, FR-07
  说明:复现 grace 内重复刷新不误杀、超 grace 仍吊销、logout 调用点三元解包不报错

- **task-05** · service grace 改造(TDD,后绿)
  文件:`backend/app/modules/auth/service.py`
  覆盖:FR-01, FR-07, D-001@v1
  说明:`_consume_refresh_token` 返回三元组 + grace 判定;`refresh` 分支跳过重复 revoke;新增 `_mark_session_rotated`;`logout_session_by_refresh` 适配三元解包;`_lookup_revoked_session_owner` → `_find_revoked_session` 返回 session 以读 rotated_at

## 前端(Phase 2)

- **task-06** · 前端测试:token-refresh 单飞(TDD,先红)
  文件:`frontend/src/lib/__tests__/token-refresh.test.ts`(新增)
  覆盖:FR-04, FR-05

- **task-07** · 新增 token-refresh 单飞锁(TDD,后绿)
  文件:`frontend/src/lib/token-refresh.ts`(新增)
  覆盖:FR-04
  说明:`ensureFreshAccessToken()` 模块级 inflight + `decodeJwtExp()` 工具

- **task-08** · 三处 401 收口到单飞锁
  文件:`frontend/src/lib/api.ts`、`frontend/src/lib/ppm/export.ts`、`frontend/src/lib/auth.ts`
  覆盖:FR-05

- **task-09** · AppShell 主动刷新定时器
  文件:`frontend/src/components/app-shell.tsx`
  覆盖:FR-06, D-004@v1

## 集成验收(Phase 3)

- **task-10** · 端到端实测 + 文档同步
  覆盖:全部 FR
  说明:curl 实测 grace 行为 + 前端联调;同步 auth.md / 相关模块文档(CONVENTIONS「后端改完必实测 API」)
