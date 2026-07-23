---
author: qinyi
created_at: 2026-07-09 06:05:33
change: 2026-07-09-agent-log-display-fix
related: design.md, decisions.md, proposal.md, requirements.md
---

# Tasks · 智能体执行日志回显修复

任务列表（Wave 分组，细节在 plan 阶段展开）。每个 task 标注覆盖的 FR / 决策。

---

## Wave 1 · daemon 源头治理 + cache_creation 实证（前置）

| ID | 名称 | 文件路径 | 覆盖 FR / 决策 |
|---|---|---|---|
| task-01 | cache_creation 恒 0 根因实证（dump 三处值） | sillyhub-daemon/src/adapters/stream-json.ts（临时 dump） | FR-07 / D-004@v2（前置实证） |
| task-02 | task-runner `_eventToMessages` tool_use 删 stdout [TOOL_USE] 文本行 | sillyhub-daemon/src/task-runner.ts:1843-1848 | FR-01 / D-006@v1 |
| task-03 | task-runner `_eventToMessages` tool_result 补 tool_use_id | sillyhub-daemon/src/task-runner.ts:~1890（tool_result case） | FR-02 / D-006@v1 |
| task-04 | daemon 单测：tool_use 不双写 + tool_result 带 id（id 有/无两场景） | sillyhub-daemon/src/__tests__/task-runner-event-to-messages.test.ts（新增） | FR-01, FR-02 |

**依赖**：task-01 先行（实证结果决定 task-09 分支）。task-02/03 可并行。task-04 依赖 02/03。

---

## Wave 2 · 前端合并卡片 + SYSTEM 折叠

| ID | 名称 | 文件路径 | 覆盖 FR / 决策 |
|---|---|---|---|
| task-05 | normalize 新增 stdout [TOOL_RESULT] 按 parent_tool_use_id 精确配对（全新逻辑，非扩展） | frontend/src/components/agent-log/normalize.ts:596-612, 400-413 | FR-03 / D-007@v1, D-001@v1 |
| task-06 | normalize classifyLog 补 [TOOL_USE] stdout 降级分支 + NOISE_PREFIXES/isThinkingContent 改折叠分类 | frontend/src/components/agent-log/normalize.ts:334-358, 374, 619-640 | FR-10, FR-05 / D-006@v1, D-002@v2 |
| task-07 | agent-log-viewer tool_call 卡片合并折叠渲染 + SYSTEM/thinking 折叠 UI | frontend/src/components/agent-log-viewer.tsx | FR-04, FR-05 / D-001@v1, D-002@v2 |
| task-08 | normalize/viewer 单测：id 命中/缺失/乱序 + 折叠展开 + [TOOL_USE] 降级 | frontend/src/components/agent-log/__tests__/（新增） | FR-03, FR-04, FR-05, FR-10 |

**依赖**：task-05/06 可并行。task-07 依赖 05/06。task-08 依赖 05/06/07。Wave 2 依赖 Wave 1 task-03（tool_result 带 id 才能精确配对新日志；旧日志降级不依赖）。

---

## Wave 3 · token 四维补全

| ID | 名称 | 文件路径 | 覆盖 FR / 决策 |
|---|---|---|---|
| task-09 | cache_creation 按 task-01 实证分支落地（A1 修 extractResultStats 映射 / A2 修 parseAssistant 采集 / B 改 format-token 占位） | sillyhub-daemon/src/adapters/stream-json.ts（A1/A2）或 frontend/src/lib/format-token.ts（B） | FR-07 / D-004@v2 |
| task-10 | interactive-session-panel SessionTurnView + onTokens/onTurnCompleted 补 cache_read/cache_creation | frontend/src/components/daemon/interactive-session-panel.tsx:72-74, 204-225 | FR-06 |
| task-11 | token 面板 killed/failed 占位（按 run.status） | frontend/src/components/agent-run-panel.tsx + daemon/runtime-session-dialog.tsx | FR-08 / D-003@v1 |
| task-12 | 历史回看 runtime-session-dialog 补 token 四维 | frontend/src/components/daemon/runtime-session-dialog.tsx（或 runtime-session-helpers.tsx） | FR-09 / D-005@v1 |
| task-13 | 前端 token 单测：cache 维度读取 + killed 占位 + 历史回看四维 | frontend 对应组件 __tests__ | FR-06, FR-08, FR-09 |

**依赖**：task-09 依赖 task-01（实证结果）。task-10/11/12 可并行。task-13 依赖 10/11/12。

---

## 汇总

- **13 个 task**，3 个 Wave，依赖关系清晰（Wave1 实证/治理 → Wave2 前端合并 → Wave3 token）。
- **关键路径**：task-01（实证）→ task-09（按分支修）；task-03（daemon 补 id）→ task-05（前端配对）→ task-07（卡片渲染）。
- **风险点**：task-01 实证结果决定 task-09 分支（D-004@v2 investigate）。
- plan 阶段展开每个 task 的具体实现步骤、测试用例、验收标准。
