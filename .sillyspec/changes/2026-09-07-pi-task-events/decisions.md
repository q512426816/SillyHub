---
author: qinyi
created_at: 2026-09-07 21:40:00
---

# 决策记录（Decisions）

## D-001@v1: 派生粒度=工具调用聚合为单任务
- type: definition
- priority: P0
- status: accepted
- source: code
- question: pi 无任务级事件，从工具调用流派生任务的粒度怎么定？
- answer: 以「一轮（turn）内的活动」聚合为单条任务：turn_start 建/复running行（task_id=pi-run-<runId> 稳定键，task_name 取首轮用户消息或'执行任务'），tool_execution_start 刷新 last_tool_name/tool_uses 累计/summary（'正在调用 X'），tool_execution_end 保持 running（工具成败不等于任务成败），turn_end 按 stopReason 映射终态（error→failed 其余→completed）置 message/finished_at。子代理粒度（claude Task 工具那种）pi 原始流无对应概念，不做
- normalized_requirement: pi 会话每轮在任务执行面板恰好一行，running 期间随工具调用实时刷新，轮终显示成功/失败与耗时
- impacts: [FR-01, FR-02, design-派生规则]
- evidence: pi-events.ts 事件词表（turn_start/turn_end/tool_execution_* 均有）；claude-events task 派生先例字段契约

## D-002@v1: 派生位置选归一化器（方案 A）——⚠️ 自主决策待用户复核
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: pi 任务事件在哪层派生？（A 归一化器 / B session-manager / C driver 直连）
- answer: 选 A。PiEventNormalizer 增实例级 turnTask 聚合状态产出 status/agent_task_status——贴 claude-events 同位置派生信号的既有架构，session-manager/_dispatchStatusEvent→cli 上报链路零改动，纯函数测试范式可延续；代价是归一化器从逐行纯函数升级为实例级状态机（turn 边界做状态推进点，normalizeRpcLine 单行解析仍独立）
- normalized_requirement: session-manager 与 cli.ts 对 pi 任务事件零特判；pi-events.ts 内聚全部派生逻辑
- impacts: [design-总体方案, task 划分]
- evidence: claude-events.ts:601-800 先例（归一化层产 task 信号）；pi-rpc-driver.ts:518 按 driver 实例 new normalizer（实例级状态有宿主）

## D-003@v1: 设计整体确认——⚠️ 自主决策待用户复核
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: 五段设计（派生规则/状态机/零侵入链路/无原型/测试）是否确认？
- answer: 按 D-001/D-002 定稿确认。原型跳过理由：纯数据链路补齐，前端任务执行面板零改动（pi 会话从空态变有数据，无界面变化，原型分级「纯后端无界面变化」档）
- normalized_requirement: design.md 按五段展开；execute 不得引入前端文件改动
- impacts: [design 全章节]
- evidence: ⚠️ 自主模式（用户未实时在线），归档时追认

## D-004@v1: design-grill 修正——stopReason 枚举实证与测试路径
- type: consistency
- priority: P1
- status: accepted
- source: design-grill
- question: aborted→stopped 映射与测试文件路径是否符合源码事实？
- answer: 修正三处：①fixture 全量实证 stopReason 仅 stop/error 两值，aborted 是 ame.error 的 reason（流层中止）非 stopReason——删除 aborted→stopped 映射，被打断的轮按 completed 收行；②测试路径实存 tests/interactive/pi-events.test.ts，新增集成用例定名 tests/interactive/pi-task-dispatch.test.ts；③R-01 应对改写：既有用例 expected 数组需追加派生事件（预期适配非破坏）
- normalized_requirement: 派生映射只含 error→failed 与其余→completed；文件清单路径与仓库实存一致
- impacts: [总体方案-派生规则, 文件变更清单, R-01]
- evidence: tests/fixtures/pi-rpc-events/*.jsonl（14 stop + 4 error，无 aborted）；pi-rpc-driver.ts:999-1001（abort→ame.error reason='aborted'→error 事件）；tests/interactive/ 目录实存
