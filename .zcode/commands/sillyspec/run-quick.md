---
name: sillyspec:run-quick
description: 已退役重定向 — quick 通道已拒绝新会话（v3.31.0 起），小修补请用 /sillyspec:flow
---
# 通道已退役

quick 通道已于 v3.31.0 直接退役：`sillyspec run quick` 对新会话一律拒绝（exit 1 并指路 flow start）。本卡只保留触发词重定向，勿执行任何 quick 新会话命令。

范围明确的小修补请走**轻量变更**（/sillyspec:flow）：

```bash
sillyspec flow start --change <变更名> --input "<动机与背景>

成功标准：
- <可验证标准>"
# → 直接干活（改代码写测试，治理工件 CLI 机器起草）
sillyspec flow done --change <变更名>
```

升级前遗留的在途 quick 会话仍可收尾：`sillyspec run quick --change <会话ID>` 续跑 / `--done` 收口 / `--cancel` 取消（以 CLI 拒绝文案里的指引为准）。
<!-- sillyspec-card: v3.32.0 sha256=512895e8d003f20934c2e9128e59d1d0f07a5f9cc036fc53d4b697cadfa31b02 -->
