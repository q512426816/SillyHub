---
author: qinyi
created_at: 2026-08-20T15:35:00
---

# 需求规格（Requirements）— 工作区详情页工作台式重构

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 打开工作区详情页，四段式快速获取状态与入口 |
| 开发者 | 后续页面仿照四段式组件化版式（hero/stats/grid 可复用） |

## 功能需求

### FR-01: 头部横幅
覆盖决策：D-201, D-202
Given 工作区详情页已加载
Then 顶部渲染渐变横幅（from-brand-700 via-brand-800 to-slate-950，blue 主题自动回旧蓝渐变），含工作区名（大字白）、状态徽标、slug 等宽小字、操作组（编辑信息入口触发既有 editingInfo 态 + 返回列表链接）
And 横幅不放重新扫描等新增 API 操作（design §2 零改动承诺）

### FR-02: 统计卡行
覆盖决策：D-201, D-202
Given 工作区详情页已加载
Then 统计四卡（项目组组件/进行中变更/已归档变更/运行时阶段）以图标+数值+标签形态渲染，图标软底 bg-brand-50 text-brand-600
And 可点击性与现状一致（组件/进行中变更/运行时为 Link 跳对应页，已归档为 div 不可点），悬浮强化三件套

### FR-03: 快速入口宫格
覆盖决策：D-201, D-202
Given 工作区详情页已加载
Then 6 个入口（项目组件/变更中心/扫描文档/运行时/智能体档案/方案文件）以图标卡片宫格渲染（grid 3 列），lucide 图标+中文标签，href 与现状一致
And 悬浮三件套（border-brand-300 + shadow-lg + -translate-y-1）

### FR-04: 分组信息区
覆盖决策：D-201, D-203
Given 工作区详情页已加载
Then antd Collapse ghost 两组：「基本信息」默认展开（路径字段/类型/角色/用途/时间戳/编辑态/绑定守护进程区 WorkspaceDaemonSwitcher 面板底部）；「配置」四面板默认折叠（默认智能体提供方/关联 PPM 项目/规范工作区配置/守护进程共享）
And 守护进程共享面板仅 myBinding 存在时挂载（条件渲染保持）
And 既有子组件（WorkspaceConfigCard/LinkedProjectsSection/SharedDaemonToggle）内部零改动仅换容器

### FR-05: 行为等价与测试
覆盖决策：D-202
Given 重构完成
Then 所有数据 hook/编辑保存/绑定交互行为与重构前等价（九块映射表 10 行对账）
And page.test 既有断言经 forceRender 策略全绿（懒渲染面板 items forceRender=true，与现状加载即挂载的数据时序等价——plan 阶段定案）
And 新增断言：统计四数字渲染、6 入口 href 正确

## 非功能需求

- 兼容性：不新增 API 调用；单 commit 可 revert 回退
- 可测试：3 新组件纯展示（props 进/JSX 出），编排层行为由 page.test 锁定
- 主题化：全部类名走 brand 阶/主题 token，双主题切换跟随（FRONTEND_PAGE_STYLE §0.5）

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-201 | FR-01~04 | 四段式信息架构 |
| D-202 | FR-01~03, FR-05 | 展示组件拆分（page.tsx 450-480 行编排层） |
| D-203 | FR-04 | ghost Collapse 折叠收纳 |
