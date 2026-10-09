---
author: flow-machine-draft
created_at: 2026-10-08T09:09:36.618Z
---
# 决策记录（Decisions）— 2026-10-08-gov-action-stderr-noise

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：正则误伤真实错误行。缓解——只匹配行首严格形态 `^\(node:\d+\) \w+Warning` 与 ``^\(Use `node --trace-warnings``（实测 CLI 噪声逐字）， 真实 CLI 报错文案不以这两种形态开头。放弃的方案：给子进程注入 `NODE_OPTIONS=--no-warnings`——会静默压制 CLI 所有告警（含未来可能有价值的）， 且改的 spawn 环境面大于必要面；前端展示头 160 字符代替尾 160——CLI 结果摘要（含 条目 ID 清单）在输出尾部，取头会丢信息。
