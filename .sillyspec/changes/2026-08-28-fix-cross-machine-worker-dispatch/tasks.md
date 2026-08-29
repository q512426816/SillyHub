---
author: WhaleFall
created_at: 2026-08-28 15:32:40
---

# 任务清单（Tasks）

- [x] task-01: 双源同序全序——queries.py 两函数补 ORDER BY（实例心跳 DESC, daemon_id ASC）
- [x] task-02: placement.py allowed_roots 预检 helper（fetch_daemon_allowed_roots + path_definitively_outside_roots）
- [x] task-03: mcp_tools 选机唯一钉定 + 两段式 provider 预检 + A3 越界 400 接线（depends_on: task-01,02）
- [x] task-04: backend 测试——:736 重写绑定钉定、test_representative_binding.py:124 全序涟漪更新、A3 三形态+边界包含子句、A1 两段式、双源同序、存量回归（depends_on: task-03）
- [x] task-05: daemon 守卫纯函数 interactive-cwd-guard.ts + vitest 三形态×双 OS
- [x] task-06: daemon.ts 认领段接线——truthy 分支 + stat/白名单终检 + notifyRunResult 拒绝不 mkdir（depends_on: task-05）
- [x] task-07: 全链路回归——backend 测试子集 + ruff + daemon typecheck/vitest + 存量行为确认（depends_on: task-04,06）
