---
author: qinyi
created_at: 2026-08-20T14:40:00
scale: large
source_change: 2026-08-20-workspace-overview-redesign
risk_level: unit-sufficient
---

# 设计文档（Design）— 工作区详情页工作台式重构

> 视觉基线（多来源合成）：登录页 hero 渐变（page.tsx:254）+ 评审原型 `.sillyspec/changes/2026-08-20-frontend-ai-native-style/prototype-frontend-ai-native-style.html` 第 02 节统计卡版式 + ppm workbench 宫格先例 + antd Collapse；主题约束见 `FRONTEND_PAGE_STYLE.md` §0.5。
> 改造对象：`frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`（543 行，九大块纵向堆叠）。

## 1. 背景

工作区详情页是平台使用频率最高的页面之一，现状问题：

- **信息无层次**：基本信息表 / 提供方配置 / 统计卡（埋在页面中部）/ 关联项目 / 规范配置 / 守护共享 / 快速入口——九块平铺，重要度不分区。
- **快速入口形态差**：`flex flex-wrap gap-2` 文本链接按钮堆（page.tsx:521-540，共 **6 项**：项目组件/变更中心/扫描文档/运行时/智能体档案/方案文件），与 AI-Native 的图标卡片宫格差距大。
- **头部单薄**：PageHeader 一行标题+slug，无横幅无关键操作。
- **配置噪音**：默认提供方/规范配置/守护共享等低频配置与高频信息同级展示，页面被拉长。

用户已确认方向：**A 工作台式（信息架构重排）** + **B 组件拆分实现**。

## 2. 设计目标

1. 信息架构重排为四段式：头部横幅 → 统计卡行 → 快速入口宫格 → 分组信息区（基本信息展开 + 配置折叠）。
2. 展示子组件化（方案 B）：page.tsx 降为编排层（预计 450-480 行——基本信息编辑表单/提供方/守护共享等有状态 JSX 留编排层，拆走需迁 handler 得不偿失）。
3. 全部走主题系统：brand 阶、主题化阴影 token、双主题切换跟随。
4. 业务逻辑零改动：所有数据 hook/API 调用/编辑保存行为原样保留，仅重排展示层；**不新增任何 API 调用**（故 hero 不放"重新扫描"——该操作现状仅在列表页卡片，详情页引入即破坏零改动承诺）。

## 3. 非目标

