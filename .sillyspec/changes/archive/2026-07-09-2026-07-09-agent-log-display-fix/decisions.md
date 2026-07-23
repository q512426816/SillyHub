---
author: qinyi
created_at: 2026-07-09 05:54:32
change: 2026-07-09-agent-log-display-fix
---

# 决策记录 · 2026-07-09-agent-log-display-fix

本变更的决策来源于 brainstorm 阶段根因调研（真实 run 8fab8465，1565 条日志）+ 用户在 AskUserQuestion 中的明确选择 + Design Grill 交叉审查修正。仅记录有实现/验收影响的决策。

---

## D-001@v1: 工具调用合并为单张卡片（含结果折叠）

- **type**: product / UX
- **status**: accepted
- **source**: 用户 AskUserQuestion 选择（step 6 对话式探索）
- **question**: 工具调用现在被拆成 3 行（命令/卡片/结果）还互相对不上，希望怎么呈现？
- **answer**: 合并成一张卡片——工具名+参数+执行结果，结果默认折叠可展开。
- **normalized_requirement**: 同一次工具调用在日志面板只渲染一张卡片，包含工具徽标、工具名标签（tool_kind 映射）、调用参数、执行结果（默认折叠，点击展开）。消除"一个工具三行分裂、标签对不上"的观感。
- **impacts**:
  - frontend normalize.ts：tool_result 按 parent_tool_use_id 配对到 tool_call 卡片（依赖 D-007 新增逻辑）
  - frontend agent-log-viewer.tsx：tool_call 卡片渲染折叠结果区
  - 依赖 D-006（daemon 给 tool_result 补 tool_use_id，否则配对无依据）
- **evidence**:
  - 真实 run 8fab8465：74 个工具调用 = 74 stdout[TOOL_USE] + 74 tool_call JSON + 74 stdout[TOOL_RESULT]，1:1:1 三写
  - normalize.ts:525-567 现有 [TOOL_USE] 配对逻辑只覆盖①合并进②，③独立行不配对
- **priority**: P0

---

## D-002@v2: SYSTEM/thinking 日志默认折叠可展开（不删除）

- **type**: product / UX
- **status**: accepted
- **supersedes**: D-002@v1（v1 仅含 NOISE_PREFIXES 改造；v2 经 Design Grill CC-09 修正，补 isThinkingContent 影响面——多数 [SYSTEM:*] 经 thinking 合并被吞，不是被 filter 删）
- **source**: 用户 AskUserQuestion 选择（step 6）+ Design Grill CC-09
- **question**: 被当噪音过滤掉的"思考 token 计数"和"系统信息"类日志（535 条）怎么处理？
- **answer**: 默认折叠可展开——显示一行摘要，点击看详情。既不刷屏又不丢信息。
- **normalized_requirement**: `[SYSTEM:xxx]` / `[THINKING]` 类日志不再被删除/吞掉，改为折叠摘要行（如"思考 token 计数 · N 条"/"系统信息 · N 条"），点击展开原始内容。
- **impacts**（CC-09 修正，须同时改两处）:
  - frontend normalize.ts:374 NOISE_PREFIXES filter：`[SYSTEM:thinking_tokens]` 删除逻辑改为折叠标记
  - frontend normalize.ts:619-640 `isThinkingContent`/`isThinkingOnly`：当前把 `[SYSTEM` 开头归 thinking 合并块（吞掉其余 [SYSTEM:*]），改为折叠摘要分类。**若只改 NOISE_PREFIXES 一处，折叠只覆盖 thinking_tokens 一种，多数 SYSTEM 仍被 thinking 合并吞掉**
  - frontend agent-log-viewer.tsx：折叠行渲染 + 展开交互
- **evidence**:
  - normalize.ts:374 NOISE_PREFIXES=["[SYSTEM:thinking_tokens]"]（仅此一种被 filter 删）
  - normalize.ts:619-629 isThinkingContent 把 `[SYSTEM` 前缀命中归 thinking 合并
  - run 8fab8465 有 535 条 [SYSTEM]（多数走 thinking 合并路径，前端不可见）
- **priority**: P1

---

## D-003@v1: killed/failed run 的 NULL token 显示"已中断·未汇总"占位

