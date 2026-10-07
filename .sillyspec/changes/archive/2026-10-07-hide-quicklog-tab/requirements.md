---
author: flow-machine-draft
created_at: 2026-10-07T12:25:23.852Z
---
# 需求规格（Requirements）— 2026-10-07-hide-quicklog-tab

## 功能需求

### FR-01: 桌面端与移动端变更中心 tab 栏不再渲染「快速修复」tab

- 变更中心 tab 栏（桌面 UnderlineNav + 移动端 tablist）必须不再渲染「快速修复」tab 项；`ChangesTab` 类型中的 `"quicklog"` 值、quicklog 视图渲染链路（QuicklogTable / QuicklogDrawer / 移动端 quicklog 卡片视图）禁止删除（深链存量入口仍依赖）。

#### 场景：主路径

- Given 用户打开 `/workspaces/[id]/changes`（默认或 `?tab=active` / `?tab=archive`）
- When 页面渲染完成
- Then tab 栏仅含「进行中」「已归档」两项，不存在「快速修复」tab 按钮（桌面 role=tab 与移动端 `m-changes-tab-*` 均无）

### FR-02: ?tab=quicklog 深链仍进入存量快速修复视图（工作区概览统计卡 / 变更详情关联快速任务卡 / 移动端详情重绘入口不失效）

- `/workspaces/[id]/changes?tab=quicklog`（桌面与移动端同参）必须仍进入存量快速修复视图：QuicklogTable/移动端 quicklog 卡片列表照常渲染、主列表查询不发（`enabled: tab !== "quicklog"` 语义保持）；三处既有深链入口文件（stats-row / quicklog-linked-card / mobile-change-detail）必须零改动。

#### 场景：深链进入

- Given 工作区存在存量 quicklog 条目
- When 用户经 `changes?tab=quicklog` 打开（如从概览统计卡点击）
- Then 页面展示 quicklog 列表，tab 栏无「快速修复」按钮但「进行中/已归档」可点击切回主列表

### FR-03: 深链存量视图内副标题计数、quicklog 搜索/筛选/详情抽屉/会话页等既有行为不变

- 深链存量视图内的既有行为必须不变：tabTotals 查询照常拉取 quicklog 计数（桌面副标题「N 条存量快速修复记录」回填）、QuicklogDrawer 详情抽屉、移动端筛选抽屉/详情 Sheet、quicklog 会话页路由均保持现状。

#### 场景：副标题计数

- Given quicklog 存量 total=7
- When 用户经 `?tab=quicklog` 进入
- Then 桌面副标题显示「7 条存量快速修复记录（旧 quick 通道已退役）」

### FR-04: 受影响的前端测试改为深链进入并全部通过（仅跑受影响测试文件）

- 依赖「点击快速修复 tab」进入 quicklog 视图的既有用例必须改为 `?tab=quicklog` URL 初始化进入，并为 tab 隐藏补缺席断言；必须仅运行受影响的两个测试文件（全量测试留给 CI）。

#### 场景：主路径

- Given 改造完成
- When 运行桌面与移动端 changes 页测试文件
- Then 全部通过，无因 tab 隐藏而失败的用例

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx「?tab=quicklog 深链进入存量视图，tab 栏不含快速修复且主 load 不发，切回进行中恢复」
FR-01: test/frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx「Tab 计数缓存含 quicklog，tab 栏徽标仅 active/archive 且 quicklog tab 缺席」
FR-02: test/frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx「FR-03 URL ?tab=quicklog：初始 tab 为快速修复（tab 缺席 + 不发主列表请求）」
FR-03: test/frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx「快速修复存量视图副标题计数显示（listQuicklogEntries total）」
FR-03: test/frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx「quicklog 视图搜索/筛选抽屉/详情 Sheet（既有用例改深链进入后原断言保持）」
FR-04: test/frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx + test/frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx「两文件全量用例通过（仅跑此两文件）」
