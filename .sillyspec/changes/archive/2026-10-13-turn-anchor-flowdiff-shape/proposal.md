---
author: flow-machine-draft
created_at: 2026-10-13T15:46:23.343Z
---
# 提案书（Proposal）— 2026-10-13-turn-anchor-flowdiff-shape

## 动机

任务原话转写：动机：daemon 轮锚 JSONL 与 sillyspec flow diff 的消费契约未对齐（turn-anchor.ts 头注留档的后续切片）——轮锚记录 files 数组已与 flow diff rows 同风格，但缺 totals 且无统一投影口；平台后续消费方要同时吃轮粒度与变更粒度就得写两套解析。修法（additive 零破坏）：TurnAnchorRecord 增 totals 字段（files 数与行数加总，null 行不计入——与 flow diff totals 同语义），落盘时计算；导出 toFlowDiffShape 纯函数把记录投影为 flow diff 消费契约形状，轮粒度行无 state 字段（变更粒度三源区分在轮锚天然不存在）。

成功标准：
- TurnAnchorRecord 新增 totals：files 行数与 additions/deletions 加总（null 不计入），落盘记录携带，既有七用例零改动全绿
- toFlowDiffShape 导出纯函数：输入记录返回 rows 与 totals（rows=files 原样，totals 同上语义），可直测
- typecheck 绿；新用例覆盖 totals 计算（含 null 行）与投影形状
- 不改 JSONL 既有字段与追加格式（additive：旧读者忽略新字段）

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. TurnAnchorRecord 新增 totals：files 行数与 additions/deletions 加总（null 不计入），落盘记录携带，既有七用例零改动全绿
2. toFlowDiffShape 导出纯函数：输入记录返回 rows 与 totals（rows=files 原样，totals 同上语义），可直测
3. typecheck 绿；新用例覆盖 totals 计算（含 null 行）与投影形状
4. 不改 JSONL 既有字段与追加格式（additive：旧读者忽略新字段）

## 成功标准（可验证）

1. TurnAnchorRecord 新增 totals：files 行数与 additions/deletions 加总（null 不计入），落盘记录携带，既有七用例零改动全绿
2. toFlowDiffShape 导出纯函数：输入记录返回 rows 与 totals（rows=files 原样，totals 同上语义），可直测
3. typecheck 绿；新用例覆盖 totals 计算（含 null 行）与投影形状
4. 不改 JSONL 既有字段与追加格式（additive：旧读者忽略新字段）
