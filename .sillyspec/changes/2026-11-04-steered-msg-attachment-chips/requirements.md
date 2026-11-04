---
author: flow-machine-draft
created_at: 2026-11-04T06:22:01.389Z
---
# 需求规格（Requirements）— 2026-11-04-steered-msg-attachment-chips

## 功能需求

### FR-01: 引导消息三态（引导中/已投递/未投递）气泡内解析标记行并渲染附件 chips，与主用户气泡一致

- **必须**：`UserMsgSegmentView` 渲染前解析段正文头部的 `[附件:<uuid>|<kind>|<name>]` 标记行（`parseAttachmentMarkers`），把解析出的 attachments 交给 `AttachmentChips` 渲染；引导中 / 已投递 / 未投递三态一律渲染，不得丢弃。

#### 场景：已投递引导消息带图片与文件附件

- Given 引导段 text = 两行标记（一行 image、一行 file）+ 正文
- When 渲染 `UserMsgSegmentView`（phase=delivered）
- Then 气泡内出现图片缩略图与文件名 chip 各一个，且状态文案「✓ 已投递，agent 已收到引导」仍在

#### 场景：引导中 / 未投递两态同样渲染 chips

- Given 同一段文本，phase=steering 或 phase=ended
- When 渲染 `UserMsgSegmentView`
- Then 两态均出现附件 chips（不因样式弱化而丢失附件）

### FR-02: 图片附件显示缩略图、文件附件显示文件名 chip，点击均可弹出预览

- **必须**：附件 chips 复用既有 `AttachmentChips`（图片 → 缩略图、文件 → 文件名按钮），点击必须打开 `FilePreviewModal` 预览，不得降级为不可点击文本。

#### 场景：点击引导气泡内的文件 chip

- Given 引导段带一个 file 附件
- When 用户点击该 chip
- Then 预览弹窗打开（`data-open=true`）

### FR-03: 正文仍剥离标记行不重复展示；纯附件（正文为空）引导消息只渲染 chips 与状态行，不出现空正文气泡

- **必须**：气泡正文只渲染剥离标记行后的文本；**禁止**把 `[附件:...]` 原始标记作为正文显示。
- **必须**：正文剥离后为空时，不渲染空正文容器，只渲染 chips 与三态状态行。

#### 场景：纯附件引导消息

- Given 引导段 text 只有标记行、无正文
- When 渲染 `UserMsgSegmentView`
- Then 出现附件 chips 与状态行，页面中不存在空正文节点

#### 场景：带正文的引导消息

- Given 引导段 text = 标记行 + 「请看这个」
- When 渲染
- Then 正文只显示「请看这个」，不出现 `[附件:` 字样

### FR-04: 新增/更新相关前端测试并通过，tsc/lint 无新增错误

- **必须**：新增覆盖 FR-01~FR-03 的组件测试并运行通过；本次触及文件的 `tsc` 与 `lint` 无新增错误。

#### 场景：回归闸门

- Given 本次改动落盘
- When 运行相关测试 + `tsc` + lint
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-segment-views-user-msg-attachments.test.tsx「引导段三态均渲染附件 chips」
FR-02: frontend/src/components/daemon/__tests__/turn-segment-views-user-msg-attachments.test.tsx「点击引导气泡内文件 chip 打开预览」；frontend/src/components/daemon/__tests__/attachment-chips.test.tsx「文件 chip 可点击并触发预览」
FR-03: frontend/src/components/daemon/__tests__/turn-segment-views-user-msg-attachments.test.tsx「纯附件引导消息不渲染空正文」
FR-04: 不适用：本 FR 为工程闸门（tsc / vitest / lint 的执行结果），无独立断言面
