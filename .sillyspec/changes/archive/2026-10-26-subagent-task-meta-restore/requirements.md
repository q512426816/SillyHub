---
author: flow-machine-draft
created_at: 2026-10-26T07:18:49.445Z
---
# 需求规格（Requirements）— 2026-10-26-subagent-task-meta-restore

## 功能需求

### FR-01: [TASK_*] 行悬挂暂存与派发段建立时回填

- 装配器（session-log-assembler.applyLogToSegments 的 task 分支）对 parent_tool_use_id 未命中任何 tool/stub 段的 [TASK_STARTED]/[TASK_PROGRESS]/[TASK_NOTIFICATION] 行**必须**悬挂暂存（turn 链共享悬挂表，键=parent_tool_use_id），**禁止**直接丢弃；后续同 id 的 tool_use 段（或 stub→tool 合并）建立时**必须**按到达序逐条回填段元数据（applyTaskMeta 同款字段语义）并清悬挂条目。无 parent_tool_use_id 且 task_id 反查未命中的行维持既有丢弃行为（零回归）。

#### 场景：同毫秒批量行乱序装配（生产复现形态）

- Given 生产实证形态——同一毫秒批量落库四行：[TOOL_USE] Agent（stdout，无 id）、tool_call JSON（尾部 tool_use_id）、[TASK_STARTED]（parent=该 tool_use_id，async:true）、[TOOL_RESULT]（回执）
- When 历史回放（logsToTurns）以任意顺序装配该四行（含 [TASK_STARTED] 先于 tool_call 行、[TOOL_RESULT] 先于 [TASK_STARTED] 的排列）
- Then Agent 派发段最终携带 taskStatus="running" + taskAsync=true（终态行则终态值），悬挂表无残留

#### 场景：既有顺序零回归

- Given [TASK_*] 行在段建立之后到达（既有常态顺序）
- When 装配
- Then 元数据照旧即时写入，行为与现状逐字节一致

### FR-02: 元数据恢复压住 async 回执假终态

- 元数据回填后，子代理卡片头部显示**必须**按既有优先级（[TASK_*] 元数据 > 段三态）裁决——回执配对产生的段 status=ok 与 endedAt **不得**使卡片显示假"已完成"；段 taskStatus=running 时卡片显示"后台运行中"+走秒（锚=段 startedAt），taskStatus 终态时按元数据终态显示。本条为 FR-01 的显示层验收（subagentHeaderOf 既有优先级不动，**禁止**新写显示分支）。

#### 场景：假完成消除

- Given FR-01 场景装配完成后的段（status=ok 假终态 + taskStatus=running 元数据）
- When subagentHeaderOf 派生头部
- Then status=running、徽章"后台运行中"、时长走秒路径（不显示回执差值假时长）

### FR-03: 乱序回归测试与既有套件全绿

- **必须**在装配器测试中新增乱序排列用例（TASK 行最先 / 回执先于 TASK 行 / 常态顺序 / 无 parent 行丢弃四形态），断言段元数据与悬挂表清空；既有 session-log-assembler / task-line-assembler / turn-state-subagent-routing 套件**必须**全绿，**禁止**为躲断言改既有用例语义。

#### 场景：套件回归

- Given 修改后的装配器
- When vitest run 装配器相关测试文件
- Then 全绿（新用例通过 + 既有用例零改动或仅宽度无关断言同步）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/task-line-assembler.test.ts「同毫秒四行乱序装配——悬挂暂存与段建立回填（含悬挂表清空断言）」
FR-02: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「回填后 subagentHeaderOf 元数据优先压回执假终态（running 徽章+走秒锚）」
FR-03: frontend/src/components/daemon/__tests__/session-log-assembler.test.ts「既有套件全绿 + 无 parent 行丢弃零回归」
