---
id: "task-10"
title: "全量回归+文档同步收尾"
title_zh: "全量回归+文档同步收尾"
status: "pending"
goal: "backend 全量 pytest + ruff；守护测试 PENDING 清空零豁免；各改动模块文档注意事项补条目；对照 design.md 验收。"
implementation: "全量 pytest → 守护测试确认 → 文档条目 → design 验收对账。"
acceptance: [backend 全量 pytest 绿, 守护测试零豁免, 模块文档条目落盘, ruff 过]
verify: "文档条目"
constraints: [文案范式：中文短语+行动指引，ID 移 details, code/http_status/契约零变更, 只改 allowed_paths 内文件]
allowed_paths: [backend/tests/core/test_error_message_l10n.py, .sillyspec/docs/backend/modules]
---

# task-10 全量回归+文档同步收尾

> backend 全量 pytest + ruff；守护测试 PENDING 清空零豁免；各改动模块文档注意事项补条目；对照 design.md 验收。

## 验收标准

- backend 全量 pytest 绿
- 守护测试零豁免
- 模块文档条目落盘
- ruff 过

## 验证

全量 pytest → 守护测试确认 → 文档条目 → design 验收对账。
