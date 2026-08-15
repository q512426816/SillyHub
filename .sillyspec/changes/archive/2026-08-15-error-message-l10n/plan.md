---
author: qinyi
created_at: 2026-08-15T10:20:00+08:00
change: 2026-08-15-error-message-l10n
project: backend
status: draft
---

# Plan — 后端面向用户报错文案中文化

> author: qinyi
> created_at: 2026-08-15T10:20:00+08:00

依据：`changes/2026-08-15-error-message-l10n/design.md`（Grill 修订版）。
需求对照：FR-01 全部 10 task（W1~W8 逐模块中文化）+task-10 全量验收；FR-02
各 task 文案规范条款（ID 移 details）；FR-03 constraints（code/http_status/
契约零变更，写进每张卡片）；FR-04 范围裁剪（机器接口不在任何 task
allowed_paths）；FR-05 各 task 验证步骤（断言同步+模块 pytest）；FR-06
task-02 守护测试（CJK 断言）+task-10 零豁免验收。
纯文案改写，全部 task 同构：改前 grep 双侧 tests 断言 → 逐处对照上下文改写
（中文短语+行动指引，ID 移 details，HTTPException 仅纯中文字符串）→ 跑模块
pytest → ruff check+format。

## Wave 1 — 全局兜底 + auth 链路 + 守护测试（task-01 / task-02）

- [x] task-01: 全局兜底与 auth 链路文案
  - 文件：backend/app/main.py（Run not found ×6）、backend/app/core/errors.py
    （4 个类默认 message + 2 条 handler 兜底）、backend/app/core/auth_deps.py（7）、
    backend/app/core/security.py（AccessTokenError 4 条）、
    backend/app/modules/auth/service.py（6）、backend/app/modules/auth/router.py（1）
  - 验证：pytest tests/modules/auth tests/core -q（跑实际存在的一侧）+ 全局 grep 断言
- [x] task-02: 守护测试落地（W1 先行，保护后续 Wave）
  - 文件：backend/tests/core/test_error_message_l10n.py（新增）
  - 目录推导+排除清单+文件存在断言+CJK 断言；渐进白名单机制：测试内维护
    PENDING_L10N_FILES 常量（W1 时点=除 task-01 六文件外全部范围内文件，清单内
    文件豁免 CJK 断言防假红），W2~W8 各 Wave 收尾时从 PENDING 划掉本 Wave 文件
    （写进各 task 卡片验收），task-10 验收含 PENDING 清空、守护测试零豁免全绿
  - 验证：pytest tests/core/test_error_message_l10n.py

## Wave 2 — admin 三模块（task-03）

- [x] task-03: admin 文案
  - 文件：backend/app/modules/admin/users_service.py（6，含 :336 dict detail
    预存缺陷顺带修）、organizations_service.py（11）、roles_service.py（10）
  - 验证：pytest app/modules/admin + tests/modules/admin

## Wave 3 — workspace 全家（task-04）

- [x] task-04: workspace 文案
  - 文件：backend/app/modules/workspace/service.py（12）、members_service.py（12）、
    link_service.py（3）、link_router.py（1）、schema.py（2）、
    member_runtimes/service.py（1）
  - 验证：pytest app/modules/workspace tests/modules/workspace

## Wave 4 — change 链路（task-05）

- [x] task-05: change 链路文案
  - 文件：backend/app/modules/change/service.py（6）、dispatch.py（2）、
    router.py（2）、schema.py（1）、backend/app/modules/change_writer/service.py（10）、
    proxy.py（4）、backend/app/modules/task/service.py（1）、
    backend/app/modules/scan_docs/service.py（1）、backend/app/modules/workflow/service.py（2）、
    fsm.py（1）、backend/app/modules/knowledge/service.py（2）
  - 验证：pytest app/modules/change app/modules/change_writer tests/modules/change
    app/modules/task app/modules/workflow app/modules/knowledge

## Wave 5 — spec_workspace + skills_bundle（task-06）

- [x] task-06: spec_workspace 文案
  - 文件：backend/app/modules/spec_workspace/service.py（16）、bootstrap.py（5+1）、
    router.py（1）、backend/app/modules/agent/skills_bundle_service.py（3）
  - 验证：pytest app/modules/spec_workspace tests/modules/spec_workspace（含
    test_bootstrap_provider_model.py 3 处英文断言同步）

## Wave 6 — agent + daemon 用户面（task-07）

- [x] task-07: agent 与 daemon 用户面文案
  - 文件：backend/app/modules/agent/service.py（16）、router.py（8）、
    profile/service.py（9）、backend/app/modules/daemon/router.py 用户面端点（15，
    按 design §2 路径清单：version/instances/machines/runtimes（除 pending-leases）/
    sessions（stream 404 分支）/skills manifest+content；ws 与 llm-proxy 段 2204-2501
    整段排除）
  - 验证：pytest app/modules/agent app/modules/daemon tests/modules/agent
    tests/modules/daemon（含 test_work_dir_strategy.py:237 断言同步）

## Wave 7 — llm_provider + tool/git gateway（task-08）

- [x] task-08: llm_provider 与 tool/git 文案
  - 文件：backend/app/modules/llm_provider/service.py（11）、usage_handlers.py（12）、
    schema.py（2）、backend/app/modules/tool_gateway/service.py（8）、
    backend/app/modules/git_gateway/service.py（10）、
    backend/app/modules/git_identity/service.py（5）
  - 验证：pytest app/modules/llm_provider app/modules/tool_gateway
    app/modules/git_gateway app/modules/git_identity + 各自 tests（git_gateway
    test_dangerous.py 45 处断言同步为最大工作量）

## Wave 8 — ppm + release + incident + mcp（task-09 / task-10）

- [x] task-09: ppm / release / incident / mcp_gateway 文案
  - 文件：backend/app/modules/ppm/{task,kanban,problem,plan}/service.py（8/5/3/2）、
    project/router.py（2）、backend/app/modules/release/service.py（11）、
    backend/app/modules/incident/service.py（7）、
    backend/app/modules/mcp_gateway/router.py（1：McpTokenNotFound）
  - 验证：pytest tests/modules/ppm（496 基线全量回归）+ release/incident/mcp 模块
- [x] task-10: 全量回归 + 模块文档同步 + 收尾
  - backend 全量 pytest + ruff；守护测试 PENDING 清单清空、零豁免全绿确认；
    各模块 .sillyspec/docs/backend/modules/<模块>.md 注意事项补「用户可见错误
    文案中文（2026-08-15-error-message-l10n）」条目
  - 依赖：task-01~09 全部完成

## 依赖关系

- task-02（守护测试）依赖 task-01（先有已改绿的文件集示例）。
- [x] task-10: 依赖全部前序 task（task-01~09）。
- W2~W8（task-03~09）相互无依赖（不同模块文件集，已程序化验证 48 源文件
  零重叠），可并行也可串行。
- pytest 命令统一约定：跑实际存在的一侧（auth/admin/ppm 等仅顶层 tests，
  change_writer/task/workflow/knowledge 等仅模块内 tests）。
