---
author: qinyi
created_at: 2026-09-27 00:27:36
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-26-core-pages-visual-redesign

## 背景

变更中心、工作区、会话是 SillyHub 使用频率最高的三类页面，用户反馈「现在的太丑了」。现状调研（2026-09-26）确认八个结构性问题：

1. 字号系统性偏小（大量 text-xs/text-[11px]/text-[10px]），变更中心表格单格塞两行+两徽标，7 列全小字，扫读性差（frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx，881 行）。
2. 双组件体系并存：同页混用 shadcn Button（size=sm）与 antd Input/Select（D-304 豁免条款遗留），三套按钮高度同屏。
3. 卡片语言不统一：SectionCard/自写 emoji 卡头/工作区卡/stats-row 假卡片，圆角阴影卡头至少 4 种。
4. 层级信号弱：变更列表页垂直堆 7 层（header/banner/stats/warnings/sync-section/tabs/查询卡/表格），各层视觉权重接近。
5. 空值占位符污染：`—` 灰字密度高时表格破碎。
6. 硬编码颜色残留：top-bar 面包屑 slate、概览页 amber 横幅、变更详情 green 成功条（违反主题铁律，dark 主题靠补丁）。
7. 巨型单文件：session-list-panel.tsx（3665 行）、session-panel-page.tsx（4615 行）、changes/page.tsx（881 行含 10+ 本地 state）。
8. 收尾粗糙：工作区手写「上一页/下一页」分页、window.confirm 删除（违反自家 FRONTEND_PAGE_STYLE §8）。

用户已通过四风格高保真原型对比选定 **GitHub/Primer 设计语言**，并通过方案对比选定**全量组件库 + 五页一次性迁移**的实施策略（D-001/D-002/D-003@v1）。

## 设计目标

- 五个页面（变更中心列表 / 变更详情 / 工作区列表 / 工作区概览 / 会话门户）统一为 GitHub/Primer 视觉与交互语言。
- 建立可复用的 primer 共享组件库，根治「五种圆角各自为政」，并为后续页面提供统一原语。
- 状态语义标准化：进行中/已归档/轻量/等待输入/失败 → 统一状态图标 + 胶囊体系。
- 全部颜色走三主题 token（blue/ai-native/dark），不新增任何硬编码 hex，dark 主题观感天然贴近 GitHub 深色。
- 顺手修复三类既有违规：window.confirm 删除、原生 select/input 表单控件、硬编码 slate/amber/green。
- 正文可读性下限 12px（数据密集 mono 元数据允许 11px 下限）。

## 非目标

- 不改后端 API / DTO / 数据库 schema。
- 不改路由结构（URL 完全不变）。
- 不动 WorkspaceTabs 17-tab 导航壳与 AppShell/TopBar 布局壳（D-003 范围外；top-bar 硬编码 slate 仅做 token 替换级修复）。
- 不重构会话门户状态机 / 数据流 / 轮询 / WS 消息处理逻辑。
- 不做移动端适配（桌面产品）。

## 拆分判断

单一变更而非拆分：五页面共享同一套 primer 组件库与主题 token 扩展，拆开会导致组件库归属模糊与规范漂移（现状 D-304 双体系即历史上分批改页的产物）。用户已选定方案二（一次性迁移），接受中途不可见进度的代价。

## 总体方案

### 设计语言三层落地（D-001）

**第一层·布局与组件语言（直接复刻 Primer 结构）**：Issues 行式列表（状态图标+两段式行）、PR 详情时间线、Counter 计数胶囊、UnderlineNav 下划线 tab、About 侧栏、工具条分组、面包屑页头。

**第二层·状态语义层**：进行中=紫开圆、已归档=紫合并勾、轻量=琥珀闪电、等待输入=琥珀时钟、失败=红叉、完成=绿勾——映射到 themes.ts semantic 五档（success/warning/error/info/neutral）+ brand 阶。

**第三层·主题策略**：颜色全部走现有三主题 token。原型的具体色值仅为 ai-native 主题参考。StateLabel 浅底深字需要 semantic 每档的「浅底/深字」两阶值——themes.ts 的 semantic 五档现仅单值，扩展为 `semantic.soft`（浅底）+ 语义单值（文字/边框）两级结构（兼容读取：旧单值字段保留）。

### 实施分 Wave（方案二，D-002）