- **type**: product / UX
- **status**: accepted
- **source**: AI 内联决策（step 7 Grill，倾向明显无需追问）
- **question**: killed/failed run 的 total_cost_usd/num_turns/duration_ms 全 NULL，怎么显示？
- **answer**: 显示"已中断·未汇总"占位，不强行估算。
- **normalized_requirement**: 任务状态为 killed/failed 且终态字段（费用/轮数/时长）为 NULL 时，token 面板对应维度显示"已中断"/"未汇总"占位文案，而非空白或 0。明确告知"任务未完成"而非"数据缺失"。
- **impacts**:
  - frontend token 面板组件（agent-run-panel TokenUsageBadge + daemon/runtime-session-dialog）：按 run.status 判断占位
- **evidence**: DB 查询——killed/failed run（83c46086/19be39ee/a15594a6 等）total_cost_usd/num_turns/duration_ms 全 NULL
- **priority**: P2

---

## D-004@v2: cache_creation 恒 0 根因实证 + 三分支修复策略

- **type**: technical / risk
- **status**: investigate（execute 前置实证）
- **supersedes**: D-004@v1（v1 仅设想"Claude 不返回"单一路径；v2 经 Design Grill CC-06 修正，识别 accumulated 漏采的第二路径）
- **source**: AI 根因调研（step 7 Grill）+ Design Grill CC-06
- **question**: cache_creation_tokens 全表 594 条 run 恒为 0，是采集层 bug 还是 Claude 不返回？
- **answer**: extractResultStats 采集逻辑确认正确（task-16 replace/max 语义，stream-json.ts:1137-1148）。恒 0 存在**两条独立路径**：(a) Claude result.usage 不返回 cache_creation_input_tokens；(b) result.usage 缺失/为 0 时回落 accumulated，而 accumulated（_currentTurnUsage，assistant 事件采集）也未采到 cache_creation。execute 前实证同时 dump 三处原始值区分。
- **normalized_requirement**:
  - execute 阶段首个 task：跑一次真实 Claude run，**同时 dump**：(1) result.usage 原始 JSON；(2) this._accumulatedUsage 终值；(3) 每条 assistant 事件 message.usage 的 cache_creation_input_tokens 是否存在
  - 三分支策略：
    - **A1**（Claude result.usage 返回且 accumulated 有）：修 daemon 字段映射/聚合
    - **A2**（accumulated 漏采，assistant 事件 usage 无 cache 维度）：修 parseAssistant/usage_update 采集逻辑（stream-json.ts:678-683, 548-553 周边）
    - **B**（都没有，Claude 本就不返回）：前端 format-token.ts 让 cache_creation=0/null 显示"—/未知"
- **impacts**:
  - daemon stream-json.ts extractResultStats（A1）+ parseAssistant/usage_update（A2）
  - frontend format-token.ts（B）
  - plan.md 标注此 task 为实证前置，dump 三处值
- **evidence**:
  - DB：全表 594 条 tool_call run 的 cache_creation_tokens 恒 0
  - stream-json.ts:1137-1148 replace/max 语义（result 优先，缺失回落 accumulated）
  - stream-json.ts:678-683 _currentTurnUsage commit；548-553 assistant 事件 cache 提取
  - 无原始 ndjson 可直接验证（daemon 不存原始流），需 execute 时实证
- **priority**: P1（剩余风险，不阻塞 design/plan）

---

## D-005@v1: 历史回看路径补 token 四维

- **type**: product / consistency
- **status**: accepted
- **source**: AI 内联决策（step 7 Grill，范围决策）
- **question**: 历史回看路径（runtime-session-dialog）当前无 token 显示，本次是否一致化？
- **answer**: 本次一致化补齐 token 四维，与主面板统一。
- **normalized_requirement**: daemon/runtime-session-dialog 的 SessionHistoryView 补 token 四维显示（输入/输出/缓存读/缓存写），与 agent-run-panel 主面板口径一致。
- **impacts**:
  - frontend src/components/daemon/runtime-session-dialog.tsx / runtime-session-helpers.tsx：补 token 面板
- **evidence**: 调研确认路径 C（历史回看）无 token 显示，与路径 A/B 不一致
- **priority**: P2

---

## D-006@v1: 修订 C-02——daemon 源头不再双写 stdout [TOOL_USE]

