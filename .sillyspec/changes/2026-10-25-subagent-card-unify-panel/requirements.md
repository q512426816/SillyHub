---
author: flow-machine-draft
created_at: 2026-10-25T02:38:35.812Z
---
# 需求规格（Requirements）— 2026-10-25-subagent-card-unify-panel

## 功能需求

### FR-01: SubagentBlockView 删除内联展开分支：无面板上下文时渲染同款头部纯展示（不可点击），不再原地展开 children

- SubagentBlockView **必须**删除内联展开分支（open state / aria-expanded / children 原地渲染 / progressLine 展开区）；**禁止**在任何模式下原地展开。
- 无面板上下文（`useSubagentPanel()` 为 null）时**必须**渲染与紧凑卡片同款的头部纯展示（无 role=button、无 cursor-pointer、无键盘交互）；有面板上下文时行为**必须**与现状紧凑卡片一致（点击/Enter toggle 右栏，activeId 高亮）。
- 头部信息（状态点/名称/类型徽标/状态徽标/时长）**必须**在两种环境下一致。

#### 场景：无 Provider 宿主（回放/悬浮助手等）

- Given 渲染子代理段且无面板上下文
- When 查看卡片
- Then 头部信息完整展示，不可点击、无展开箭头语义，children 不挂载

#### 场景：整页会话（有 Provider）

- Given 会话整页点击子代理卡片
- When 点击/Enter
- Then 右栏打开详情（现状行为零变化）

### FR-02: 会话弹窗（dialog 模式）挂 SubagentPanelContext：点击紧凑卡片右侧滑出 Drawer，内嵌 SubagentDetailPanel 展示子代理完整内部过程

- `session-panel-dialog` **必须**挂 `SubagentPanelContext.Provider`（内部状态：activeId + open/close，toggle 语义）。
- 点击紧凑卡片**必须**在弹窗内右侧滑出 antd Drawer（尺寸与移动端同构 `min(92vw, 420px)`），内嵌既有 `SubagentDetailPanel`（完整 children 时间线）。
- 再点已激活卡片 / Drawer ✕ / 遮罩**必须**关闭（统一槽位出口）。
- 段失效（会话切换/重装配后 id 不存在）**必须**自动关闭；段解析用 `findSegmentById` DFS（与 page 模式同源逻辑）。

#### 场景：弹窗点击子代理卡片

- Given 弹窗会话消息流中的子代理卡片
- When 点击卡片头部
- Then 右侧 Drawer 滑出，展示该子代理完整内部过程；关闭后可再点其他卡片切换

#### 场景：会话切换

- Given Drawer 打开状态
- When 切换到另一个会话（段不存在）
- Then Drawer 自动关闭

### FR-03: 整页会话行为零变化（右栏详情照旧）

- `session-panel-page` 的右栏装配、宽度记忆、移动端 Drawer、宿主回调协议**必须**零改动。
- 无宿主且非移动端的旧悬浮形态（无 Provider）随 FR-01 变为纯展示头部——该形态无详情出口，属**已声明边界**。

#### 场景：整页回归

- Given 整页会话
- When 点击子代理卡片
- Then 右栏详情照旧（现有测试全绿）

### FR-04: 内联展开相关测试改写为纯展示断言；弹窗新增点击开 Drawer 用例；全部通过

- `turn-segment-views.test.tsx` 的内联展开用例（默认折叠/展开 children、运行中默认展开、嵌套展开、终态收敛折叠）**必须**改写为纯展示断言（头部信息在、children 不挂载、不可点击）；
- `agent-replay-body.test.tsx` 的 aria-expanded 断言**必须**随新形态更新；
- **必须**新增弹窗模式点击卡片开 Drawer 的用例（含关闭与切换）；
- 触及测试文件全部通过；lint / typecheck **必须**通过。

#### 场景：回归核验

- Given 完成实现
- When 运行相关测试与 lint
- Then 全部通过

### FR-05: 子代理卡片内嵌内部活动流动条（与外部跑马灯同款机制）

- 子代理卡片（紧凑卡片与纯展示两分支）**必须**在头部下方渲染一条内部活动流动条：复用 `TurnLiveMarquee`（新增 `layout="inline"` 变体），条目由 `deriveLiveMarqueeEntries(segment.children)` 派生。
- 流动行为**必须**与外部跑马灯一致：事件到达即进入轨道、只向最新推进、不循环；运行中条目转圈/走秒；内部工具完成后显示「等待模型响应」计时。
- 子代理 children 为空时**必须**不渲染流动条。
- inline 变体**必须**适配卡片布局（无 ml-9、w-full、更低矮、贴卡片底色），`data-testid` **必须**与外部区分（`subagent-live-marquee`）。

#### 场景：子代理运行中

- Given 子代理 running，内部已执行 Grep / Bash
- When 渲染卡片
- Then 头部下方流动条展示内部工具流动（转圈/走秒/等待指示），外部会话跑马灯仅显示「子代理：名称 状态 时间」

#### 场景：无 children

- Given 子代理容器段无 children（刚派发）
- When 渲染卡片
- Then 不渲染流动条，仅头部

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「无 Provider 渲染纯展示头部：信息完整、不可点击、children 不挂载」
FR-02: frontend/src/components/daemon/__tests__/session-panel-dialog-subagent-drawer.test.tsx「点击子代理卡片打开 Drawer 详情，再点关闭」
FR-03: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「紧凑卡片模式（subagent-three-pane）」既有用例组（零回归）
FR-04: frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx 既有断言随新形态更新 + 上述新增用例；lint / typecheck 另行核验
FR-05: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「子代理卡片内嵌内部活动流动条（FR-05）」+「无 children 不渲染流动条（FR-05）」
