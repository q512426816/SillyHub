---
author: flow-machine-draft
created_at: 2026-10-18T07:57:48.340Z
---
# 决策记录（Decisions）— 2026-10-18-audit-log-redact-yaml-quote

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：userinfo 打码正则漏形态。正则取 `scheme://` 后不含 `/`、`@`、空白的第一段为 userinfo（覆盖 `user` 与 `user:pass`）；用户名含 URL 编码 `%40` 时不匹配、原样输出——残余暴露面收窄但未归零（与 KEY/TOKEN 整值红action 的严格度差异在函数注释声明）。已放弃方案：a) PROXY 键整值 `<redacted>`——丢 host 诊断价值，与该日志存留目的冲突；b) YAML 双引号 + JSON.stringify 转义——对控制字符更严但转义面大，无需求支撑。
