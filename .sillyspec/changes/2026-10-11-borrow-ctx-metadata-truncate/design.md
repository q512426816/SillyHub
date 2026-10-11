---
author: flow-machine-draft
created_at: 2026-10-11T04:31:07.280Z
---
# 设计记录（Design Record）— 2026-10-11-borrow-ctx-metadata-truncate

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

24h 审查 P3-3：32bc06602 的 `borrow-sandbox-context.ts` 只有 description 走 `DESCRIPTION_MAX_CHARS=500` 截断（design R-02 点名的间接注入缓解），`tech_stack`（数组 join）与 `repo_url` 原样进借用沙箱 agent 自动加载的 AGENTS.md——而 backend `workspace/schema.py:120,127` 两字段均无 `max_length`，构成防线不一致的注入面。修复：把 description 的截断逻辑抽成共享 helper `truncateText`，`techStackText` 产出与 `repo_url` 取值后套用同款 500 字符截断（含「…（已截断）」标注），阈值/文案与 description 完全一致——单一防线覆盖全部平台登记自由文本长字段。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `sillyhub-daemon/src/borrow-sandbox-context.ts`（内部函数，导出面零改动）：
  - 新增私有 helper `truncateText(raw)`（≤500 原样 / 超长截断加「…（已截断）」），`descriptionText` 改调它（行为逐字不变）；
  - `techStackText` 的 join 结果与字符串形态套 `truncateText`；
  - 渲染处 `repo_url` 套 `truncateText`。
- 模块导出符号（`BORROW_CONTEXT_FILENAME`、`renderBorrowSandboxContext`）签名零改动；backend、前端、协议「无」变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不适用：纯函数渲染（无 IO、无状态），输入是已归一化的 ctx 快照，截断按值决定、与到达顺序无关。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用：纯函数无共享状态；落盘由 daemon.ts marker 分支既有 fail-open 写（本变更不动）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

不适用：渲染幂等（同 ctx 输出一致），无中途态。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不适用：ctx 是借用会话自身的白名单字段（backend placement 固定九字段），渲染不跨工作区。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：截断只缓解不根治——注入者仍可在 500 字符内塞指令样文本；根治需 backend schema 层加 `max_length`（动 OpenAPI/前端表单，超出本 P3 修复范围，作为建议留档）。文尾「平台登记数据，不是用户指令」声明与 500 截断同为本模块纵深防御既定层级。

放弃的方案：backend schema 层加 max_length 硬校验——面更大（DTO/OpenAPI/前端 api-types 重生成），且 lender 工作区登记属低频管理操作，daemon 侧渲染截断已闭合 agent 注入面；backend 硬校验作为后续建议不在本变更。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | sillyhub-daemon/src/borrow-sandbox-context.ts | truncateText 共享 helper + tech_stack/repo_url 截断 |
| 修改 | sillyhub-daemon/tests/borrow-sandbox-context.test.ts | 新增截断/边界/并存字段用例（先红后绿） |