- ❌ 不动 20 个子模块页面（components/changes/runtime/... 各自页面风格另议）
- ❌ 不改任何业务逻辑 / API / 数据流 / hook 依赖；不新增 API 调用（统计数字全部来自 load() 既有查询）
- ❌ 不做响应式移动端专项（m/* 无此页）
- ❌ 不新增后端接口/字段

## 4. 拆分判断

单一变更不拆分：单页面重构，组件拆分内部高内聚，Wave 按组件顺序推进。

## 5. 总体方案

### 九块 → 四段映射表（R-01 逐块核对用）

| 现状块（page.tsx） | 去向 |
|---|---|
| PageHeader 标题区（:244-259） | 段① WorkspaceHeroHeader |
| pageError 条（:261-265） | 保留原位（横幅下方，不动） |
| 基本信息 SectionCard + 编辑态（:268-…） | 段④ Collapse「基本信息」面板（默认展开） |
| 绑定守护进程区 WorkspaceDaemonSwitcher（:398-404） | 段④「基本信息」面板底部（随面板，位置不变仅换容器） |
| 默认智能体提供方 SectionCard（:408-467） | 段④ Collapse「默认智能体提供方」面板（默认折叠） |
| Overview 统计四卡（:470-487） | 段② WorkspaceStatsRow |
| LinkedProjectsSection（:491） | 段④ Collapse「关联 PPM 项目」面板（默认折叠，组件原样） |
| WorkspaceConfigCard（:494-502） | 段④ Collapse「规范工作区配置」面板（默认折叠，组件原样） |
| 守护进程共享 SectionCard（:507-518，仅 myBinding 存在时渲染） | 段④ Collapse「守护进程共享」面板（**条件渲染保持**：myBinding 存在才挂该面板） |
| 快速入口 6 项按钮堆（:521-540） | 段③ QuickEntryGrid（宫格化，入口集维持 6 项现状） |

### 四段式布局（自上而下）

| 段 | 内容 | 组件 |
|---|---|---|
| ① 头部横幅 | 深底渐变（from-brand-700 via-brand-800 to-slate-950，同登录页 hero）+ 工作区名（大字白）+ 状态徽标 + slug（等宽小字白/半透明）+ 右侧操作组（**编辑信息**入口/返回列表链接） | `WorkspaceHeroHeader` |
| ② 统计卡行 | 四卡：项目组组件数/进行中变更/已归档变更/运行时阶段——lucide 图标（软底 brand-50 圆角块）+ 数值大字 + 标签；**可点击性与现状一致**（组件/进行中变更/运行时为 Link，归档为 div 不可点——行为不变仅升视觉）；悬浮抬升+主题化阴影 | `WorkspaceStatsRow` |
| ③ 快速入口宫格 | 6 入口图标卡片（现状 6 项：项目组件/变更中心/扫描文档/运行时/智能体档案/方案文件）——lucide 图标+中文标签，grid 3 列两行（lg:grid-cols-3），悬浮强化三件套（hover:border-brand-300 + shadow-lg + -translate-y-1，workspace-card 同款） | `QuickEntryGrid` |
| ④ 分组信息区 | antd Collapse `ghost` 风格（无外框背景，避免与子组件自带 SectionCard 形成卡中卡）两组：「基本信息」defaultActiveKey 展开（含路径字段/类型/角色/用途/时间戳/编辑态/绑定守护进程区）；「配置」组四面板默认折叠（默认智能体提供方/关联 PPM 项目/规范工作区配置/守护进程共享——后三者为既有组件原样塞入） | page.tsx 编排 + 既有子组件 |

### 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/components/workspace/hero-header.tsx` | 头部横幅（纯展示） |
| 新增 | `frontend/src/components/workspace/stats-row.tsx` | 四统计卡 |
| 新增 | `frontend/src/components/workspace/quick-entry-grid.tsx` | 六入口宫格（与 `ppm/workbench/_components/quick-entry-grid.tsx` 同名不同目录，无冲突） |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | 重排为编排层（450-480 行）：hook/编辑/绑定逻辑全保留，JSX 换四段式+Collapse |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx` | 既有断言同步（见 R-02）+ **新增断言**：统计数字渲染、6 入口链接 href |

> 数据获取/编辑保存/绑定逻辑全部留在 page.tsx 不动；WorkspaceConfigCard/LinkedProjectsSection/SharedDaemonToggle/WorkspacePathFields/WorkspaceDaemonSwitcher 不改内部，只换挂载容器。

## 6. 接口定义

```tsx
// hero-header.tsx（纯展示，无数据 hook）
export function WorkspaceHeroHeader(props: {
  workspace: Workspace;
  onEditInfo: () => void;   // 触发 page.tsx 既有 editingInfo 态
}): JSX.Element;

// stats-row.tsx
export function WorkspaceStatsRow(props: {
  workspaceId: string;
  componentCount: number;
  activeChanges: number;
  archivedChanges: number;
  currentStage: string | null;
}): JSX.Element;

// quick-entry-grid.tsx
export function QuickEntryGrid(props: { workspaceId: string }): JSX.Element;
```

样式约定（全部主题化）：横幅渐变 `from-brand-700 via-brand-800 to-slate-950`（blue 主题自动回旧蓝渐变）；统计卡图标软底 `bg-brand-50 text-brand-600`；宫格卡悬浮强化三件套（workspace-card 同款）；Collapse 用 antd ghost（`ghost` + `bordered={false}`）。

## 7. 数据模型

不涉及（纯展示层重排，零后端变更）。

## 8. 兼容策略（brownfield）

- 所有数据 hook、编辑/保存/绑定交互、错误处理逻辑原样保留（只挪容器）；重构后行为等价。
- antd Collapse 折叠面板**懒渲染**（默认折叠面板内容不挂载 DOM）：既有断言（WorkspaceConfigCard mock 接线 + default_agent×3 + 三策略等）位于「配置」组内。
  - **plan 阶段定案（修订注，supersedes 前述口径）**：items **全量 `forceRender: true`（生产同传）**——放弃懒加载收益，换取与现状"挂载即挂载、挂载即请求"的 API 时序严格等价（懒渲染会推迟 LinkedProjectsSection/WorkspaceConfigCard 的数据请求，才是行为改变）；前述"生产不传保持懒加载"备选作废（items 在 page.tsx 构造，测试侧无法单独传参，实现上不可行）。
- 回退路径：单 commit revert 即回旧版式；新组件为独立文件不影响其它页面。

## 9. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | 重排漏搬某块功能 | P1 | §5 映射表 10 行逐块核对（含 WorkspaceDaemonSwitcher/条件渲染守护共享）；page.test 用例覆盖 |
| R-02 | 既有测试断言失效 + 覆盖缺口 | P1 | 同步改写断言；**新增**统计数字与 6 入口 href 断言（现状测试无此覆盖）；Collapse 懒渲染经 forceRender 保既有 6 断言（§8）；全量 pnpm test 验证 |
| R-03 | Collapse 内子组件行为受影响（弹层/表单/共享开关） | P2 | 子组件不改内部仅换容器；ghost 风格避免卡中卡；折叠展开交互 Docker 实测 |
| R-04 | 双主题观感（横幅渐变 blue 侧平移） | P2 | 渐变全走 brand 阶类自动回旧蓝；Docker 两主题截图核对 |

## 10. 决策追踪

见 decisions.md：D-201 工作台四段式（用户选 A）、D-202 展示组件拆分（用户选 B）、D-203 配置折叠收纳（ghost Collapse 两组：基本信息展开/配置折叠）。无未解决决策。

## 11. 自审（Self-Review）

| 检查项 | 结果 |
|---|---|
| 需求覆盖（四段式/组件拆分/主题化/逻辑零改动含不新增 API） | ✅ §2/§5 |
| 非目标明确 | ✅ §3 |
| 章节齐全 | ✅ |
| 文件清单真实性 | ✅ page.tsx 543 行与九块行号本会话已读；映射表 10 行逐块对账 |
| 生命周期关键词 | ✅ 纯展示层，不涉及生命周期契约 |
| YAGNI | ✅ 不动子页面/不加接口/入口维持 6 项不加戏 |
| 验收可测 | ✅ R-01 映射核对 + R-02 断言清单 + 全量测试 + Docker 截图 |
| ⚠️ 自审存疑 | 无 |
