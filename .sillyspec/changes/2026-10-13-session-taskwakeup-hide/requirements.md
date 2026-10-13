---
author: flow-machine-draft
created_at: 2026-10-13T03:20:05.999Z
---
# 需求规格（Requirements）— 2026-10-13-session-taskwakeup-hide

## 功能需求

### FR-01: 回放（logsToTurns）与实时 SSE 两路径：[后台任务通知] 开头的 user_input 不再生成 preamble 段，进度视图无对应「上下文注入」卡

- 回放（logsToTurns）与实时 SSE 两条装配路径，必须对以「[后台任务通知]」前缀开头的 user_input 注入跳过 preamble 段生成（进度视图不再出现对应「上下文注入」卡）；该类注入是纯系统通知，禁止以 preamble 段形式进入段模型。

#### 场景：回放路径

- Given：历史日志中某轮首条 user_input 为「[后台任务通知] …」（无用户正文）；
- When：logsToTurns 装配该轮；
- Then：turn.segments 不含该通知对应的 preamble 段，进度视图该轮无「上下文注入」卡。

#### 场景：实时路径

- Given：会话运行中，SSE user_input 事件 content 以「[后台任务通知]」开头；
- When：upsertTurn 应用该事件；
- Then：不追加 preamble 段（prompt 补写逻辑不受影响，仍剥空不写）。

### FR-02: 开轮占位槽语义不变：系统通知开轮的轮 prompt 保持空、中途真实消息仍转 user_msg 段按 ts 插入

- 本变更必须保持 2026-10-10-system-opened-turn-usermsg 的开轮占位槽语义不变：系统通知开轮的轮 prompt 必须保持空（顶部无用户气泡），中途到达的真实用户消息必须转 user_msg 段按时间戳插入轮内输出之间；既有三用例（开轮+中途消息 / 唯一开轮 / 正常轮不受影响）禁止回归。

#### 场景：回归守卫

- Given：run 4296aa6a 形态日志（通知开轮 → 输出 → 中途真实消息 → 输出）；
- When：logsToTurns 装配；
- Then：prompt 为空、user_msg 段位于两段输出之间（与改前一致）。

### FR-03: 消息队列条 TASK_WAKEUP 条目 chip 摘要与展开正文均不再显示「[后台任务通知]」前缀，仅显示通知正文

- 消息队列条中 TASK_WAKEUP 系统通知条目，chip 摘要（40 字截断）与点击展开的完整正文必须去除「[后台任务通知]」前缀，仅显示通知正文本身；前缀字面量禁止再出现在队列条 UI 上。

#### 场景：chip 摘要与展开态

- Given：队列含 prompt 为「[后台任务通知] 后台任务已完成」的 pending 条目；
- When：渲染队列条并点击该条目展开；
- Then：折叠摘要显示「后台任务已完成…」（无前缀、无多余空格），展开态正文同样无前缀；条目状态图标 / 不可编辑（D-009）等既有行为不变。

### FR-04: 【变更上下文】等真实上下文前导的 preamble 卡与既有队列条行为不变

- 真实上下文前导（【变更上下文】/【页面上下文】/【团队任务简报】/【群聊上下文】/【影子直聊】及 [GROUP_CHAIN] 标记行）的 preamble 提取/剥除/展示行为必须与改前一致；普通（非 TASK_WAKEUP）队列条目的摘要、展开、编辑、删除等行为禁止变化。

#### 场景：真实前导不误伤

- Given：user_input 为「【页面上下文】…\n\n---\n\n帮我修下登录页的样式」；
- When：logsToTurns 装配；
- Then：preamble 段照旧生成（含前导文本），prompt 为剥后正文（与改前一致）。

### FR-05: 相关单测更新/新增并跑通

- 本变更必须为 FR-01/FR-03 新增可判定用例、FR-02/FR-04 以既有用例作回归守卫，且只跑本变更相关测试文件（禁止全量测试，全量留给 CI）；实现与非测试逻辑冲突时禁止改测试凑绿。

#### 场景：验收

- Given：本变更代码与测试就绪；
- When：运行本变更涉及的测试文件；
- Then：全部用例通过（含既有用例无回归）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「系统通知注入不产出 preamble 段（进度视图无上下文注入卡）」
FR-02: test/frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「系统通知开轮 + 中途消息：prompt 保持空，消息转 user_msg 段按 ts 插入输出之间」（既有用例回归守卫）
FR-03: test/frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx「TASK_WAKEUP 条目 chip 摘要与展开正文不显示 [后台任务通知] 前缀」
FR-04: test/frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「前导条 + 干净条双写（常规形态）→ 剩余正文与干净条同主体归并，prompt 不双显」（既有用例回归守卫）
FR-05: 不适用：本 FR 为测试组织性要求，由 FR-01～FR-04 绑定用例承载，无独立测试面。
