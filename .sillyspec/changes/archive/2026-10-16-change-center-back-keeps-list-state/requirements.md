---
author: flow-machine-draft
created_at: 2026-10-16T13:17:35.193Z
---
# 需求规格（Requirements）— 2026-10-16-change-center-back-keeps-list-state

## 背景与动机

变更中心列表页的 tab（进行中/已归档）与页码是组件本地 useState，不进 URL。行点击进详情走
`window.location.assign` 整页导航，而详情页 breadcrumb「变更列表」/错误态「← 变更列表」
是客户端导航回无参 `/changes`——列表组件重新挂载，tab/页码全部重置。用户实证：切「已归档」
或翻页后进详情再点返回入口，回不到之前的数据页（浏览器后退因 bfcache 能恢复，仅返回入口
点击坏，符合用户「其他形式不用管」的范围界定）。

修复双管齐下：①列表筛选/分页状态同步进 URL（返回时列表从 URL 恢复状态，不依赖 bfcache）；
②详情页返回入口在可后退时改为 `router.back()`（回带 query 的列表 URL）。

## 功能需求

### FR-01: 列表页 tab/页码/搜索/阶段/分类/聚焦/排序/pageSize 同步写进 URL

变更中心列表页的 tab、页码、pageSize、搜索词、阶段筛选、分类筛选、只看待我处理、排序方向
发生变化后，页面 URL 的 querystring 必须同步反映当前状态（空值/默认值参数省略）；写入必须
使用原生 `history.replaceState`（不得新增浏览器历史条目、不得触发 Next RSC 导航请求）；
组件挂载时必须从 URL query 初始化上述全部状态（非法值防御性回退默认：tab∈{active,archive,
quicklog} 之外回 active，page 非正整数回 1，pageSize∉{10,20,50,100} 回 20，stage/lineage
不在枚举内回空，sort 不在枚举内回 updated_at_desc，mine 非 "1" 回 false）。

#### 场景：切已归档 tab 后 URL 同步

- Given 用户在变更中心列表页
- When 点击「已归档」tab
- Then URL 变为 `?tab=archive`，历史条目数不变（replaceState 语义）

#### 场景：翻页后 URL 同步

- Given 用户在变更中心列表页
- When 翻到第 3 页
- Then URL 变为 `?page=3`

#### 场景：从 URL 初始化（深链/返回恢复）

- Given 用户以 `/changes?tab=archive&page=3` 打开列表页（深链或从详情返回）
- When 列表页挂载
- Then 主列表请求以 location=archive、page=3 发出，tab 栏高亮「已归档」

### FR-02: 详情页返回入口可后退时走 router.back()

变更详情页 breadcrumb「变更列表」与错误态「← 变更列表」两个返回入口，在浏览器历史可后退
（`window.history.length > 1`）时，点击必须调用 `router.back()` 并阻止默认导航——回到
离开前的列表 URL（带 query），列表页从 URL 恢复 tab 与页码；入口元素必须保留指向默认列表
的 href（新标签打开/收藏语义不变）。

#### 场景：从列表进详情后点返回

- Given 用户在列表第 3 页已归档 tab（URL 带 `?tab=archive&page=3`）整页导航进详情
- When 点击 breadcrumb「变更列表」
- Then 触发 `router.back()`，回退到带 query 的列表 URL，列表恢复已归档 tab 第 3 页

### FR-03: 无历史可退时返回入口保持 Link 兜底

变更详情页在无浏览器历史可后退（`window.history.length <= 1`，新标签深链详情）时，返回
入口必须保持原 Link 行为跳转默认列表 `/workspaces/<id>/changes`（不带 query）。

#### 场景：新标签深链详情后点返回

- Given 用户新标签直接打开详情页（history.length = 1）
- When 点击 breadcrumb「变更列表」
- Then 走 Link 默认导航到无参列表页（不调用 router.back）

### FR-04: 测试零回归 + 新增行为断言

列表页既有测试必须全部保持通过；必须新增覆盖：URL 初始化（`?tab=archive&page=3` 深链）、
tab 切换/翻页后 URL 写回；详情页必须新增覆盖：可后退时点击调 `router.back()`、无历史时
不调用（Link 兜底）。

#### 场景：回归与新增断言

- Given 前端测试套件
- When 运行列表页与详情页相关测试文件
- Then 既有用例零回归，新增用例全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx「?tab=archive&page=3 深链：主 load 按已归档第3页请求」「切已归档 tab 后 URL 写回 tab=archive」「翻页后 URL 写回 page=N」
FR-02: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-back-to-list.test.tsx「历史可后退时点返回入口调 router.back()」
FR-03: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-back-to-list.test.tsx「无历史可退时不调 router.back() 走 Link href」
FR-04: frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx（既有用例全量回归）+ frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx（详情页既有用例回归）
