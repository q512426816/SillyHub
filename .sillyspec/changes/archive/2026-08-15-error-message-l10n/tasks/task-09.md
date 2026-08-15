---
id: "task-09"
title: "ppm/release/incident/mcp 文案"
title_zh: "ppm/release/incident/mcp 文案"
status: "pending"
goal: "ppm 8/5/3/2/2（上线模块 496 基线全量回归）/ release 11 / incident 7 / mcp_gateway/router.py 仅 McpTokenNotFound 共 38 处改中文。"
implementation: "逐文件扫描 → 改写 → 断言同步 → pytest tests/modules/ppm + release/incident/mcp 模块 → ruff → PENDING 划掉 8 文件。"
acceptance: [ppm 496 基线全绿, 各模块 pytest 绿, ruff 过, PENDING 划除 8 文件]
verify: "ruff"
constraints: [文案范式：中文短语+行动指引，ID 移 details, code/http_status/契约零变更, 只改 allowed_paths 内文件]
allowed_paths: [backend/app/modules/ppm/task/service.py, backend/app/modules/ppm/kanban/service.py, backend/app/modules/ppm/problem/service.py, backend/app/modules/ppm/plan/service.py, backend/app/modules/ppm/project/router.py, backend/app/modules/release/service.py, backend/app/modules/incident/service.py, backend/app/modules/mcp_gateway/router.py]
---

# task-09 ppm/release/incident/mcp 文案

> ppm 8/5/3/2/2（上线模块 496 基线全量回归）/ release 11 / incident 7 / mcp_gateway/router.py 仅 McpTokenNotFound 共 38 处改中文。

## 验收标准

- ppm 496 基线全绿
- 各模块 pytest 绿
- ruff 过
- PENDING 划除 8 文件

## 验证

逐文件扫描 → 改写 → 断言同步 → pytest tests/modules/ppm + release/incident/mcp 模块 → ruff → PENDING 划掉 8 文件。
