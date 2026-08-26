---
author: qinyi
created_at: 2026-08-27 00:19:07
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 工作区成员 | 手机浏览器访问平台的登录用户，查看/操作自己有权限的工作区变更与会话 |
| 桌面用户 | PC/平板 UA 用户，行为与本变更完全无关（零回归对象） |

## 功能需求

### FR-01: 工作区入口解除门禁
覆盖决策：D-001@V1, D-004@V1
Given 已登录用户在 `/m/workspaces` 列表页看到工作区卡片
When 点击卡片
Then 导航到 `/m/workspaces/[id]`（经主页 redirect 落到变更列表），不再提示"请在电脑端打开"

### FR-02: 工作区主页与双 Tab 导航
覆盖决策：D-004@V1
Given 用户位于 `/m/workspaces/[id]/changes` 或 `/m/workspaces/[id]/sessions`
When 顶栏段控切换「变更中心 / 会话」
Then 路由跳转到对应列表页（真实路由，非 query）；顶栏显示返回箭头（→ /m/workspaces）与工作区名

### FR-03: 变更列表（三 Tab + 搜索 + 筛选）
覆盖决策：D-001@V1, D-002@V1
Given 用户位于 `/m/workspaces/[id]/changes`
When 切换 进行中/已归档/快速修复 Tab
Then 列表与计数徽标（["changesTabTotals"]）刷新；进行中列表按 changesRefetchInterval 语义智能轮询
When 输入关键词或打开筛选抽屉（阶段/只看待我处理）后应用
Then 列表按条件过滤（query key 含全参数，与桌面同构）
When 点击变更卡片
Then 全屏钻取到 `/m/workspaces/[id]/changes/[cid]`

### FR-04: 变更详情与审批操作
覆盖决策：D-002@V1
Given 用户位于变更详情页
Then 可见：阶段步骤条、审批操作卡（有待办时默认展开）、规范文档列表、阶段时间线、执行日志（折叠）、关联会话卡、任务区桌面引导条
When 点击 通过/驳回
Then 调 submitStageReview 真实生效并刷新详情
When 点击文档
Then 复用 FilePreviewModal 打开全屏预览
When 点击关联会话卡
Then 跳转移动会话列表

### FR-05: 快速修复（quicklog）Tab
Given 用户在变更列表切到「快速修复」Tab
Then 展示 quicklog 卡片列表（listQuicklogEntries + quicklogPollInterval 轮询语义）
When 点击条目
Then MobileDetailSheet 全屏展示详情

### FR-06: 会话列表
覆盖决策：D-001@V1, D-003@V1
Given 用户位于 `/m/workspaces/[id]/sessions`
Then 展示按机器分组的会话卡片（在线/离线分组、状态 Tab 全部/进行中/已归档）；数据用 listAgentSessions + workspace_id，query key 与桌面门户同构共享缓存
When 点击会话卡片
Then 全屏钻取到 `/m/workspaces/[id]/sessions/[sid]`
When 通过卡片菜单执行 删除/归档/取消归档
Then 调既有 API 生效并刷新列表

### FR-07: 会话对话（SessionPanel 第四宿主，完整内核）
覆盖决策：D-003@V1
Given 用户位于 `/m/workspaces/[id]/sessions/[sid]`
Then 直接渲染 SessionPanel(mode="page", key=sid)，具备桌面同等全部能力：SSE 流式对话、发消息、中断、结束/重开、消息队列、子代理目录、上下文用量；样式经 variant="mobile" 适配竖屏（次要 chrome 收纳进 ⋯ 菜单）
When 会话被切换（路由 sid 变化）
Then key 变化触发重挂载，SSE/队列状态干净重建（既有契约）

### FR-08: 新建会话（两步浮层移动化）
Given 用户在会话列表点 ＋
When 依次选择机器、智能体（PreSessionPicker variant="bottomSheet" 底部抽屉两步）
Then 进入预会话态（SessionPanel sessionId=null + preContext），首句发送 createSession 成功后切真会话路由

### FR-09: 布局层级（列表 vs 钻取）
Given 用户位于列表页（changes / sessions）
Then 保留底部 5 Tab（平台切换高亮）；位于钻取页（changes/[cid]、sessions/[sid]）
Then 隐藏底部 Tab，页面自渲染返回顶栏（m/layout DRILL_ROUTES 分支）

### FR-10: 深链兜底
Given 手机 UA 访问桌面专属门户 URL `/workspaces/[id]/changes/[cid]/sessions` 或 `/workspaces/[id]/quicklog/[qlId]/sessions`
Then redirect 到 `/m/workspaces/[id]/sessions`（不落 404）

### FR-11: 桌面零回归
Given 桌面 UA 或未传 variant 的既有调用点
Then SessionPanel/PreSessionPicker 行为与改动前完全一致；`(dashboard)/**` 全部既有测试保持绿色；m/ 既有页面（login/account/workspaces/ppm）路径不被 DRILL_ROUTES 命中

## 非功能需求

- 兼容性：Windows/Linux/macOS 开发环境一致（纯前端，无平台分支）；双主题（AI 紫/blue/暗夜）token 化取色，无写死色值；antd ConfigProvider 既有注入不动。
- 移动规范：触摸热区 ≥44px、正文 ≥14px、h-[100dvh] + max-w-[480px]、键盘弹出输入条可见（真机验证）。
- 可回退：移动页面群为纯新增文件，revert 不影响桌面；桌面 UA 访问同 URL 恒得桌面页。
- 可测试：vitest 就近 colocate；纯函数（正则/映射/分组）单测；组件交互测试；仅跑本变更相关测试（全量留给 CI）。
- 性能：会话列表一次拉取 limit=500 客户端分组（对齐桌面 D-103）；轮询语义复用桌面智能轮询（react-query 失焦停轮既有行为）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@V1 | FR-01/03/04/06/07/11 | 独立移动渲染层 + 数据层复用 + 桌面零回归 |
| D-002@V1 | FR-03/04/05 | 变更中心核心版（任务不做，详情含审批+预览） |
| D-003@V1 | FR-06/07/08 | 会话完整内核复用（variant 仅样式） |
| D-004@V1 | FR-01/02/09 | 主页+双Tab 真实路由 + 钻取隐藏底部 Tab |
