---
author: qinyi
created_at: 2026-08-15T10:45:00+08:00
change: 2026-08-15-error-message-l10n
project: backend
---

# 模块影响分析 — 2026-08-15-error-message-l10n

> author: qinyi
> created_at: 2026-08-15T10:45:00+08:00

## 影响面总览

纯报错文案改写（raise message 字符串），不改任何逻辑/schema/契约。影响
55 个源文件，横跨 15+ 模块；每模块影响性质相同：message 中文化 + 技术 ID
从 message 移 details（个别 HTTPException 迁 AppError 形态）。

## 受影响模块清单

| 模块 | 文件数 | 影响 | 回归方式 |
|---|---|---|---|
| core（全局兜底） | 4 | main.py/errors.py/auth_deps/security.py 文案；errors.py 4 类默认 message | tests/core + tests/modules/auth |
| auth | 2 | service/router 文案 | tests/modules/auth |
| admin | 3 | users/org/roles 文案；users:336 dict detail 迁 AppError | tests/modules/admin |
| workspace | 6 | service/members/link/schema/member_runtimes 文案 | 双侧 tests |
| change + change_writer | 7 | service/dispatch/router/schema 文案 | tests/modules/change + 模块内 |
| task/scan_docs/workflow/knowledge | 5 | 零星文案 | 模块内 tests |
| spec_workspace | 3 | service/bootstrap/router 文案 | 模块内 tests（含 bootstrap 断言同步） |
| agent | 4 | service/router/profile/skills_bundle 文案 | 双侧 tests |
| daemon（仅 router 用户面） | 1 | 白名单路径文案；排除段零改动 | 双侧 tests |
| llm_provider | 3 | service/usage_handlers/schema 文案 | 模块内 tests |
| tool_gateway / git_gateway / git_identity | 3 | service 文案；git 断言波及最大 | 模块内 tests |
| ppm（已上线） | 5 | task/kanban/problem/plan/project 文案 | tests/modules/ppm 496 基线全量 |
| release / incident / mcp_gateway | 3 | service 文案；mcp 仅 McpTokenNotFound | 模块内 tests |
| tests（新增） | 1 | 守护测试 test_error_message_l10n.py | 自身 |

## 模块文档同步

task-10 收尾时在上述各模块 .sillyspec/docs/backend/modules/<模块>.md 注意事项
补「用户可见错误文案中文（2026-08-15-error-message-l10n）」条目。

## 不受影响

- daemon 内部 RPC 子包、mcp_gateway tools/server/sse、platform_sync、core
  启动期文件：零改动。
- 前端全部文件：零改动（err.message 透传链路天然兼容中文字符串）。
- 数据库 schema / migration / openapi.json / api-types.ts：零改动。
