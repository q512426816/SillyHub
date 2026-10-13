---
author: flow-machine-draft
created_at: 2026-10-13T04:48:30.271Z
---
# 决策记录（Decisions）— 2026-10-13-editpatch-p3-cleanup

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：风险极低：判定收紧只会让更多超大 patch 走既有的无 patch 回退（前端 parseStructuredPatch 遇非法/超大本就回退全文/两块展示），不存在数据正确性风险；Buffer 在 daemon Node 运行时可用（同文件 20MB 预算先例）。 放弃的方案：(a) 把上限常量同步调大（如 256KB）——评审 P3 指向的是计量口径错误而非阈值大小，64KB 是上变更刚定的披露边界，无新证据不改阈值；(b) 用 TextEncoder 手算字节数——Buffer.byteLength 是同文件既有口径且更直接，放弃。
