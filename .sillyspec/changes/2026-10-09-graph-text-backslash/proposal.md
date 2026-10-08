---
author: flow-machine-draft
created_at: 2026-10-08T23:56:44.670Z
---
# 提案书（Proposal）— 2026-10-09-graph-text-backslash

## 动机

任务原话转写：动机：24 小时风险审查实证 runtime-handler.ts GRAPH_TEXT_BLACKLIST_RE 字符集缺反斜杠——anchor 以反斜杠结尾时拼串的闭合引号被转义，POSIX shell 下吞并后续旗标进锚点参数；因命令分隔符均已在黑名单内无注入面，后果限于 CLI 报错回 internal（参数粘连），属消毒面加固。

成功标准：
- GRAPH_TEXT_BLACKLIST_RE 字符集补 \（反斜杠），注释同步更新
- 含反斜杠的 anchor/anchor2/search 被 validation_rejected（先红后绿用例钉住）
- 既有 daemon 相关测试保持绿，tsc 0

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. GRAPH_TEXT_BLACKLIST_RE 字符集补 \（反斜杠），注释同步更新
2. 含反斜杠的 anchor/anchor2/search 被 validation_rejected（先红后绿用例钉住）
3. 既有 daemon 相关测试保持绿，tsc 0

## 成功标准（可验证）

1. GRAPH_TEXT_BLACKLIST_RE 字符集补 \（反斜杠），注释同步更新
2. 含反斜杠的 anchor/anchor2/search 被 validation_rejected（先红后绿用例钉住）
3. 既有 daemon 相关测试保持绿，tsc 0
