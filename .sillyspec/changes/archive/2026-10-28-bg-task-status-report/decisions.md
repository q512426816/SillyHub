---
author: qinyi
created_at: 2026-10-28 00:20:00
---

# 决策记录 — 2026-10-28-bg-task-status-report

## D-001@v1 后台任务状态上报技术路线：方案 A（事件级上报）

- **status**: accepted
- **type**: architecture
- **source**: user
- **日期**: 2026-10-28
- **question**: CLI 后台任务（run_in_background Bash 等）状态在平台会话页的实时准确性如何实现？
- **answer**: 方案 A——daemon 解析 CLI 会话日志（rollout jsonl）中后台任务的完成信号（task-notification 系统消息 / 后台 tool_result），产「后台任务终态」活动事件上报平台；平台将对应「后台任务 · 运行中」条目翻转为终态，并在会话空闲时状态区显示「后台任务 N 个运行中」（由事件流推导运行中集合）。理由：状态实时且条目级准确，一次治好「该显示的不显示」与「完成了还挂运行中」两头；现有链路基础好——daemon 已解析 tool_use 的 run_in_background 声明（events.ts:578）、平台已能显示后台任务启动条目（tool_use 事件已通）、daemon→平台活动事件通道已有（agent log 事件/turn_phase 先例）。
- **evidence**: brainstorm 方案对比（AskUserQuestion，2026-10-28），用户选项「方案 A：事件级上报（推荐）」；现象实证：用户截图显示 Bash 后台任务条目「运行中 02:14」而实际早已完成（seq48 部署命令）。
- **问题定义（用户原话）**: 「为什么我在平台会话页面看不到正在运行的信息？…在平台会话里应该也要展示到后台标签里呀，可是我没看到有任何的提示，就像结束了一样」+「为什么现在又能看到这个信息了？刚刚都还没有呢」（两头不准实证）。

## D-002@v1 落选方案 B（心跳计数）— rejected

- **status**: rejected
- **type**: architecture
- **source**: user
- **question**: 同 D-001 问句
- **理由**: 方案 B——daemon 心跳（15s）携带各会话后台任务运行中计数。
- **否决理由**: 只有计数无条目——平台「后台任务 · 运行中」条目仍无终态翻转（已启动条目永远挂着运行中）；计数与条目两套口径易漂移。
- **复潮条件**: 若事件通道（rollout 解析→上报）被证实不可行（如 CLI 日志无终态信号），再评估计数兜底。

## D-003@v1 落选方案 C（平台超时猜测）— rejected

- **status**: rejected
- **type**: architecture
- **source**: user
- **question**: 同 D-001 问句
- **理由**: 方案 C——平台侧对后台任务条目按超时标灰。
- **否决理由**: 猜测非事实——镜像打包 20 分钟、长测试更久，超时阈值必误判；治标不治本（「该显示时不显示」的活跃期盲区完全不解决）。
- **复潮条件**: 不复潮（除非 daemon 侧彻底失去信号源）。


## D-004@v1 执行期裁决：bg_task_final 用附着字段而非新段 kind

- **status**: accepted
- **type**: implementation
- **source**: agent
- **日期**: 2026-10-28（execute Wave 1 task-02 执行期）
- **歧义描述**: plan 卡写「新段类型 bg_task_final」；执行发现段模型 kind 是五值封闭枚举（user_input/reply/thinking/tool_use/tool_result），新增 kind 牵连全部消费方 switch；且 task-notification 文本已被归为 system_event user_input 段（类型注释明示），并非完全被忽略。
- **选择**: NormalizedLogMessage 加可选附着字段 bg_task_final 结构化载荷（taskId/toolUseId/status/outputFile）——识别到 task-notification 的 system_event 段附着；kind 枚举不动，老消费方零影响（可选字段）。
- **理由**: 非破坏性（类型级可选扩展）；消费链按字段存在性检测发桥标记。
- **影响 task**: task-02/task-03。


## D-005@v1 执行期裁决：bg-task-final 端点纯发布不落库

- **status**: accepted
- **type**: implementation
- **source**: agent
- **日期**: 2026-10-28（execute task-04 执行期）
- **歧义描述**: design 原案落 agent_run_logs+dedup_key 幂等；执行时理清前端活动流数据源=daemon rollout 解析段（HTTP 代理链），backend 表落库无消费方。
- **选择**: 端点=校验（DTO+越权）+Redis 发布纯信号（触发前端失效重拉活动数据，重拉数据自然含 task-02 附着终态段）；不落库。幂等语义：前端失效重拉天然幂等；daemon 重启重扫重发事件无害（同值信号）。
- **理由**: 消除无消费方的存储面；链路更短；信息零损失（数据源在 rollout 原文）。
- **影响 task**: task-04（简化）/task-05（消费=SSE 信号→失效查询）。


## D-006@v1 执行期裁决：daemon 侧独立扫描环（替代 onTurnMessage 桥）+ 端点 run_id 改可选

- **status**: accepted
- **type**: implementation
- **source**: agent
- **日期**: 2026-10-28（execute task-03 执行期）
- **歧义描述**: design 原案桥模式（session-manager events 消费段→onTurnMessage 桥→daemon 拦截）；执行理清 daemon 两域分工——task-notification 解析发生在 agent-log 域（liveness tailer 10s tick 读 rollout），不在 session-manager 域（SDK 流事件），桥前提不成立。且 task-notification 无 run_id，端点 run_id 必填无值可填。
- **选择**: daemon.ts 独立轻量扫描环（60s 节拍，与 liveness loop 同生命周期）：对 liveness watch 的 claude-code 日志末 64KB 提取 task-notification（复用 task-02 parseTaskNotification），与进程内快照 Map diff，新增/变化 task_id 直调 HubClient notifyBgTaskFinal（daemon 层自有 client 无需桥）；agentSessionId 映射取 liveness spawn 记录/persisted 恢复记录（rescan 发现的无会话身份跳过）；重启后首扫只建基线不上报（防风暴，漏报=维持现状可接受）。端点 run_id 改 Optional（纯信号无轮语义，前端翻转仅用 tool_use_id）。
- **理由**: 链路最短（一层直调）；幂等=快照 diff；复用既有发现链与解析纯函数。
- **影响 task**: task-03（实现形态）/task-04（run_id Optional 小调）。


## D-007@v1 执行期裁决：FR-04 计数显示延后（启动事件源缺失）

- **status**: accepted
- **type**: implementation
- **source**: agent
- **日期**: 2026-10-28（execute task-06 执行期）
- **歧义描述**: FR-04 运行中计数需「启动∪终态」事件配对；核清前端 SSE 现有事件面——turn 内工具调用无逐条实时事件（turn_phase 是轮级、agent_task_status 是子代理域、Bash 后台启动无 SSE 信号），启动事件源不存在。
- **选择**: 本轮交付终态翻转（FR-03——用户核心痛点「完成后永挂运行中」由翻转+查询失效解决）；计数显示延后独立变更（需先建启动事件源——如 tool_use 实时事件或 AgentLogCard 实时化，涉及面另评估）。前端交付面=信封类型+onBgTaskFinal 回发+活动查询失效。
- **理由**: 防复杂度失控；核心痛点先落地；计数属增强非阻断。
- **影响 task**: task-06（范围收缩）/requirements FR-04 标注延后。
