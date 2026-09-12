---
id: task-01
task_id: task-01
title: "shadow.py 三段式锁语义"
title_zh: "shadow.py 三段式锁语义"
status: pending
author: qinyi
created_at: 2026-09-12 22:20:00
goal: "触发链成员行锁等待超时（55P03）优雅降级：无锁快查复用→FOR UPDATE 原样防双建→超时 rollback 重读复用或 4xx 报忙落部分失败收集，消除并发触发 500"
implementation: "改 _ensure_shadow_session 开头锁段：段1 无锁 SELECT（populate_existing）指针已回填且影子非终态直接复用；段2 指针空走既有 FOR UPDATE；段3 try/except DBAPIError 判 orig 为 asyncpg LockNotAvailableError 或 sqlstate==55P03 → rollback → 无锁重读复用或抛 GroupChatInvalid 报忙。asyncpg 不顶层 import（SQLite 环境防 ImportError），按 getattr(orig, sqlstate) 兜底判定。"
target_files:
  - backend/app/modules/daemon/group/service/shadow.py
allowed_paths:
  - backend/app/modules/daemon/group/service/shadow.py
acceptance:
  - grep 可见三段结构与 55P03 双口径判定
  - test_group_direct.py 与 test_group_p2.py 既有用例不回归
verify: "uv run pytest -q --no-cov app/modules/daemon/tests/test_group_direct.py app/modules/daemon/tests/test_group_p2.py"
constraints: "防双建 FOR UPDATE 语义原样保留；不动全局 lock_timeout；不自动重试拿锁"
---
title_zh: "shadow.py 三段式锁语义"
goal: "触发链成员行锁等待超时（55P03）优雅降级：无锁快查复用→FOR UPDATE 原样防双建→超时 rollback 重读复用或 4xx 报忙落部分失败收集，消除并发触发 500"
acceptance:
  - grep 可见三段结构（无锁快查/FOR UPDATE/超时降级）与 55P03 双口径判定
  - test_group_direct.py 与 test_group_p2.py 既有用例不回归

# task-01: shadow.py 三段式锁语义

## 背景

`_ensure_shadow_session`（shadow.py:386）开头对成员行 `SELECT ... FOR UPDATE`（2026-09-02 防双建引入）。并发触发同成员时若对方持锁超 5s（daemon 缺位慢收口），等锁方被 PG 杀（SQLSTATE 55P03），异常无人接 → 请求 500。

## 要求

按 design §2.1 实现三段式：

1. **段1 无锁快查**：SELECT 成员行（populate_existing）→ `shadow_session_id` 已回填且影子非终态 → 直接复用（返回 existing, None）——与既有幂等复用分支同判定。
2. **段2**：指针空 → 既有 FOR UPDATE（原样，防双建）。
3. **段3 超时降级**：段2 抛 DBAPIError 且 `orig` 为 `asyncpg.exceptions.LockNotAvailableError`（或 `sqlstate == '55P03'` 兜底）→ `rollback` → 无锁重读一次：回填 → 复用；未回填 → 抛 `GroupChatInvalid`（「成员「X」正在被触发中，请稍后重发」，details 含 member_id）。

注意：
- import 放函数级或模块级按文件既有风格；asyncpg import 须延迟到异常判定处（SQLite 环境无 asyncpg——测试环境防 ImportError，用 try/except ImportError 或按 `getattr(exc.orig, 'sqlstate', None)` 判定，**不直接 import asyncpg 于模块顶层**……若模块顶层已 import 则沿用）。
- 注释标「2026-09-12-group-trigger-lock-graceful design §2.1」。

## 验收

- grep 可见三段结构；段3 判定双口径（类型 + sqlstate）。
- 既有 test_group_direct.py / test_group_p2.py 相关用例不回归（段1/段2 行为不变）。
