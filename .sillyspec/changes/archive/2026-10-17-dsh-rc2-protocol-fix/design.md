---
author: flow-machine-draft
created_at: 2026-10-17T07:57:35.098Z
---
# 设计记录（Design Record）— 2026-10-17-dsh-rc2-protocol-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

本机 dsh 00:17 自动更新至 0.2.0-rc.2 后两处协议断裂致全部 dsh 会话 ready 后 ~3 秒静默终止（今日 9 次 killed 实证）。修复：① session/new 恒带 `mcpServers:[]`（rc.2 必填，ACP 手动探针双轮验证：缺失=Invalid params、空数组=握手通过）；② set_config_option 改官方 ACP SDK v2 扁平形状 `{sessionId, configId, value}`（读 rc.2 内 @agentclientprotocol/sdk zod.gen 钉板）；③ 模型/档位设置失败降级 warn 非致命——参数随 rc.x 演进时只降级不杀会话；④ 驱动失败路径补里程碑/错误/子进程退出留痕（此前零日志，静默死无法定位）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `DshAcpDriver.consume`：session/new 参数增 `mcpServers:[]`；set_config_option 参数形状 `{sessionId, configId, value}`（configId∈model/reasoning_effort），设置失败 warn 降级；新增握手/prompt/退出里程碑 console 留痕。
- `DshAcpDriver.setThinkingLevel`：同扁平形状。
- 端点/命令/表结构：无变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：不适用——单请求形状修复，握手时序不变。
2. 并发写：不适用——零共享写面。
3. 切换/生命周期：设置失败降级 warn 后会话照常进 turn 循环（生命周期语义改善：参数漂移从杀会话变降级）。
4. 作用域：不适用——per-session 驱动内行为。

## 文件变更清单（自声明对账面）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/interactive/dsh-acp-driver.ts | session/new mcpServers 占位 + set_config_option 扁平形状 + 非致命降级 + 诊断留痕 |
| 修改 | sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts | set_config_option 形状钉板更新 |

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：dsh 后续 rc.x 再改 schema（alpha 通道本质）——非致命降级兜底使其退化为「默认模型 + warn」而非会话死亡；overlay（llm-pi-ai 路由）对 rc.2 的适配是独立后续任务（与本修复解耦）。已放弃：版本回 pin（npm latest 即 rc.2，next 线 0.2.1-rc.1 同代 schema，无更稳旧版可退）。
