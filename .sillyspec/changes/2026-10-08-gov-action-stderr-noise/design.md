---
author: flow-machine-draft
created_at: 2026-10-08T09:02:41.497Z
---
# 设计记录（Design Record）— 2026-10-08-gov-action-stderr-noise

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

知识信号卡「一键修复路径」的完成提示被 Node SQLite ExperimentalWarning 淹没：daemon
`KnowledgeGovernanceHandler.action()` 把 CLI 子进程的 stdout+stderr 拼接取尾 2000 字符
返回，前端只展示末尾 160 字符；sillyspec CLI（Node 22+ `node:sqlite`）每次运行必往
stderr 打两行告警噪声，恰好落在拼接尾部，把真实结果文案（如「N 个无法定位需人工核」）
挤出前端可见区。方案：daemon 侧在拼接 output 前用 `stripNodeWarningNoise()` 按行过滤
stderr 中的 Node 进程告警行。选 daemon 侧而非前端侧：噪声源头在子进程 stderr，在源头
滤一次，成功 output 与失败 `action failed` 前缀两路同时受益；前端尾部展示逻辑不动。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

`sillyhub-daemon/src/runtime-handler.ts`：新增模块级纯函数
`stripNodeWarningNoise(stderr: string): string`（不导出，仅本文件使用）；
`action()` 的 output 拼接从 `` `${r.stdout}\n${r.stderr}` `` 改为
`` `${r.stdout}\n${stripNodeWarningNoise(r.stderr)}` ``。RPC `knowledge.action` 响应
字段 `output` 语义微变：不再含 Node 告警噪声行，其余不变；backend / 前端零改动
（同字段同类型）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立——过滤是对已收齐的子进程 stderr 文本做纯函数变换，无流式或乱序问题。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   不涉及——`stripNodeWarningNoise` 是无状态纯函数；action 仍是单请求单子进程，写面
   （CLI --write）行为不变。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全——过滤发生在子进程 close 后拼接阶段；超时杀树路径未动，中途断连行为与改前
   一致。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不涉及——按行过滤只影响本次 RPC 响应文本，无跨工作区状态。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：正则误伤真实错误行。缓解——只匹配行首严格形态
`^\(node:\d+\) \w+Warning` 与 ``^\(Use `node --trace-warnings``（实测 CLI 噪声逐字），
真实 CLI 报错文案不以这两种形态开头。放弃的方案：给子进程注入
`NODE_OPTIONS=--no-warnings`——会静默压制 CLI 所有告警（含未来可能有价值的），
且改的 spawn 环境面大于必要面；前端展示头 160 字符代替尾 160——CLI 结果摘要（含
条目 ID 清单）在输出尾部，取头会丢信息。
