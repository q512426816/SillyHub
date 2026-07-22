---
author: qinyi
created_at: 2026-07-22 22:35:31
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 移动端用户 | 用手机（≤768px）访问平台，使用 PPM 工作台/计划任务/问题清单与工作区选择 |
| 桌面端用户 | 用电脑访问，沿用现有 web UI，行为不应受本次变更影响 |

## 功能需求

### FR-01: 设备自动分流（middleware rewrite，无 FOUC）
覆盖决策：D-002@v2, D-005
- Given 用户用手机（移动 UA）访问 `/ppm/workbench`、`/ppm/task-plans`、`/ppm/problem-list`、`/workspaces`、`/login`
- When 请求到达 `src/middleware.ts`
- Then 请求被 rewrite 到 `/m/<原路径>`，渲染移动 App UI；浏览器地址栏 URL 保持原值不变
- Given 手机首屏渲染
- When 页面加载完成
- Then 直接为移动版，**无桌面版闪烁（FOUC）**
- Given UA 异常 / 不可识别 / 桌面 UA
- When 请求到达 middleware
- Then 不 rewrite，走桌面路由（默认桌面，避免误判）

### FR-02: 移动外壳 + 底部 5 Tab 导航
覆盖决策：D-001, D-004
- Given 用户在 `/m/` 任一移动页面
- When 页面渲染
- Then 显示移动顶栏（页面标题/返回）+ 内容区 + 固定底部 TabBar
- Given 底部 TabBar
- When 渲染
- Then 含 5 项：工作台、计划任务、问题清单、我的、平台切换；当前页对应 Tab 高亮
- Given 用户点击某 Tab
- When 导航
- Then 跳转对应路径（手机访问自动 rewrite 到 `/m/` 版）
- Given 用户点击「平台切换」
- When 在 PPM 视角
- Then 导航到 `/workspaces`（手机自动 rewrite 到 `/m/workspaces`）

### FR-03: 移动登录页
- Given 未登录用户用手机访问任意受保护移动页
- When 重定向到登录
- Then 显示移动 App 风格登录页，登录成功后回到目标移动页
- Given 登录态复用
- When 移动端登录
- Then 使用与桌面同一套 auth（token/store），不另建认证

### FR-04: 个人工作台移动视图（全功能）
覆盖决策：D-001, D-008
- Given 手机访问 `/m/ppm/workbench`
- When 渲染
- Then 显示卡片流（待办、快捷入口、统计），桌面三栏在移动端排成纵向单列
- Given 工作台各交互入口
- When 用户操作
- Then 与桌面端等价的功能在移动端可用（D-008 对齐）

### FR-05: 计划任务移动视图（全功能）
覆盖决策：D-007, D-008
- Given 手机访问 `/m/ppm/task-plans`
- When 渲染
- Then 显示卡片列表（每条任务一张卡片：任务名/状态/负责人等关键字段），替代表格
- Given 卡片操作集
- When 用户触发编辑/删除/执行/进详情
- Then 对应功能可用（Modal/全屏表单/详情页承载）
- Given 顶部工具区
- When 用户新建 / 导出 Excel / 批量选择删除 / 展开筛选
- Then 各功能在移动端可用，分页对接现有 page/page_size

### FR-06: 问题清单移动视图（全功能）
覆盖决策：D-007, D-008
- Given 手机访问 `/m/ppm/problem-list`
- When 渲染
- Then 显示卡片列表，筛选条件由顶部按钮唤起的 FilterDrawer 承载
- Given 卡片操作集 + 顶部工具区
- When 用户执行新建/编辑/导出/批量删除/进详情/改状态
- Then 各功能在移动端可用（与 FR-05 同模式）

### FR-07: 工作区选择移动视图（列表全功能 + 详情提示电脑端）
覆盖决策：D-006, D-008
- Given 手机访问 `/m/workspaces`
- When 渲染
- Then 显示工作区卡片列表，可浏览/选择/切换当前工作区，可创建/绑定/编辑别名（D-008 全做）
- Given 用户在移动端选中某工作区后试图进入其详情/变更中心等后续功能
- When 触发
- Then 提示「请在电脑端打开」，不渲染桌面详情（D-006）

### FR-08: 数据层 100% 复用 + 桌面完全零回归
覆盖决策：D-003
- Given 移动视图需要数据
- When 获取
- Then 复用现有 `lib/*` API 函数、Zustand stores、OpenAPI 类型，**禁止自写请求**
- Given 桌面端任意页面
- When 电脑访问
- Then 渲染产物与变更前完全一致；`app/(dashboard)/**`、`app-shell.tsx`、`(auth)/login`、后端代码 git diff 为空

### FR-09: 断点 token + 样式文档
- Given 样式系统
- When 本次变更
- Then `tokens.ts` 新增 breakpoint token；`FRONTEND_PAGE_STYLE.md` 新增「移动端 App UI」章节并更新原「移动端非目标」条款

## 非功能需求

- **兼容性**：桌面端完全零回归；后端 API/表结构不变；UA 异常默认桌面。
- **可回退**：`/m/` 直接访问可渲染移动版；middleware 未命中路径回退桌面。
- **可测试**：Vitest 单测覆盖 middleware rewrite、移动外壳、MobileCardList；移动路由有对应测试；守卫逻辑公共函数单测。
- **性能**：middleware 轻量，matcher 精确限定目标页面、排除静态资源。
- **触摸与无障碍**：移动组件最小触摸目标 44×44px，正文字号 ≥14px。
- **守卫一致性**：移动 `app/m/layout.tsx` 用独立 `lib/auth/route-guard.ts` 守卫，`(dashboard)/layout.tsx` 不改（桌面零回归）；route-guard 单测镜像桌面守卫行为 + 注释锚点（R-10）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02, FR-04 | 独立 App UI（非响应式） |
| D-002@v2 | FR-01 | middleware rewrite 到 `/m/`，URL 不变，真防 FOUC（supersedes D-002@v1） |
| D-003@v1 | FR-08 | 数据层共享，UI 独立 |
| D-004@v1 | FR-02 | 底部 5 Tab |
| D-005@v1 | FR-01 | 仅手机 ≤768px，平板走桌面 |
| D-006@v1 | FR-07 | SillyHub 仅 workspaces 列表，详情提示电脑端 |
| D-007@v1 | FR-05, FR-06 | 表格改卡片列表 |
| D-008@v1 | FR-04, FR-05, FR-06, FR-07 | 手机端功能尽量全做 |

全部当前版本决策（D-001、D-002@v2、D-003~D-008）已被 FR 覆盖，无未覆盖决策。D-002@v1 已 superseded。
