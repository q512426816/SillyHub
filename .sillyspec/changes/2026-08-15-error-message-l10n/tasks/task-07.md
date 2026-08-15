---
id: "task-07"
title: "agent + daemon 用户面文案"
title_zh: "agent + daemon 用户面文案"
status: "pending"
goal: "agent service 16 / router 8 / profile 9；daemon/router.py 用户面白名单路径（version/instances/machines/runtimes 除 pending-leases/sessions stream 404/skills manifest+bundle+content），llm-proxy 注释锚点到 ws 整段排除，默认不在白名单不改。test_work_dir_strategy.py:237 断言同步。"
implementation: "逐文件扫描 → daemon 按白名单判定 → 改写 → 断言同步 → pytest app/modules/agent app/modules/daemon tests/modules/agent tests/modules/daemon → ruff → PENDING 划掉 4 文件。"
acceptance: [模块 pytest 全绿, ruff 过, PENDING 划除 4 文件, daemon/router.py 排除段零改动]
verify: "ruff"
constraints: [文案范式：中文短语+行动指引，ID 移 details, code/http_status/契约零变更, 只改 allowed_paths 内文件]
allowed_paths: [backend/app/modules/agent/service.py, backend/app/modules/agent/router.py, backend/app/modules/agent/profile/service.py, backend/app/modules/daemon/router.py, backend/tests/modules/agent/test_work_dir_strategy.py]
---

# task-07 agent + daemon 用户面文案

> agent service 16 / router 8 / profile 9；daemon/router.py 用户面白名单路径（version/instances/machines/runtimes 除 pending-leases/sessions stream 404/skills manifest+bundle+content），llm-proxy 注释锚点到 ws 整段排除，默认不在白名单不改。test_work_dir_strategy.py:237 断言同步。

## 验收标准

- 模块 pytest 全绿
- ruff 过
- PENDING 划除 4 文件
- daemon/router.py 排除段零改动

## 验证

逐文件扫描 → daemon 按白名单判定 → 改写 → 断言同步 → pytest app/modules/agent app/modules/daemon tests/modules/agent tests/modules/daemon → ruff → PENDING 划掉 4 文件。
