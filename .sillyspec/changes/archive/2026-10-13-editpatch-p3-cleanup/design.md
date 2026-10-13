---
author: flow-machine-draft
created_at: 2026-10-13T04:40:11.707Z
---
# 设计记录（Design Record）— 2026-10-13-editpatch-p3-cleanup

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

收编 editpatch-fullchain 评审 P3 两条：①daemon `EDIT_PATCH_MAX_CHARS` 常量改名 `EDIT_PATCH_MAX_BYTES`（数值 64_000 不变），判定从 `json.length`（UTF-16 字符数）改为 `Buffer.byteLength(json, 'utf8')`——与同文件 20MB 内容预算的既有字节口径对齐，CJK patch（每字符 3 字节）不再被字符计低估体积误附着；②frontend agent-log-card 测试补一条真实渲染路径的直连断言（messages 夹具 tool_result 带 edit_patch → 渲染后断言 Write 卡变更对比 diff 区），补齐装配接线防回归覆盖。

改动面：daemon 解析器一常量一判定行 + 两端测试各一用例，无契约/schema 生成物变化。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- daemon：模块私有常量改名（EDIT_PATCH_MAX_CHARS → EDIT_PATCH_MAX_BYTES）与判定口径变化（字符 → UTF-8 字节），`extractEditPatch` 内部函数签名不变；对外行为变化仅一处——字符数 <64 000 而 UTF-8 字节 >64 000 的 patch 从「误附着」变为「不附着」（这正是本变更目的；旧口径下附着的 CJK 超限 patch 本身是完整可解析 JSON，但体积超披露边界，消费端此前无保护）。
- frontend：仅新增测试用例，零源码变化。端点/命令/文件格式：无。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。字节计是单行自包含判定（同一载体行内完成），不引入跨行状态；前端直连用例沿既有 tool_use_id Map 配对，与到达顺序无关。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   不适用：daemon 解析器纯函数无写面；frontend 改动仅在测试文件，无共享状态。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。判定随单行解析完成即终结；无持久状态、无生命周期挂载面（测试内渲染随用例销毁）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。判定与断言均为单条日志行/单卡片自包含，无跨工作区/跨仓数据流。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

风险极低：判定收紧只会让更多超大 patch 走既有的无 patch 回退（前端 parseStructuredPatch 遇非法/超大本就回退全文/两块展示），不存在数据正确性风险；Buffer 在 daemon Node 运行时可用（同文件 20MB 预算先例）。

放弃的方案：(a) 把上限常量同步调大（如 256KB）——评审 P3 指向的是计量口径错误而非阈值大小，64KB 是上变更刚定的披露边界，无新证据不改阈值；(b) 用 TextEncoder 手算字节数——Buffer.byteLength 是同文件既有口径且更直接，放弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts | 常量改名 EDIT_PATCH_MAX_BYTES + Buffer.byteLength 字节判定 + 注释收编标注 |
| 修改 | sillyhub-daemon/tests/agent-log/parse-claude-code.test.ts | CJK 字节超限/字节内附着双断言用例 |
| 修改 | frontend/src/components/daemon/__tests__/agent-log-card.test.tsx | edit_patch 直连透传断言用例（Write 卡 diff 渲染） |
