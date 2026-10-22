---
author: flow-machine-draft
created_at: 2026-10-22T23:34:31.713Z
---
# 设计记录（Design Record）— 2026-10-23-translate-budget-align

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

三处独立小修，均只动翻译模块，不改对外协议：

1. **前端超时动态化**（`frontend/src/lib/thinking-translate.ts`）：删固定 `REQUEST_TIMEOUT_MS = 20_000`，改为 `requestTimeoutMsFor(entries)`——按「最坏后端块数」镜像后端 `engine._timeout_for` 公式（基准 20s + 每块 2.5s）再外加 5s HTTP/排队余量。后端块数估算：前端块 ≤1800 字符，后端 `chunking.CHUNK_MAX_CHARS=1000` 二次细切，每条前端块 ≤ `ceil(len/1000)` 个后端块。满批 16×1800 最坏 32 块 → 后端预算 97.5s → 前端兜底 102.5s（有界，防挂起性质保留）。选此方案而非收紧后端预算：e7ce2a101 的线性放宽是生产实测（16×1000 满批 21.5s>20s）驱动的正确修复，应保住它、让前端等待侧跟上，反向收紧会重新引入误杀。
2. **service.py 回填两段式**（`backend/app/modules/translate/service.py`）：扫描期缓存命中不再即时 `_fill_chunk`，改为「全体块（含命中块）按产生顺序入 `chunk_owners` 总账 + 命中译文暂存 `resolved` 字典」，推理成功后与推理译文合并，**按 `chunk_owners` 全序一次回填**——段内块序与原文一致。引擎失败路径不变（提前原文透传返回，已解析结果作废）。
3. **engine.py 读线程捕获队列**（`backend/app/modules/translate/engine.py`）：`_ensure_started` 先建局部 `responses` 队列，作参数传给 `_reader` 线程（构造时捕获），再赋给 `self._responses`——崩溃重启换新队列后，旧读线程的 EOF 哨兵/迟到响应只落入已废弃旧队列，不再污染新队列触发"translate worker exited"/"protocol mismatch"假崩溃。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 前端 `thinking-translate.ts`：新增导出 `requestTimeoutMsFor(entries: Array<{ chunk: string }>): number`（测试直测公式）；`apiFetch` 调用的 `timeoutMs` 从常量改为该函数返回值。无端点/请求体变化。
- 后端 `service.py`：`translate_items` 签名与返回结构零变化；内部新增 `resolved`/`pending_owner_positions` 局部结构；`_fill_chunk` 私有函数签名不变（docstring 修正）。
- 后端 `engine.py`：`_reader` 私有方法签名 `(stdout)` → `(stdout, responses)`（纯内部）；`TranslateSubprocessProxy` 对外接口（`translate`/`available`/`close`）零变化。
- HTTP 契约、schema、配置项：无新增无变更。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   修复 2 正是乱序问题本身——缓存块与推理块到达时机不同，总账+全序回填使到达顺序与拼装顺序解耦，「块序=产生序」由数据结构保证而非时序保证。修复 3 处理旧子进程迟到 EOF/响应：落入旧队列（无人读）自然作废，`resp.get("id") != rid` 校验仍是第二道防线。修复 1 中前端超时只依赖本批静态字符数，与时序无关。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   `service.translate_items` 内 `resolved`/`chunk_owners` 均为单次协程调用局部变量，无共享；LRU 已有 `_lru_lock`（不动）。`engine._responses` 的写者（读线程）与读者（translate）本就通过队列线程安全通信；修复 3 只改变写者绑定哪个队列实例，锁语义不变（`translate` 全程持 `self._lock`，`_ensure_started` 仅在锁内调用）。前端合批队列仍为模块单线程（事件循环）驱动，无并发写面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   引擎崩溃/退避中途：修复 2 走既有 fail-soft 提前返回，未回填的 `resolved` 直接丢弃（与现状「已填缓存块也回退」同口径）；修复 3 中旧读线程为 daemon 线程，进程退出不受阻，旧队列随引用消失回收。前端请求超时/页面卸载：apiFetch abort 既有降级链不变，动态超时只是拉长兜底上限不改变失败语义。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   三处改动均为进程内逻辑，无工作区/仓维度状态；缓存 key 仍按 `target+text` 哈希（不改），跨实例共享 Redis 缓存语义不变。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：修复 1 的「最坏块数」估算通常精确（前端单段块按 1800 硬切、`ceil(len/1000)` 是其上界），但**保护段碎裂**（单块内多个 <1000 可译 run 被保护段隔开，块数超 `ceil(len/1000)`）或长句贪心装箱形态下可能低估 >2 块——此时后端预算反超前端死线，前端先 abort（回退原文 + 60s 退避），重现 FR-01 要消除的误杀形态。降级边界已裁决：可接受——HTTP 断开不触发后端 `_on_crash`（不累计崩溃计数/不进 600s 退避），后端线程照常完成推理并写双层缓存，退避期满重试即命中缓存恢复；触发需单条内 ≥3 个保护段的罕见碎裂。修复 2 的风险是重构 `translate_items` 主编排引入回归——用既有 12 个 service 用例 + 新增乱序用例钉死全等断言。修复 3 改 `_reader` 签名是内部私有面，风险低。

放弃的方案：①后端预算封顶 20s 并缩批——放弃，直接推翻 e7ce2a101 的生产实测结论，重新引入满批误杀；②前端按「条数」而非「估算后端块数」算超时——放弃，前端块 1800>后端 1000，16 条最多膨胀 32 块，按条数算（57.5s）仍会被 97.5s 预算的后端合法超出；③engine `_stop` join 读线程——放弃，Windows 管道 EOF 交付时机不可控，join 可能阻塞崩溃恢复路径，队列构造时捕获以零等待达成同一隔离。