- **Wave 1 基础设施**：themes.ts semantic 浅阶扩展 + primer 组件库全量（组件清单见文件变更清单）+ 每组件 vitest 单测。
- **Wave 2 变更双页**：变更中心列表（7 层→4 层重排，antd Table 退役换 IssueRow 列表，保留智能轮询/深链/批量操作；**条件区收敛**——PlatformSyncSection 同步裁决区与解析警告卡收敛为页头下方单条 GitHub 式 flash 告警条（有冲突/警告才出现，可展开操作），reparse 统计并入工具条说明文字）+ 变更详情（PR checks 横条 + 时间线主线 + MetaPanel 右栏，10+ 异构卡收敛为 2 区）。
- **Wave 3 工作区双页**：列表（卡片网格→Repositories 行式列表，**workspace-drag-grid.tsx 同步改造为纵向行容器**（拖拽排序保留），分页规范化，window.confirm→Modal）+ 概览（深色 Hero→Repo 首页式白底页头+守护横幅+统计四格+两栏，原生表单控件换 antd）。
- **Wave 4 会话门户**：三栏结构保留，左栏列表条目/中栏消息块/右栏信息面板按 Primer 视觉重做；**中栏四分支全覆盖**（群聊面板/真会话/预会话/空门户——空门户用 primer empty-state，预会话 picker 同风格化）；只动 render 与样式类，props/状态/数据流零改动。
- **Wave 5 规范回写**：FRONTEND_PAGE_STYLE.md 增补 primer 组件用法、**改写 D-304 双体系豁免条款**（页面内按钮统一 primer preset，§4/§5 豁免范围收窄为纯 antd 控件场景）；全局 grep 核对无新增硬编码色。

### 五页面重排对照（execute 按原型逐视图实现）

对照原型 `prototype-github-redesign.html`（2270 行五视图，本变更目录下）：

| 页面 | 现状 | 目标（原型视图） |
|---|---|---|
| 变更中心列表 | 6 层堆叠+7 列小字表格 | 面包屑→页头（标题+计数+绿色主按钮）→工具条→UnderlineNav 状态 tab（Counter 实时计数）→IssueRow 列表 |
| 变更详情 | 步骤条+10+ 异构卡片流 | 六阶段 checks 横条+左主列时间线（事件流+Agent 日志内嵌）+右侧 296px MetaPanel 六组 |
| 工作区列表 | 卡片网格+手写分页+window.confirm | 行式列表（状态点+名称+路径 mono+技术栈+守护 label+Counter+时间）+规范分页+Modal 删除 |
| 工作区概览 | 深色渐变 Hero+原生表单+amber 硬编码 | 白底页头（方块头像+名称+可见性胶囊）+守护横幅+统计四格+左右两栏+About 侧栏 |
| 会话门户 | 三栏但视觉杂乱、chips 密集 | 三栏 Primer 化：左栏两行式条目+选中蓝条；中栏用户浅蓝块/agent 白底边框块+代码块+工具调用胶囊；右栏信息面板 |

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/styles/themes.ts | semantic 五档扩展 soft 浅底阶（三主题各配）；211 行 |
| 修改 | frontend/src/styles/themes.test.ts | soft 阶 3 新用例（键齐全/浅色 50 档/dark rgba 派生） |
| 修改 | frontend/src/app/globals.css | html[data-theme] 三主题块注入 --semantic-*-soft var |
| 新增 | NEW:frontend/src/components/primer/index.ts | primer 组件桶导出 |
| 新增 | NEW:frontend/src/components/primer/state-label.tsx | StateLabel 状态胶囊（open/merged/attention/done/error/neutral 六变体，浅底深字细边框；iconName 覆写区分 attention 双态：zap=轻量闪电 / clock=等待时钟） |
| 新增 | NEW:frontend/src/components/primer/counter.tsx | Counter 计数胶囊 |
| 新增 | NEW:frontend/src/components/primer/underline-nav.tsx | UnderlineNav 下划线 tab（指示条色走主题 token） |
| 新增 | NEW:frontend/src/components/primer/issue-row.tsx | IssueRow 两段式列表行（状态图标+主行+副行+右侧元数据+hover 操作） |
| 新增 | NEW:frontend/src/components/primer/timeline.tsx | Timeline 事件时间线（竖线+节点+可折叠日志） |
| 新增 | NEW:frontend/src/components/primer/meta-panel.tsx | MetaPanel 侧栏信息面板（dl 分组原语） |
| 新增 | NEW:frontend/src/components/primer/page-head.tsx | PageHead 页头（面包屑+标题+副标题+操作组） |
| 新增 | NEW:frontend/src/components/primer/stat-grid.tsx | StatGrid 统计格 |
| 新增 | NEW:frontend/src/components/primer/empty-state.tsx | 空态原语（替代 `—` 破碎观感的列表级空态） |
| 新增 | NEW:frontend/src/components/primer/state-icon.tsx | 状态 SVG 图标集（开圆/合并勾/闪电/时钟/叉/勾，16px stroke） |
| 新增 | NEW:frontend/src/components/primer/__tests__/primer-atoms.test.tsx | 原子组件单测（六变体矩阵+iconName 双态） |
| 新增 | NEW:frontend/src/components/primer/__tests__/primer-structures.test.tsx | 结构组件单测（含 Timeline/MetaPanel 追加用例） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx | 列表页重排（881 行重构） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | 详情页重排（551 行） |
| 修改 | frontend/src/components/changes/detail/change-stage-header.tsx | 详情页阶段头 Primer 化（Wave 2 内联展开 detail/ 其余涉及件，见 R-06 页面锚定策略） |
| 修改 | frontend/src/app/(dashboard)/workspaces/page.tsx | 工作区列表重排（597 行） |
| 修改 | frontend/src/components/workspace-card.tsx | 卡片退役改行式条目（或重构为 primer 复合） |
| 修改 | frontend/src/components/workspace-drag-grid.tsx | 拖拽网格容器改造为纵向行容器（排序能力保留） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/page.tsx | 概览页重排（750 行） |
| 修改 | frontend/src/components/sessions/sessions-portal.tsx | 门户展示层 Primer 化（1137 行，仅 render/样式） |
| 修改 | frontend/src/components/sessions/pre-session-picker.tsx | 预会话选择器同风格化（287 行，仅 render/样式） |
| 修改 | frontend/src/components/sessions/portal-file-panels.tsx | 右栏文件面板样式统一（131 行，仅 render/样式） |
| 修改 | frontend/src/components/sessions/session-list-panel.tsx | 左栏展示层（3665 行，仅 render/样式） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 中栏展示层（4615 行，仅 render/样式） |
| 修改 | frontend/src/components/top-bar.tsx | 面包屑 slate 硬编码换 token（token 替换级，不动结构） |
| 修改 | .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md | 回写 primer 组件规范+按钮体系收敛条款 |
| 修改 | 上述页面对应测试文件 | 类名/结构断言同步（frontend/src/**/__tests__/） |

