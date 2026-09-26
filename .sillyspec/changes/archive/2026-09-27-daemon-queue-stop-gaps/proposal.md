---
author: flow-machine-draft
created_at: 2026-09-26T23:16:33.959Z
---
# 提案书（Proposal）— 2026-09-27-daemon-queue-stop-gaps

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:6c37f7fe1f4001dc19fcf190d26359e98fe4815898b8cfdcf28c2f2f706a8982:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-daemon-queue-stop-gaps 留痕重锚 -->
任务原话转写：24h 只读审查实证两个 daemon 生命周期缺口：①FIFO 命令队列升级等待轮询无总预算——deferred 升级遇长忙会话无界滞留时首条命令永不执行，整条队列楔死且结果槽永不落，平台侧收不到任何终态；②daemon 停机不清 hits 周期上行定时器——同进程 stop→start 会叠加 interval，停机后到进程退出的窗口内仍触发上行。

成功标准：
- 排队命令等待升级链有总预算上限（5 分钟），超预算后当前命令记 failed 结果槽（含可重试提示的错误文案）并放行队列后续命令，不再永久排队
- 升级链在预算内结束的既有行为不变：命令照常执行、无 failed 槽
- daemon 停机（_stopInternal）停止并置空 hits 周期上行器实例，重复停机不炸
- 新增测试：超预算记 failed 槽且队列放行（fake timers 推进总预算）、预算内结束照常执行、_stopInternal 清周期器与幂等
- 既有聚焦测试全绿 + tsc 0 错
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:8c3caf3cff1769a262206052b96c7d04301f73bc2bf1dc6d1e6fd0ed1bd4320b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-daemon-queue-stop-gaps 留痕重锚 -->
按成功标准机械推导，共 5 条验收面：
1. 排队命令等待升级链有总预算上限（5 分钟），超预算后当前命令记 failed 结果槽（含可重试提示的错误文案）并放行队列后续命令，不再永久排队
2. 升级链在预算内结束的既有行为不变：命令照常执行、无 failed 槽
3. daemon 停机（_stopInternal）停止并置空 hits 周期上行器实例，重复停机不炸
4. 新增测试：超预算记 failed 槽且队列放行（fake timers 推进总预算）、预算内结束照常执行、_stopInternal 清周期器与幂等
5. 既有聚焦测试全绿 + tsc 0 错
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:83b54bc5769640fb4068091999ff1a10b63c509a81a2f74637cf13ae01d52ae5:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-daemon-queue-stop-gaps 留痕重锚 -->
1. 排队命令等待升级链有总预算上限（5 分钟），超预算后当前命令记 failed 结果槽（含可重试提示的错误文案）并放行队列后续命令，不再永久排队
2. 升级链在预算内结束的既有行为不变：命令照常执行、无 failed 槽
3. daemon 停机（_stopInternal）停止并置空 hits 周期上行器实例，重复停机不炸
4. 新增测试：超预算记 failed 槽且队列放行（fake timers 推进总预算）、预算内结束照常执行、_stopInternal 清周期器与幂等
5. 既有聚焦测试全绿 + tsc 0 错
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
