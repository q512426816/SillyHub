---
plan_level: full
execution_mode: main
---

# 实现计划（Plan）— 2026-10-12-session-defects

## Wave 1（并行，无依赖；文件正交——波1=数据管道可靠性 D-002@v1）
- task-03
- task-04
- task-06
- task-11

> batch: task-03+task-04
> batch: task-06
> batch: task-11

## Wave 2（波2 行为类起始：无跨任务依赖、与 Wave 1 无文件交集；**波界验收门见下**）
- task-01
- task-07
- task-10

> 波界验收门（D-002@v1「波边界即验收检查点」）：W1 全部任务勾选后，MUST 先跑波1 相关面测试（task-03 幽灵行复现测试、task-04/06 单测）确认通过并留痕，方可开始本 Wave 任何任务。

## Wave 3（依赖 Wave 2：task-02/05 与 task-01 共享 event-wire.ts 必须后置；task-09 依赖 task-07）
- task-02
- task-09

## Wave 4（task-05 依赖 task-02 的 event-wire 终态；task-08 依赖 task-07+task-09）
- task-05
- task-08

## Wave 5（收口验收，依赖全部）
- task-12

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-03 | F3 任务幽灵行根治 | W1 | P0 | — | FR-04, D-005@v1 | 根因调查+复现测试先红+修复转绿（agent_task_store.py） |
| task-04 | F5a config_snapshot 补齐 | W1 | P1 | — | FR-06, D-001@v1 | create.py/inject.py 绑定与切换时点落 model/provider |
| task-06 | F7 导出与列表去重 | W1 | P1 | — | FR-07, D-005@v1 | export.py + session_insights.py 同口径去重（先兜底行为，与 task-03 结论联调） |
| task-10 | F4 策略路径解析 | W2 | P0 | — | FR-05, D-007@v1 | shell-paths flag 过滤 + anchor 三层贯通 + deny 双拼写（daemon policy 面四文件；波2 行为类后行 per D-002@v1） |
| task-11 | sillyspec 缺陷记档 | W1 | P2 | — | FR-08, D-008@v1 | docs/sillyspec/ 两条 NEW |
| task-01 | F2a wire 事件时间戳 | W2 | P0 | — | FR-02, D-004@v1 | daemon types/event-wire 捕获 + backend submit_steps 取值（含 SSE 同步） |
| task-07 | F1a context_overflow 归因 | W2 | P0 | — | FR-01, D-003@v1 | daemon 分类器 + backend Literal（实测预案）+ gen:types + 前端错误卡 |
| task-02 | F2b 消息碎片合并 | W3 | P0 | task-01 | FR-03, D-004@v1 | message-coalescer 缓冲器 + event-wire 接入 + segment 残留核查 |
| task-09 | F1c 会话状态语义 | W3 | P1 | task-07 | FR-01, D-006@v1 | 翻 failed 路径调查（产出供 task-08）+ 恢复预算内不终态化修正 |
| task-05 | F5b 打断工具调用补日志 | W4 | P1 | task-02 | FR-06, D-001@v1 | 中断/拒绝路径 tool_call 行补发（event-wire，在 task-02 之后避免同文件并行） |
| task-08 | F1b 自动恢复编排 | W4 | P0 | task-07, task-09 | FR-01, D-003@v1 | auto_resume 分支（compact_session+内联直插重放+熔断=2+引导不吞） |
| task-12 | 收口验收 | W5 | P0 | task-01..11 | FR-09 | 相关面测试全绿 + ruff/mypy/tsc/vitest 门 + 对照 design 清单验收 |

## 关键路径

task-07 → task-09 → task-08 → task-12（波2 行为链，决定最短交付周期）；次长链 task-01 → task-02 → task-05 → task-12。

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）

- 零 migration：不改 agent_run_logs / agent_session_task / agent_sessions 表结构，全部复用既有列。
- error_code 与 error_detail 正交契约（backend/app/modules/daemon/run_sync/service/close_run_steps.py:288 D-009）MUST NOT 改写：模型层错误只进 error_detail，不动 error_code。
- 平台 MUST NOT 自实现任何上下文压缩逻辑；自动恢复只允许调 compact_session 既有双分路（D-003）。
- 重放入队 MUST 函数内直插 AgentSessionScheduledMessage（对齐 auto_resume.py:452-467/:626-642 形态），禁止走 maybe_enqueue_auto_resume（G3 门禁仅放行 daemon_restarted）。
- wire timestamp 字段可选向后兼容：旧版 daemon 无字段时 backend 行为与现状完全一致；钟差 >5 分钟回落 st.now。
- path-utils anchor 参数默认值 = process.cwd() 现行为；仅 write-guard 裁决路径显式传会话根，其他调用点零变化。
- ModelErrorType 部署顺序 backend 先发；execute 首个触碰 Literal 的任务须实测未知值行为，若 422 拒绝则 backend 同轮附带宽松校验（validator 归 unknown）发版。
- 「停用旧行」标记（如引入）MUST 与 RUN_CLOSE_SWEEP_REASON 文案显式区隔。
- 前端 api-types.ts MUST 走 `pnpm gen:types` 生成，禁止手写（CLAUDE.md 规则 21）。
- 注释与用户可见文案一律中文（CLAUDE.md 规则 12）；错误文案中文（design D-003 文案）。
- 测试规则 0：仅跑改动模块相关测试（backend pytest 按 module / daemon·frontend vitest 相关文件），禁止全量（FR-09）。
- 不重构 stream-json adapter 事件模型：碎片合并在 wire 转换层（event-wire.ts）做，adapter 协议零改动（design 非目标第 5 条）。
- 波界验收门：W1→W2 之间 MUST 执行波1 相关面测试验收并留痕（D-002@v1 波边界即验收检查点），未通过不得进入波2 任务。

## 全局验收标准

1. 改动模块相关单测全绿（backend pytest + daemon/frontend vitest），ruff/mypy（backend）、tsc（daemon）、eslint/tsc（frontend）过门。
2. 生产实证模式复现用例转绿：同毫秒时间戳聚集、消息碎片成对、任务幽灵成对行、`-p` flag 误提取、相对路径 daemon cwd 误锚。
3. （brownfield）未配置新逻辑时行为不变：wire 无 timestamp、caps.compact=false、anchor 未传、旧枚举值各场景零回归。
4. 波界验收门留痕：W1→W2 间波1 测试验收结果在 execute 记录可追溯（D-002@v1）。
5. 集成敏感面冒烟：auto_resume context_overflow 分支全链路（收口→compact→入队）pytest 集成用例；策略 deny→allow 翻转用例。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01..task-12 | 五组 FR 全交付 + verify-result.md |
| D-002@v1 | W1（task-03/04/06/11 波1 数据管道）→ W2 起波2（task-01/07/10 行为类）→ W5 收口；W1→W2 波界验收门 | Wave 屏障顺序执行留痕 + 波界验收记录 |
| D-003@v1 | task-07, task-08 | 分类用例 + auto_resume 分支用例（熔断=2） |
| D-004@v1 | task-01, task-02 | timestamp 分散用例 + delta 合并用例 |
| D-005@v1 | task-03, task-06 | 幽灵行复现测试先红后绿 + 导出/列表去重用例 |
| D-006@v1 | task-09 | 会话状态语义用例（可恢复失败保持 active） |
| D-007@v1 | task-10 | flag 过滤/锚点/双拼写三类 vitest |
| D-008@v1 | task-11 | docs/sillyspec/ 两文件在场 |
