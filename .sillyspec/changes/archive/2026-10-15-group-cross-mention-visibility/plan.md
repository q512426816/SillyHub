---
plan_level: full
execution_mode: main  # 任务均 ≤30min 中等规模、上下文单会话可承载（R7/R8 对撞实证 main 直写优先）；W2 三任务文件正交但单会话串行即可
---

# 实现计划（Plan）— 2026-10-15-group-cross-mention-visibility

## Spike 前置验证

无（技术方案已经 brainstorm 独立评审源码级验证：护栏先于分流、agent_public 天然绕过投影拦截、加列链路闭合——review-2026-10-15-115811 通过面实证）。

## Wave 1（并行，无依赖）
- task-01

## Wave 2（依赖 Wave 1：schema/DTO 字段就位）
- task-02
- task-03
- task-04

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 数据模型与 DTO：AgentGroupChat 加列+迁移+透传+单测 | W1 | P0 | — | FR-01, D-001@v1, D-002@v1, D-005@v1 | cross_mention_mode 列/CHECK/默认 private |
| task-02 | 触发三态分流：mentions.py 分流+公开指令常量+单测 | W2 | P0 | task-01 | FR-02, D-006@v1, D-011@v1 | 源轮 consensus_task_id > 群模式 > private |
| task-03 | 投影与回流：group_bridge 放行+轻注入 helper+单测 | W2 | P0 | task-01 | FR-03, FR-04, D-003@v1, D-004@v2, D-006@v1, D-007@v1 | NEW delegation_notice.py；投影矩阵+打断零副作用 |
| task-04 | 前端设置面：member-panel/向导控件+测试+双端 gen:types | W2 | P1 | task-01 | FR-01, FR-05, D-002@v1, D-005@v1 | 三态联动禁用；api-types 前端+daemon 同变更提交 |

## 关键路径
task-01 → task-02/task-03（最长路径：模型加列是全部后续任务的前置；W2 三任务互不依赖可任意序）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）
- 存量群与新群 `cross_mention_mode` 默认 `'private'`；`agent_cross_mention=false` 时模式字段不产生任何行为差异（D-001/D-002）
- v1 只投影被委派成员最终回复的 [[GROUP]] 段，过程内容零投影；不做进度播报、不做双写、不做结果后自动触发（D-003/D-009/D-010）
- 轻注入 = 仅向发起方影子会话最近 run 追加一条 `AgentRunLog(user_input, delegation_notice)`，不建 run、不入队、不派发；失败静默降级记 structlog warning（D-004@v2）
- 三态分流优先级固定：源轮 `consensus_task_id` 非空 > 群 `cross_mention_mode='public'` > private 现路径；分流判定在护栏三层（链深/同链同成员 2 次/6 次/60s + Redis fail-closed）**之后**，两模式共用计数互不放宽（D-011/FR-05）
- `agent_public` 轮 MUST NOT 携带 `dm_target_member_id`；`agent_dm` 轮与 consensus 协作轮的投影拦截行为与现状逐比特一致
- 被打断（run 非 completed）的委派轮零投影零注入（D-007）
- UI 与文案一律中文；前端控件用 antd 组件 + `brand-*` 语义阶类名（blue-* 仅限真信息蓝），antd 组件色经 ConfigProvider token 不手写（规则 20）
- `pnpm gen:types`（frontend）与 `pnpm -C sillyhub-daemon gen:types` 必须与后端 schema 改动在同一变更内跑并提交 api-types.ts + backend/openapi.json + daemon api-types.ts（规则 21）
- 注释与实现必须一致（规则 18）；代码兼容 Windows/Linux/macOS（规则 13）；禁止跑全量测试，仅跑本变更相关测试（规则 0）
- 错误文案与系统行提示一律中文

## 全局验收标准
1. 新增/修改的后端单测全绿：模型列断言、三态分流断言（public 群 agent_public 无 dm_target / private 群参数逐比特一致 / consensus 源轮优先）、投影矩阵（[[GROUP]] 进群/兜底/thinking 不进/agent_dm 拦截不变）、轻注入落点（影子会话日志行、无 run 创建）、护栏同源计数、打断零副作用
2. 既有相关测试零回归：test_group_cross_mention / test_group_bridge_projection / test_group_chat_management / test_group_mention_pipeline / test_group_chat_models 等相关文件全绿
3. 前端 member-panel 控件三态联动测试全绿（正常/总开关关/consensus 开）
4. 双端 gen:types 后 api-types.ts 与 backend/openapi.json 一致，gen:types:check 类检查通过
5. （brownfield）未开启公开模式的群（含全部存量群）互 @ 行为与变更前完全一致

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01 | AC：模型列断言（默认/CHECK/开关优先） |
| D-002@v1 | task-01, task-04 | AC：存量零变化 + 向导默认 private |
| D-003@v1 | task-03 | AC：投影矩阵（无标记兜底口径） |
| D-004@v2 | task-03 | AC：轻注入落点断言（无 run/不入队/失败降级） |
| D-005@v1 | task-01, task-02 | AC：consensus 源轮优先 + 控件互斥禁用 |
| D-006@v1 | task-02, task-03 | AC：dm_kind 断言 + 投影放行矩阵 |
| D-007@v1 | task-03 | AC：打断零投影零注入 |
| D-008@v1 | task-01~04 | AC：方案 A 全链（结果单投+轻注入） |
| D-009@v1 | — | rejected 留档（不做双写），无验收物 |
| D-010@v1 | — | rejected 留档（不做播报/接话），无验收物 |
| D-011@v1 | task-02 | AC：三态优先级断言 |