- **type**: architecture / 修订既有决策
- **status**: accepted
- **source**: 用户方案选择（step 8 选方案 B）
- **supersedes**: agent-log-type-tags 变更的 C-02 决策（"stdout [TOOL_USE] 故意不带 tool_kind 归 log 语义类，仅 tool_call JSON 行带"）
- **question**: 在哪一层解决"一个工具调用被记三遍"？
- **answer**: 方案 B——daemon task-runner `_eventToMessages` 的 tool_use 分支删除 stdout [TOOL_USE] 文本行，只保留结构化 tool_call JSON（已带 tool_kind + tool_use_id）；tool_result 保持 stdout channel 但补 tool_use_id。
- **normalized_requirement**:
  - daemon task-runner.ts:1843-1848 删除 stdout [TOOL_USE] push
  - daemon task-runner.ts tool_result 分支补 tool_use_id（从 ev.metadata.tool_use_id/id/call_id 取，与 tool_use 分支 toolUseId 解析同源，task-runner.ts:1825-1829；stream-json.ts:815 实际存 call_id 单字段，命名待 adapter 修正）
  - terminal 回显（renderAgentEvent，task-runner.ts:2651）不动——独立路径，不影响 terminal.log（Design Grill CC-05 已确认）
  - backend run_sync/service.py:432-439 现有 tool_kind_by_tool_use_id 继承逻辑自动激活（Design Grill CC-03 已确认 event_type 来源正确）
  - frontend normalize.ts 保留 stdout [TOOL_USE] 启发式配对作历史降级（旧日志兼容）
- **impacts**:
  - sillyhub-daemon/src/task-runner.ts（_eventToMessages tool_use + tool_result 分支）
  - 前端 normalize.ts 简化（新日志不再有 [TOOL_USE] stdout，但保留降级路径）
  - C-02 决策失效，本文档为修订记录
- **evidence**:
  - task-runner.ts:1700 注释明示 tool_use → 2 条（双写设计）
  - task-runner.ts:1849-1850 注释 C-02 决策原文
  - renderAgentEvent（task-runner.ts:2590-2651）与 _eventToMessages 独立（CC-05）
  - 真实数据 74=74=74 三写
- **priority**: P0

---

## D-007@v1: 前端 tool_result 按 parent_tool_use_id 配对是全新逻辑（非扩展）

- **type**: technical / 工作量订正
- **status**: accepted
- **source**: Design Grill CC-01（P0 订正）
- **question**: design §5 说"扩展 toolUseIdIndex 把 tool_result 并入卡片"——现有代码是否真有此骨架？
- **answer**: **否，是全新逻辑**。现有 toolUseIdIndex（normalize.ts:400-413）仅收 `channel==='tool_call'` 行；stdout [TOOL_RESULT] 行（596-612）只走 lastToolSourceIdx 启发式最近邻，**从无任何 id 比对代码**。design 初版"扩展"措辞低估工作量并误导审查，特此订正为独立 task。
- **normalized_requirement**:
  - normalize.ts 单遍处理 stdout [TOOL_RESULT] 行时，新增逻辑：若 `current.log.parent_tool_use_id` 非空，回查 toolUseIdIndex 命中则 mergeToolResult 并 hidden；未命中或无 id 时退化到 lastToolSourceIdx 启发式（兼容旧日志）
  - **配对 key 明确用 `current.log.parent_tool_use_id`**（AgentRunLogEntry 字段，backend service.py:472 透传），非 content 解析（result 行 content 是 `[TOOL_RESULT] ...` 文本，无 id JSON）
  - 独立 task + 单测覆盖三种场景：id 命中、id 缺失退化、乱序
- **impacts**:
  - frontend normalize.ts：新增 stdout TOOL_RESULT 按 id 配对分支（596-612 区域）
  - plan.md 将此拆为独立 task（勿并入"扩展配对"模糊描述）
- **evidence**:
  - normalize.ts:400-413 toolUseIdIndex 只收 tool_call（line 404 `if (log.channel !== "tool_call") continue`）
  - normalize.ts:596-612 stdout TOOL_RESULT 分支只读 lastToolSourceIdx，无 id 比对
  - design §1 已修正（v2）
- **priority**: P0

---

## D-008@v1: 方案 B→前端方案 A（parity 约束，execute 阶段调整）

