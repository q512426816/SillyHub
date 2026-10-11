---
author: flow-machine-draft
created_at: 2026-10-11T14:47:54.562Z
---
# 设计记录（Design Record）— 2026-10-11-daemon-masked-test-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

drift 门自 2026-10-09 引入起一直在 Test 步前红灯，daemon 测试面从未在 CI 真正跑过——上一变更清偿 drift 后首次执行即暴露 8 例存量失败，三类全部为测试面滞后于有意生产行为：①协议 MSG 计数钉 24 落后于 0b09d1555 新增的 SILLYSPEC_TOMBSTONE_CLEANUP（实 25）；②golden 事件流快照缺 live-token-speed（21eb98d53）新增的 usage.api_duration_ms 产出键（帧 7/15/29 = 500/1100/400）；③mission_worker 兜底代报 6 例拿 pi 当 mcp=false 载体，而 7bd743230（all-engines-mcp-injection task-08，SPIKE-00 实测）已把 pi.caps.mcp 翻 true——daemon 对 pi 停止代报是防双写的有意行为。修法：①计数钉前移 + 来历注释；②快照按实测产出补三键 + 头注记录 + §2 锚点同步；③机制断言原样换 codex 载体（仍 mcp=false）+ 新增 pi 零代报钉子。生产代码零改动。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无生产接口变化。改动限于 2 个测试文件 + 1 个测试 fixture（golden-session.events.json 机器快照补键，非手写业务数据）。daemon 运行时行为以 daemon.ts 既有门控为准（caps.mcp===false 才兜底代报）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   golden 快照的驱动协议本身即乱序场景的锚（partial 中途 flush / override 晚到 / 空白 result 晚到全文补报各有 §1/§4/ql-028 用例钉住），本次只补 usage 键不动帧序/时序结构，时序假设不变。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   兜底代报防双写语义由生产门控保证（mcp=true 不代报 + +90s 探测 artifacts 非空跳过）——新增 pi 零代报钉子正是把该并发防重断言钉进测试面；测试文件本身无并发写。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   不适用——纯测试面同步，无运行态生命周期；409 迟到收敛 / 网络错误容错用例（codex 载体）继续钉住兜底通道的中断安全语义。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   golden-session.events.json 有跨端消费方——backend `app/modules/daemon/tests/test_run_sync_golden_parity.py` 直接消费同一 fixture（monorepo 内跨端共享）——但补键仅落 partial usage，parity 测试两轨共用同一 usage 字典且只比完整帧链路，实跑 5/5 绿证无串扰（独立评审 P3 指正后修正本答）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：pi 翻 mcp=true 后兜底代报的 codex/cursor 载体若未来也翻 true，本测试面将再失载体——届时应按 caps 现状再选载体或改测 caps 注入而非硬编码 provider 名（当前 getProviderCaps 直接读注册表，测试无注入点，故先硬编码）。放弃的方案：把 daemon.ts 门控改回对 pi 也代报（推翻 task-08 SPIKE-00 实测结论，制造双写缺陷——不做）；给 golden 快照写自动再生成脚本（一次性三键补齐用不上专用管线，且驱动协议依赖 vitest fake timers，脚本化收益低于维护成本——手补 + 头注留痕）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | sillyhub-daemon/tests/protocol-session-contract.test.ts | MSG 计数钉 24→25 + 来历注释 |
| 修改 | sillyhub-daemon/tests/fixtures/claude-sdk-messages/golden-session.events.json | 帧 7/15/29 usage 补 api_duration_ms + 头注 |
| 修改 | sillyhub-daemon/tests/interactive/golden/claude-events-golden.test.ts | §2 帧 7/15 锚点同步该键 |
| 修改 | sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts | 载体 pi→codex（9 处）+ pi 零代报新钉 |
