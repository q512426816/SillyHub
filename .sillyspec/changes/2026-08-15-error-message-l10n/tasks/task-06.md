---
id: "task-06"
title: "spec_workspace + skills_bundle 文案"
title_zh: "spec_workspace + skills_bundle 文案"
status: "pending"
goal: "spec_workspace 16+5+1 / skills_bundle 3 共 25 处改中文。test_bootstrap_provider_model.py :315/:328/:341 断言同步。"
implementation: "逐文件扫描 → 改写 → 断言同步 → pytest app/modules/spec_workspace → ruff → PENDING 划掉 4 文件。"
acceptance: [模块 pytest 全绿, ruff 过, PENDING 划除 4 文件]
verify: "ruff"
constraints: [文案范式：中文短语+行动指引，ID 移 details, code/http_status/契约零变更, 只改 allowed_paths 内文件]
allowed_paths: [backend/app/modules/spec_workspace/service.py, backend/app/modules/spec_workspace/bootstrap.py, backend/app/modules/spec_workspace/router.py, backend/app/modules/agent/skills_bundle_service.py, backend/app/modules/spec_workspace/tests/test_bootstrap_provider_model.py]
---

# task-06 spec_workspace + skills_bundle 文案

> spec_workspace 16+5+1 / skills_bundle 3 共 25 处改中文。test_bootstrap_provider_model.py :315/:328/:341 断言同步。

## 验收标准

- 模块 pytest 全绿
- ruff 过
- PENDING 划除 4 文件

## 验证

逐文件扫描 → 改写 → 断言同步 → pytest app/modules/spec_workspace → ruff → PENDING 划掉 4 文件。
