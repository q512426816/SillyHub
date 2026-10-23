---
author: flow-machine-draft
created_at: 2026-10-23T01:22:36.798Z
---
# 需求规格（Requirements）— 2026-10-22-askuser-dock-inputbar

## 功能需求

### FR-01: pending AskUser 问答卡渲染于真会话底部输入框位置（互斥替换 SessionInputBar，session-panel-page 与 session-panel-dialog 两挂载点同款），时间线滚动区不再渲染 pending 卡

- 会话存在 pending AskUser 提问（permission_request.dialog_kind）且会话非终态时，底部输入框位置必须渲染问答卡区（新组件 PendingDialogDock）且必须不渲染同位置的 SessionInputBar（互斥）；TurnTimeline 必须移除 pending 卡渲染与相关 props（pendingRequests/onDialogResolved/focusDialogRequest），时间线滚动区内禁止出现待答卡。

#### 场景：pending 到达

- Given 真会话输入框可见、无 pending 提问
- When SSE 推送 permission_request（dialog_kind 存在）
- Then 输入框位置被问答卡区替换（输入框不渲染），时间线内无待答卡

#### 场景：两挂载点一致

- Given session-panel-page 与 session-panel-dialog 各自渲染真会话
- When pending 提问到达
- Then 两种挂载形态均在输入框位置渲染问答卡区（互斥逻辑同款）

### FR-02: 问答卡区有固定最大高度（约 45vh 量级），内容超出时区内上下滚动；提交回答或 resolved 后输入框自动恢复

- 问答卡区必须设固定最大高度（max-h-[45vh]）并区内 overflow-y-auto（加 overscroll-contain 防滚动穿透到日志区）；卡区必须与 SessionInputBar 同宽对齐（px-5 边距、shrink-0 bg-card 底色）；pendingRequests 清空（提交回答 / permission_resolved 过滤）后必须自动恢复渲染 SessionInputBar（输入值等受控 state 在父级，不丢失）。

#### 场景：超高内容内滚

- Given 问答卡内容（多问题/多选项）总高超过 45vh
- When 渲染卡区
- Then 卡区高不超过 45vh，区内可上下滚动，日志区滚动位置不随卡区滚动联动

#### 场景：答完恢复

- Given 输入框被问答卡区替换
- When 用户提交回答且 permission_resolved 到达（pendingRequests 过滤为空）
- Then 问答卡区卸载、SessionInputBar 恢复显示

### FR-03: 最小化（收起为右下角胶囊）与待决策 pill 定位还原能力保留，pill 点击还原+高亮闪烁（不再滚顶）

- 问答卡必须保留最小化按钮（收起为右下角浮动胶囊，已填内容随挂载保留，胶囊点击还原）；待决策 pill 点击必须触发「无条件还原 + 卡区 ring 高亮闪烁 ~1.2s 自清」，且必须去除原「滚动容器滚顶」步骤（卡区不在时间线滚动区内）。

#### 场景：最小化与还原

- Given 1 张展开的问答卡
- When 点击卡头最小化（卡收起、右下角胶囊出现角标 1）→ 点击胶囊
- Then 卡还原且已选选项/手动输入原样保留

#### 场景：pill 定位

- Given 一张已最小化的待答卡与待决策 pill（session-panel-page 挂载点）
- When pill 点击该 requestId
- Then 卡还原、卡区出现 ring 高亮闪烁 1.2s 自清，日志滚动位置不被强制滚顶

### FR-04: ended/failed 会话不渲染问答区，输入框正常显示

- 会话状态为 ended/failed 时必须不渲染问答卡区（残留 pending 行为死卡），SessionInputBar 必须正常渲染（终态占位文案）。

#### 场景：终态会话

- Given 会话 ended 且存在残留 pending 提问数据
- When 面板渲染
- Then 输入框位置渲染 SessionInputBar（终态占位文案），无问答卡区

### FR-05: TurnTimeline 移除 pending 卡渲染与相关 props，群聊面板零变化，受影响测试全绿 + tsc 零错

- group-chat-panel 的 AskUserDialogCard 渲染路径必须零变化；本次触及的测试套件必须全部通过，tsc --noEmit 必须零错误；禁止跑全量测试（全量留给 CI）。

#### 场景：验证

- Given 改动完成
- When 运行受影响套件（pending-dialog-dock 新测试 + session-panel-dialog 回归 + turn-timeline 相关回归）与 tsc
- Then 全绿/零错

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/pending-dialog-dock.test.tsx「pending 到达渲染卡区（互斥由挂载点条件渲染承担，dock 渲染卡列断言）」（新文件，由 turn-timeline-dialog-minimize.test.tsx 迁移改写）
FR-02: frontend/src/components/daemon/__tests__/pending-dialog-dock.test.tsx「卡区 max-h + overflow-y-auto 类名断言」（新用例）；恢复语义由挂载点条件渲染测试覆盖（session-panel-dialog 既有套件回归）
FR-03: frontend/src/components/daemon/__tests__/pending-dialog-dock.test.tsx「还原保留已填内容：选项 + 手动输入原样恢复」（迁移用例）+「focusRequest 触发还原」（新增用例）
FR-04: frontend/src/components/daemon/__tests__/pending-dialog-dock.test.tsx「ended 会话不渲染卡区（胶囊同样不渲染）」（迁移用例）
FR-05: frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx 既有套件回归 + tsc --noEmit（命令实测）
