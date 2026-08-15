---
id: "task-02"
title: "守护测试落地"
title_zh: "守护测试落地"
status: "pending"
goal: "新建 tests/core/test_error_message_l10n.py：目录推导（app/modules 下 router*/service*.py）+排除清单（daemon 内部 RPC 子包/mcp tools,server,sse/platform_sync/core 启动期）+文件存在断言+raise message 字面量含 CJK 断言。PENDING_L10N_FILES 常量渐进白名单（W1 时点=除 task-01 六文件外全部范围文件）。"
implementation: "写测试 → 本机跑绿（task-01 六文件已中文化）→ 确认 PENDING 豁免生效。"
acceptance: [pytest tests/core/test_error_message_l10n.py 绿, PENDING 清单=剩余范围文件, 清单文件存在断言通过]
verify: "写测试"
constraints: [文案范式：中文短语+行动指引，ID 移 details, code/http_status/契约零变更, 只改 allowed_paths 内文件]
allowed_paths: [backend/tests/core/test_error_message_l10n.py]
---

# task-02 守护测试落地

> 新建 tests/core/test_error_message_l10n.py：目录推导（app/modules 下 router*/service*.py）+排除清单（daemon 内部 RPC 子包/mcp tools,server,sse/platform_sync/core 启动期）+文件存在断言+raise message 字面量含 CJK 断言。PENDING_L10N_FILES 常量渐进白名单（W1 时点=除 task-01 六文件外全部范围文件）。

## 验收标准

- pytest tests/core/test_error_message_l10n.py 绿
- PENDING 清单=剩余范围文件
- 清单文件存在断言通过

## 验证

写测试 → 本机跑绿（task-01 六文件已中文化）→ 确认 PENDING 豁免生效。
