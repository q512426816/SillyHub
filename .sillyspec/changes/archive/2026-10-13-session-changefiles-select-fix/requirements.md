---
author: qinyi
created_at: 2026-10-13T15:35:00+08:00
---
# 需求规格（Requirements）— 2026-10-13-session-changefiles-select-fix

## 功能需求

### FR-01: antd Select 下拉 DOM 挂进宫 DialogContent 内（getPopupContainer=closest role=dialog），真实浏览器中选项可点击切换变更

- 弹窗内变更切换 Select 的下拉 DOM **必须**挂载在弹窗节点（`[role="dialog"]`）子树内，保证下拉项在 radix modal 遮罩下可点击；`closest` 未命中时**可以**回落 `document.body`（不劣化）。

#### 场景：主路径
Given 悬浮面板弹窗已打开（radix Dialog modal 模式，body pointer-events:none）
When 用户点开头部变更切换下拉
Then 下拉项 DOM 位于 `[role="dialog"]` 内（可点击、不触发弹窗 outside-close）

### FR-02: 下拉选择后 ChangeFileTree 以新 changeId 重挂载（既有切换用例保持全绿并加挂载位置断言）

- 下拉选中新变更后，文件树组件**必须**以新 changeId 重挂载（key 变化），且下拉挂载位置断言**必须**随用例守护。

#### 场景：主路径
Given 弹窗内当前展示变更 A 的文件树
When 通过下拉选中变更 B
Then ChangeFileTree 重挂载为 changeId=B（autoRefreshMs=15000 不变），选项元素经断言确认在弹窗 DOM 内

### FR-03: 轻量变更（is_thin 且 current_stage=thin）的阶段标签显示「干活中」不再「轻量·轻量变更」重复

- `current_stage === "thin"` 时阶段标签**必须**显示「干活中」（原型口径），**禁止**显示「轻量变更」致与 is_thin 徽标「轻量」拼成「轻量·轻量变更」重复。

#### 场景：主路径
Given 关联变更为轻量变更进行中（is_thin=true 且 current_stage=thin）
When 悬浮下拉渲染该项
Then 阶段 pill 文本为「干活中」，页面无「轻量变更」文本

### FR-04: 前端聚焦测试全绿 + tsc 0 错

- 本变更组件测试**必须**全绿且 `tsc --noEmit` **必须**零错误。

#### 场景：主路径
Given 修复代码与测试就位
When 跑悬浮组件测试文件 + tsc
Then 用例全绿（含新增「干活中」用例与下拉挂载位置断言），tsc 零错误

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「弹窗头部 Select 切换变更：ChangeFileTree key 重挂载换 changeId」（selectAntdOption 内含 `option.closest('[role="dialog"]')` 挂载位置守护断言）
FR-02: test/frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「弹窗头部 Select 切换变更：ChangeFileTree key 重挂载换 changeId」（treeMounts 断言重挂载 + changeId=c-3）
FR-03: test/frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「轻量变更进行中（current_stage=thin）阶段标签为「干活中」——不拼出「轻量·轻量变更」重复」
FR-04: test/frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx（8 用例全绿）+ tsc --noEmit 0 错（实测回执见 flow done 账本）