## 接口定义

```tsx
// StateLabel — 状态胶囊（核心变体枚举对齐第二层状态语义）
interface StateLabelProps {
  variant: 'open' | 'merged' | 'attention' | 'done' | 'error' | 'neutral';
  children: React.ReactNode;          // 状态文案，如「进行中」「已归档」
  withIcon?: boolean;                 // 默认 true，带 12px 状态图标
  iconName?: 'zap' | 'clock';         // 覆写插槽——仅 variant=attention 时有意义（zap=轻量出身 / clock=等待输入），默认 zap
  size?: 'sm' | 'md';                 // sm=列表行内，md=页头
}
// 颜色来源：themes.ts semantic.soft（浅底）+ semantic 主值（文字/边框），无硬编码。

// Counter — 计数胶囊
interface CounterProps { count: number; active?: boolean; }

// UnderlineNav — 下划线 tab
interface UnderlineNavProps<T extends string> {
  items: Array<{ key: T; label: React.ReactNode; counter?: number }>;
  value: T; onChange: (key: T) => void;   // 受控（过滤即时切换，计数实时刷新）
}

// IssueRow — 两段式列表行
interface IssueRowProps {
  state: StateLabelProps['variant'];     // 决定左侧状态图标
  title: React.ReactNode;                // 主行标题（含 key mono 链接）
  meta?: React.ReactNode;                // 副行元数据（阶段胶囊/组件 tag/消耗）
  right?: React.ReactNode;               // 右侧元数据列（负责人/时间）
  onClick?: () => void; hoverActions?: React.ReactNode;
  leading?: React.ReactNode;             // 行首插槽（批量模式由列表容器渲染 checkbox 传入，非批量省略）
}

// Timeline — 事件时间线
interface TimelineItemProps {
  icon: React.ReactNode; title: React.ReactNode; time?: string;
  children?: React.ReactNode;            // 内嵌日志/输出块（可折叠）
  tone?: 'default' | 'current' | 'success';
}

// MetaPanel — 侧栏信息面板
interface MetaPanelSectionProps { title: string; children: React.ReactNode; }

// PageHead — 页头
interface PageHeadProps {
  breadcrumb?: React.ReactNode; title: React.ReactNode;
  subtitle?: React.ReactNode; actions?: React.ReactNode;
}

// StatGrid — 统计格
interface StatGridProps { items: Array<{ label: string; value: React.ReactNode; tone?: 'default' | 'brand' | 'warning' }>; }
```

组件实现约定：Tailwind 类 + `data-theme` CSS 变量（复用现有 globals.css token 注入模式），不引第三方组件库；antd 仅保留 Input/Select/Modal/Tooltip 等控件类（ConfigProvider token 统一），Button 全站页面内收敛为 primer 按钮（`primer/button.tsx` 若 Wave 1 评审需要，从 shadcn Button 包一层场景化 preset）。

## 生命周期契约表

本变更不涉及生命周期契约（lifecycle contract）变更：会话门户仅重做展示层 render 与样式类，session 状态机、WS 消息处理、轮询、lease 语义零改动；不新增/修改任何事件、claim、heartbeat 交互。

