---
author: flow-machine-draft
created_at: 2026-10-23T02:25:19.310Z
---
# 需求规格（Requirements）— 2026-10-23-live-turn-meta-time

## 功能需求

### FR-01: 进行中（running/pending/interrupting）轮次底部元信息行只显示「开始 HH:MM:SS · 历时 mm:ss」，无「结束」字样，历时随时间每秒递增

- 会话页轮次底部元信息行（对话视图 RoundDivider.detail / 全部视图 turn-meta-detail）对进行中轮次（running/pending/interrupting）必须只显示「开始 HH:MM:SS · 历时 mm:ss」两段；禁止显示「结束」段与恒为 00:00 的假历时；「历时」必须显示当前轮次实时总耗时（now − turnStartedAt）且每秒递增（与轮次顶部 TurnStatusBar 走秒同源行为）。

#### 场景：进行中轮次底部元信息（主路径）

- Given：某轮处于 running（pending/interrupting 同理）且计时锚点 turnStartedAt 有值
- When：渲染轮次底部元信息行
- Then：行内含「开始 HH:MM:SS」与「历时 mm:ss」（mm:ss ≥ now−turnStartedAt 向下取整）；无「结束」字样；随时间推移 mm:ss 每秒 +1

#### 场景：进行中但数据层仍带 replyAt（防御）

- Given：某轮处于运行中三态，但挂载方数据仍把 replyAt 填成 started_at（旧路径/旁路装配）
- When：渲染轮次底部元信息行
- Then：仍按运行中分支显示（isLiveTurn 优先于 replyAt 判定），不显示「结束」

#### 场景：进行中但计时锚点缺失

- Given：运行中三态轮 turnStartedAt 为 null/undefined
- When：渲染轮次底部元信息行
- Then：不显示时间细节（不编造开始/历时，既有容错语义保持）

### FR-02: 轮次完成后该行恢复「开始 · 结束 · 历时」三段（既有行为不变）

- 轮次进入终态（completed/failed/killed）后，底部元信息行必须恢复既有「开始 HH:MM:SS · 结束 HH:MM:SS · 历时 mm:ss」格式（replyAt 锚点存在时）；replyAt 缺失时保持既有回退（仅显结束或不显示）。数据层 enrichDisplayTurns 对活跃 run（running/pending/pending_approval）禁止把 replyAt 回退成快照 started_at（该回退正是「结束=开始时刻」错显根因）；终态轮的既有回退链保持不变。

#### 场景：运行中 → 完成态切换

- Given：一轮从 running 转为 completed（replyAt=finished_at 到达）
- When：重渲染该轮
- Then：底部元信息行变为「开始 X · 结束 Y · 历时 Y−X」，实时走秒组件卸载（定时器清理）

#### 场景：活跃 run 快照补齐不再伪造 replyAt

- Given：run 快照 status=running、finished_at=null、started_at=10:00:00
- When：enrichDisplayTurns 补齐该轮
- Then：该轮 replyAt 为 null（不得回退成 started_at 字符串）；终态 run（无 finished_at 旧数据）回退 started_at 的既有行为不变

### FR-03: 终态轮（无进行中态）显示零回归，既有 turn-time-display 测试全绿

- 本变更必须保持终态轮全部既有显示零回归：完成轮双锚点三段显示、仅 replyAt 回退单显结束、轮次时间三段显示既有测试（turn-time-display.test.tsx）全绿；RoundDivider.detail 类型由 string 放宽为 ReactNode 对既有字符串消费方必须保持兼容（string 是 ReactNode 子类型，零迁移）。

#### 场景：完成轮双锚点（回归锁定）

- Given：turnStartedAt + replyAt 双锚点的 completed 轮
- When：渲染
- Then：同既有契约——唯一一条元信息行含轮号/状态/开始/结束/历时，全页面「历时」只出现一次

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/src/components/daemon/__tests__/turn-time-display.test.tsx「进行中轮次：底部元信息只显开始+实时历时，无结束字样（fake timers 走秒递增）」
FR-02: test/src/components/daemon/__tests__/turn-time-display.test.tsx「进行中→完成：元信息行切换为开始·结束·历时三段（走秒组件卸载）」+ test/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「活跃 run 快照（finished_at=null）不再把 replyAt 回退成 started_at」
FR-03: test/src/components/daemon/__tests__/turn-time-display.test.tsx「既有完成轮/仅 replyAt 回退/进度视图用例全绿（零回归）」
