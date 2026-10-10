---
author: flow-machine-draft
created_at: 2026-10-10T14:20:41.194Z
---
# 决策记录（Decisions）— 2026-10-10-task-wakeup-quiet-threshold

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-10-task-wakeup-quiet-threshold 留痕重锚 --> <!-- MACHINE-DRAFT:design-risks:end --> 最大风险：60 秒门槛把「中等时长但有汇报价值」的后台任务（如 30-50s 的检查类任务）也 静默了。接受理由：主代理仍可 TaskOutput 主动取结果，终态行/emit 都在，信息不丢，只是 不再强迫打断；常量单点可调，后续按体验收紧/放宽是一行改动。次要风险：既有唤醒用例 夹具 20-21s 低于新门槛，需同步上调（行为规格变更的正常适配，已在 FR-03 声明，非躲败）。 试过但放弃的方案：①按 subagent_type/depth 判孙任务不冒泡——SDK task 事件 metadata 无层级信号（孙任务与主代理亲派任务同形），只能靠 `_agentToolUseMeta` 猜测， 误判面大，放弃（转 FR-04 留待 spike）；②把 debounce 2s 拉长到 15s+——只合并同时窗 口内的风暴，实证通知间隔 15-100s，合并不到一起，治标不治本；③前端把排队栏系统通知 折叠展示——不动噪音源头，纯遮羞，且门槛落地后队列里几乎不会再出现通知，收益消失。
