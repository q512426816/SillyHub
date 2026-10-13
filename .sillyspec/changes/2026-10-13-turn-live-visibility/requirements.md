---
author: flow-machine-draft
created_at: 2026-10-13T03:30:35.880Z
---
# 需求规格（Requirements）— 2026-10-13-turn-live-visibility

## 功能需求

### FR-01: TaskOutput（block=true）运行中时，时间线该工具行显示人话摘要「等待后台任务：<任务名>」+ 每秒跳动的已等时长（mm:ss），任务名/最后活跃时间经任务快照（agent_session_task）对账获得，查不到时优雅回退不崩

- 工具段 toolName="TaskOutput" 且 status="running" 时，工具行主参数位置必须显示人话等待摘要（快照命中 task_id 时为「等待后台任务：<任务名>」，未命中时回退「等待后台任务输出」），禁止以原始 JSON 作为主参数展示；行尾必须显示每秒跳动的已等时长（mm:ss，锚点=段 startedAt，startedAt 缺失时不显示走秒）；该段进入终态后必须停止走秒并回归普通工具行形态（主参数恢复 raw 摘要）。

#### 场景：快照命中显示任务名

- Given 轮运行中，TaskOutput（block=true）段 status="running"，任务快照（byTaskId）命中其 args.task_id 且 taskName="重跑生产构建"
- When 渲染时间线
- Then 主参数显示「等待后台任务：重跑生产构建」，行尾显示已等走秒且每秒递增

#### 场景：快照未命中优雅回退

- Given 同上但任务快照无该 task_id（快照未拉取/任务行未建）
- When 渲染时间线
- Then 主参数显示「等待后台任务输出」，不抛错、不显示 raw JSON

#### 场景：终态回归普通行

- Given TaskOutput 段收到 result 转入终态（ok/deny）
- When 渲染时间线
- Then 不再显示等待文案与走秒，恢复既有工具行形态

### FR-02: 后台任务派发段（含子代理容器段）的 running 任务元数据在任务快照为终态时收敛为终态徽标，治理 [TASK_*] 终态事件丢失导致的永久「后台运行中」残留

- 段任务元数据状态为 running 时，若任务快照（按 tool_use_id 或 task_id 对账）为终态（completed/failed/stopped），渲染状态必须收敛为快照终态（子代理块头徽标/状态点与轮状态栏「子代理 N 运行中」计数同步收敛）；收敛必须单向（仅 running→终态），禁止终态段被 running 快照回退；无快照/无 Provider 宿主（dialog 弹窗）时必须保持既有推导零回归。

#### 场景：徽标与计数收敛

- Given 容器段 taskStatus="running"（[TASK_*] 终态 stdout 行丢失）、任务快照 status="completed"
- When 时间线与轮状态栏渲染
- Then 块头徽标显示「已完成」而非「后台运行中」，状态栏运行中子代理计数不含该段

#### 场景：终态不回退

- Given 段 taskStatus="completed"（元数据已收终态）
- When 快照行状态为 running（滞后心跳）
- Then 展示仍为 completed（终态即终）

### FR-03: 任务面板清单在轮完成对账点（schedulePostTurnReconcile）同步重拉任务快照，终态残留卡片收敛

- 轮完成对账点（schedulePostTurnReconcile 触发处）必须同步递增任务清单快照重拉信号（refreshSignal），使丢失终态事件的运行中任务卡片按服务端 agent_session_task 权威状态收敛；该重拉失败必须静默（不打断轮边界日志对账主流程，既有重连/进页面重拉链路兜底）。

#### 场景：轮边界卡片收敛

- Given 任务卡片显示「后台任务运行中」（agent_task_status 终态事件丢失），服务端表该任务已终态
- When 本轮 turn_completed 触发对账
- Then 任务卡片状态更新为服务端终态

### FR-04: daemon usage_update 估算推送从「累计 ≥20 token」改为「≥20 token 或距上次推送 ≥500ms」双门限，低速生成时 token 数字约每 0.5 秒一跳；真 usage 到达后 API call 进行中估算继续推送（仍被 message_delta 真值覆盖校正）

- text_delta 估算推送门限必须为「累计增量 ≥20 token 或距上次推送 ≥500ms」双门限（时间门限到期但增量为零时禁止空推）；真 usage 已到达后 API call 进行中的 text_delta 估算必须继续累加推送（不再整段拦截）；message_delta 真值到达时的覆盖语义必须保持不变（估算仅过程展示，emit 基线随之同步）。

#### 场景：低速生成定时跳

- Given 输出速度约 10 token/s（20 token 门限需 ~2s 才满足）
- When text_delta 连续到达
- Then usage_update 至少约每 500ms 推送一次（数字可见增长）

#### 场景：真值覆盖校正

- Given 估算累计 output=500 后 message_delta 真 usage output=480 到达
- When message_delta 处理
- Then 后端/前端显示以 480 为准，后续估算自 480 续算

### FR-05: 既有工具行/子代理块/任务卡片其余渲染与既有测试不回归

- 非 TaskOutput 等待形态的既有工具行、无快照命中的子代理块、无 Provider 宿主（dialog）渲染输出必须与改前一致（既有用例全绿）；SubagentTaskLookupContext 值类型扩展后所有既有消费方必须同步适配，禁止运行时 undefined 访问。

#### 场景：零回归守卫

- Given 既有 turn-segment-views / session-log-assembler 测试集
- When 相关模块测试运行
- Then 既有用例全部通过

### FR-06: 相关单测新增/更新并跑通

- 必须为 FR-01/FR-02/FR-04 新增单测用例并跑通（FR-03 接线层无既有组件测试面，按测试绑定节声明）；禁止为通过而修改既有测试断言（CLAUDE.md 规则 9）；禁止跑全量测试（CLAUDE.md 规则 0）。

#### 场景：新增用例绿

- Given 新增的等待行/快照收敛/双门限用例
- When vitest 运行相关文件
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「TaskOutput 等待行：任务名人话摘要与走秒/快照未命中回退/终态回归」
FR-02: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「快照终态收敛：running 元数据按快照收敛徽标与计数、终态不回退」
FR-03: 不适用：轮完成对账接线位于 session-panel-page 集成层，无既有组件测试面；收敛数据链（快照→卡片）由 use-session-tasks 既有 refreshSignal 机制承载，FR-02 已覆盖快照对账判定逻辑，接线手验
FR-04: sillyhub-daemon/tests/stream-json.test.ts「usage_update 双门限节流：时间门限兜底/零增量不推/真值覆盖后基线同步与超调回落校正」
FR-05: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx 既有用例回归全绿
FR-06: 同 FR-01/02/04/05 汇总（新用例 + 既有回归）
