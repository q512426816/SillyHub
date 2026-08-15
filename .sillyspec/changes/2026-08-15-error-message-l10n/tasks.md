---
author: qinyi
created_at: 2026-08-15T10:05:00+08:00
change: 2026-08-15-error-message-l10n
project: backend
status: draft
---

# Tasks — 后端面向用户报错文案中文化

> author: qinyi
> created_at: 2026-08-15T10:05:00+08:00

> tasks 清单由 plan 阶段细化（Wave 分组 / 依赖排序）；此处为 brainstorm 占位骨架。

- task-01 Wave1 全局兜底与 auth 链路（main.py / errors.py / core/security.py / auth_deps / auth）
- task-02 Wave2 admin 三模块（users / organizations / roles）
- task-03 Wave3 workspace 全家（service / members / link / schema / member_runtimes）
- task-04 Wave4 change 链路（change / change_writer / task / scan_docs / workflow / knowledge）
- task-05 Wave5 spec_workspace（service / bootstrap / router）+ skills_bundle
- task-06 Wave6 agent（service / router / profile）+ daemon/router.py 用户面
- task-07 Wave7 llm_provider + tool_gateway + git_gateway + git_identity
- task-08 Wave8 ppm 全家 + release + incident + mcp_gateway/router.py
- task-09 守护测试 test_error_message_l10n.py（目录推导+排除清单+CJK 断言）
- task-10 全量回归（backend pytest 全量 + ppm 496 基线）+ 模块文档同步