## 数据模型

无 schema 变更。前端消费的 API 类型继续从 backend OpenAPI 生成（frontend/src/lib/api-types.ts），本变更不触发 `pnpm gen:types`。

## 兼容策略（brownfield 必填）

- **三主题兼容**：所有新色值经 themes.ts；verify 阶段三主题（blue/ai-native/dark）逐页截图走查。StateLabel 浅底阶三主题各配（dark 用半透明底 `rgba(语义色, .15)` 模式）。
- **antd 共存**：Input/Select/Modal/Tooltip 等控件继续 antd（ConfigProvider token 化不变）；列表/时间线/胶囊等结构组件为 primer 自建。不全局替换 antd，避免回归面失控。
- **行为保留**：变更列表智能轮询（30s 全终态停轮）、深链（?session=、?new=1）、批量操作、拖拽排序、导出等交互行为全部保留；仅表现层重写。
- **测试兼容**：现有页面测试多为行为断言（fireEvent/断言文本），类名断言处同步更新；不删测试只改断言。
- **回退路径**：五个页面改动均在一个变更内原子交付；若 verify 失败可整变更回退（git revert），无数据迁移。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 会话门户 8400+ 行展示层重做，回归面大 | P1 | 红线：只动 render 与样式类，props/状态机/数据流/轮询零改动；Wave 4 单独成波，先左栏→中栏→右栏分任务推进，每任务跑相关测试 |
| R-02 | antd Table 退役换自建 IssueRow，排序/滚动/列对齐行为回归 | P1 | 排序逻辑沿用现有 handler；IssueRow 网格列对齐（表头行+行同 grid template）；保留既有测试断言的交互行为 |
| R-03 | 现有测试大量断言旧类名/DOM 结构，批量迁移失败噪音 | P2 | 每页迁移时同步修对应测试；只改断言不改测试意图（规则 9） |
| R-04 | dark/blue 主题下 GitHub 风格观感不达预期（原参照为亮色） | P2 | semantic soft 阶三主题分别调值；verify 三主题截图走查为硬门 |
| R-05 | 巨型文件内嵌大量样式类，替换遗漏导致新旧混杂 | P2 | 每文件迁移后 grep 遗留旧类（bg-green-50/text-slate-800 等）清零核对 |
| R-06 | detail/ 目录 14 个子组件按需 Primer 化范围蔓延 | P3 | 文件清单以页面为锚，Wave 2 内联展开实际涉及件；不涉及件零改动 |
| R-07 | FRONTEND_PAGE_STYLE.md 为 PPM 基准页规范（PPM 已上线），D-304 豁免条款改写含糊会使 PPM 页维护失去依据 | P2 | Wave 5 回写时显式声明：D-304 中 PPM 类页面全量条款适用范围不变，仅收窄工作台页面的按钮/列表豁免口径；verify 时抽查 PPM 基准页（/ppm/projects）零回归 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 设计目标 + 总体方案·设计语言三层落地 + 五页面重排对照表 | 已覆盖 |
| D-002@v1 | 拆分判断 + 总体方案·实施分 Wave（Wave 1 组件库先行，五页一次迁移） | 已覆盖 |
| D-003@v1 | 非目标（四项不做）+ 设计目标（深度含交互）+ 文件变更清单（五页面范围） | 已覆盖 |

无未解决决策；D-001/002/003 均为用户亲选（evidence 见 decisions.md）。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@vN（D-001/D-002/D-003@v1，决策追踪表全覆盖）
- [x] 生命周期契约：纯展示层变更，紧邻豁免短语已写（「不涉及生命周期契约」）
- [x] UI 原型分级核对：prototype-github-redesign.html（2270 行五视图）已在本变更目录
- [x] 无「⚠️ 自审存疑」项；R-06 范围蔓延风险已用页面锚定策略缓解

### Design Grill 结论（Step 7，2026-09-27）

交叉审查发现 5 处覆盖缺口，全部 immediately_answered 并已修入上文，**无 needs_thinking / unresolved blocker**：

| # | 发现 | 处置 |
|---|---|---|
| G-1 | 工作区改行式列表后 workspace-drag-grid.tsx 去向未交代 | Wave 3 点名改造为纵向行容器 + 文件清单补行 |
| G-2 | 现状 7 层中 PlatformSyncSection/reparse 统计/解析警告三块功能去向未写 | Wave 2 补「条件区收敛为 flash 告警条 + 统计并入工具条」 |
| G-3 | 会话中栏四分支（群聊/预会话/空态）未点名 | Wave 4 补全覆盖（empty-state 承接空门户） |
| G-4 | IssueRow 缺批量多选定义 | 接口定义补 leading 插槽（容器渲染 checkbox） |
| G-5 | 规范回写未提 D-304 双体系条款改写 | Wave 5 补改写 D-304 豁免范围 |