- **type**: architecture / 重大调整
- **status**: accepted
- **source**: execute 阶段实证（step 9 测试）
- **supersedes**: D-006@v1（daemon 源头不双写）部分放弃——保留"前端合并卡片"目标，改实现层
- **question**: 方案 B（daemon 删 stdout [TOOL_USE]）execute 时撞到 daemon-parity 测试守护双写格式 + 17 处断言依赖，怎么办？
- **answer**: 改前端方案——daemon 不动（task-02/03/04 回退），前端 normalize 去重合并（task-05/06/07 已实现）。用户视觉效果完全相同（工具合并卡片 + SYSTEM 折叠 + cacheCreation 占位）。
- **normalized_requirement**:
  - daemon task-runner.ts 不改（git checkout 回退，双写保留）
  - 前端 normalize.ts 处理双写：classifyLog `[TOOL_USE]`→tool_call（task-06）+ tool_result 按 parent_tool_use_id 配对（task-05，D-007 全新逻辑）+ NOISE_PREFIXES 移除改折叠（task-06）
  - task-05 id 配对逻辑就绪（前端测试验证），生产 tool_result 的 parent_tool_use_id 由 backend 现有继承逻辑（service.py:432-439）在 daemon 后续补 id 时自动激活（当前 daemon 未补 id，靠启发式 lastToolSourceIdx 退化）
- **impacts**:
  - task-02/03/04 回退（daemon 不改，避免 17 测试改写 + parity 风险）
  - task-05/06/07/08/09 完成（前端方案核心）
  - task-01/10/11/12/13 债务（运行时实证 + 一致化 + 增强）
- **evidence**:
  - daemon-parity.test.ts A1 守护双写（task-08 / change 2026-06-14-unified-agent-execution）
  - 17 处 daemon 测试断言 tool_use→2 条（回退 task-02 后这些测试不再因本次失败，剩余 20 failed 是 main 既有预存债）
  - 前端 715 passed 验证前端方案可行
  - task-runner.ts grep "2026-07-09" = 0（回退干净）
- **priority**: P0

---

## 决策与 FR / 设计章节覆盖关系

| 决策 | 覆盖章节 | 覆盖 FR（待 requirements 生成） | 状态 |
|---|---|---|---|
| D-001 | design §总体方案 Phase 2 | FR-1 工具合并卡片 | accepted |
| D-002@v2 | design §总体方案 Phase 2（含 isThinkingContent 改造） | FR-2 SYSTEM 折叠 | accepted |
| D-003 | design §总体方案 Phase 3 | FR-5 killed 占位 | accepted |
| D-004@v2 | design §总体方案 Phase 3 + §风险登记 R-01 | FR-4 cache_creation 实证（三分支） | investigate |
| D-005 | design §总体方案 Phase 3 | FR-6 历史回看 token | accepted |
| D-006 | design §总体方案 Phase 1 + §兼容策略 | FR-1 前置（daemon 治理） | accepted |
| D-007 | design §总体方案 Phase 2（normalize 新增配对） | FR-1 配对逻辑（独立 task） | accepted |

## 仍未解决 / 剩余风险

- **D-004@v2 未决**：cache_creation 根因待 execute 实证（A1/A2/B 三分支取决于实证结果）。plan.md 须列为 Wave 1 首个 task，dump 三处原始值。
- **2026-06-28-daemon-subagent-transcript 仍活跃**：也改 agent_run_logs（归属三列 parent_tool_use_id/subagent_type/depth），与本次 tool_kind/token 不直接冲突，但 plan 阶段须确认其是否已 merge，避免 merge 顺序问题。
- **D-007 订正**：前端 tool_result 配对是全新逻辑，plan 须拆独立 task，勿低估。

## Design Grill 修正记录

- **CC-01 (P0)** → D-007 新增 + design §5/§1 改"扩展"为"新增"
- **CC-02 (P1)** → design §5/§7.2 明确配对 key = current.log.parent_tool_use_id
- **CC-06 (P1)** → D-004@v2 三分支（补 accumulated 漏采路径）+ design R-01
- **CC-08 (P2)** → design §6 路径补 daemon/ 子目录
- **CC-09 (P1)** → D-002@v2 + design §1/§5 SYSTEM 折叠须改两处（NOISE_PREFIXES + isThinkingContent）
- CC-03/04/05/07/10 确认无误，无需修正
