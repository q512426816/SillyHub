---
author: qinyi
created_at: 2026-08-23
scale: large
tier: independent
module: frontend
risk_level: unit-sufficient
---

# 设计文档（Design）— 前端暗色主题与三主题切换

## 1. 背景

现有前端为 blue（明亮蓝）/ ai-native（AI 紫，默认）两套**浅色**主题（2026-08-20-frontend-ai-native-style 立），经 `themes.ts` 单一源 + `html data-theme` CSS 变量 + antd ConfigProvider token 双驱动换肤。用户夜间使用时浅色底刺眼，需要暗色主题与便捷切换，保证夜间阅读舒适。

本变更是既有主题系统的**自然扩展**（多主题架构本已预留第三套取值位），不引入第二套换肤机制。

## 2. 设计目标

1. 新增 `dark` 主题（AI 紫暗色版）：页面底 slate-900、卡片 slate-800、边框 slate-700，全站（含 antd 组件、表格、气泡、图表文字）协调变暗。
2. 顶栏切换控件升级为**三选一下拉**（AI 紫 / 明亮蓝 / 暗夜），沿用 localStorage `sillyhub-theme` 记忆，刷新不闪烁。
3. 首次访问（无持久化记录）时**跟随系统** `prefers-color-scheme`：系统暗色 → 直接进暗夜主题；用户手动选过后以用户选择为准。
4. 浅色两主题观感**零变化**（slate 变量化取值与现状逐值相等、bg-card 在浅色下仍为纯白）。

## 3. 非目标

- 不做系统明暗**实时监听**（运行中切换系统主题需刷新页面才跟随）。
- 不做 blue 主题的暗色版（暗色仅 AI 紫一族；明暗×品牌四象限矩阵明确不做，用户已拍板三主题并列）。
- 不改后端 / daemon / 数据库 / 接口。
- 不重设计页面布局，只做配色维度扩展。

## 4. 拆分判断

单一功能模块（主题系统扩展 + 全站浅色清理），功能内聚不拆分；非批量模式（清理是机械替换但共享同一验证口径，不构成「模板×数据」）。规模 large：跨 styles/globals.css/tailwind.config/store/layout/antd-providers/theme-toggle + 18 个组件文件清理 + 图表适配 + 测试，走完整四件套。

## 5. 总体方案

### 5.1 暗色取值策略：色阶对称翻转（核心设计）

延续「色阶严格采用 Tailwind v3 默认值，禁止自行调色」铁律。dark 主题的 slate / brand 色阶取**对称翻转**：

- slate：50↔900、100↔800、200↔700、300↔600、400↔500
- brand（violet）：50↔950、100↔900、200↔800、300↔700、400↔600、500 自映

效果：全站现存 `bg-slate-100`（悬浮底）/ `text-slate-500`（次要文字）/ `border-slate-200`（边框）/ `text-brand-600`（品牌强调）等约 100+ 处类名**不改一字**，切到暗色自动得到语义正确的对应值（浅底变深底、深字变浅字、亮紫强调）。这也是 slate 阶必须变量化的原因——tailwind 里 slate 当前是写死 hex，翻转必须发生在 CSS 变量层。

dark 关键取值（全部 Tailwind v3 默认值）：

| 键 | 取值 | 来源 |
|---|---|---|
| primary / primaryHover | #8b5cf6 / #a78bfa | violet-500 / violet-400（暗色下主色与 hover 均提亮，保证深底对比度） |
| accent / semantic.info | #22d3ee | cyan-400（较浅色主题 cyan-600 提亮两档；语义色较 600 系提亮一档） |
| bg / card / border | #0f172a / #1e293b / #334155 | slate-900 / 800 / 700 |
| semantic.success/warning/error | #10b981 / #f59e0b / #ef4444 | emerald-500 / amber-500 / red-500（较浅色主题的 600 系提亮一档） |
| semantic.neutral | #94a3b8 | slate-400 |
| shadow 系 | 黑基调加深 + primary 投影 rgba(139,92,246,0.28) | 暗色下阴影需更深才有层次 |

### 5.2 换肤链路改造（复用现有双驱动）

```
themes.ts（+dark 取值） ──┬→ useThemeStore（persist localStorage）──→ antd-providers：token 查表 + dark 时 algorithm=darkAlgorithm
                          │                                              └→ useEffect 同步 html data-theme
                          └→ globals.css [data-theme="dark"] 第三套变量块 ←─ layout 防闪烁 inline script（首帧直读 localStorage，
                                                                        无记录时 matchMedia 跟随系统）
```

- **tailwind.config.ts**：slate 阶从写死 hex 改为 `var(--color-slate-*)` 函数映射，照抄 brand 阶现成模式（函数分支处理 `/` 透明度修饰符 → color-mix）。globals.css 的 `:root` **已有** `--color-slate-50..900` 声明（Grill C-06 核实，值即 Tailwind 默认 hex），无需补写，仅消费侧切换映射。
- **globals.css**：新增 `[data-theme="dark"]` 覆盖块（HSL 语义变量 + `--color-*` 全套 + 阴影）；修正既有硬编码四点：① DataTable 斑马纹 `color-mix(..., #ffffff)` → 混 `var(--color-card)`（浅色两主题 --color-card 均为纯白，等值零回归）；② route-loading spinner 边框 `rgba(0,0,0,0.08)` → 改走新变量 `--color-loading-track`（浅色两主题=rgba(0,0,0,0.08) 原值保证零变化，dark=rgba(255,255,255,0.12)）；③ `--muted-fg` 无定义纯靠 #8c8c8c 兜底 → 三套变量块各定义真值；④ 顺手清理 globals.css:176-196 未启用的遗留 `.dark` 类块（蓝灰调、与本次取值无关，避免误导后续开发，Grill C-21）。
- **layout.tsx 防闪烁脚本**：合法值白名单 `blue` / `dark`（其余含 ai-native）；无记录时 `matchMedia('(prefers-color-scheme: dark)').matches → 'dark'`，否则默认 `ai-native`。与 store 兜底口径一致。
- **stores/theme.ts**：merge 扩展——`persisted.theme === undefined`（从未选择过）时同读 matchMedia 决定初始主题，防止 React hydrate 后 useEffect 把脚本判出的 dark 覆盖回默认。SSR 安全：merge 仅在客户端 persist hydration 时执行。
- **antd-providers.tsx**：`algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm`；组件 token（表头 brand-50、行悬浮 brand-50、Menu 选中 brand-50 等）继续查 `themes[theme].color` 表，暗色翻转阶自动给出深紫底/亮紫字，无需逐 token 分支。
- **globals.css dark 固定调色板覆盖层（D-007@v1，Wave 2 实证补充）**：全站存在大量固定调色板状态色类（bg-red-50 错误条模板 128 处起，最终扩展到 18 色族含 zinc/violet/indigo/sky/teal/rose/purple/pink/fuchsia/lime），tailwind 直 hex 不随主题走，dark 下为大片刺眼浅色块/不可读深灰字。在 `[data-theme="dark"]` 块内追加**工具类覆盖**（仅 dark 生效，浅色零影响）：`[data-theme="dark"] .bg-red-50 { background-color: #450a0a }` 式——bg 50→950/100→900/200→800、border 100/200→900/300→800/400 与 500→300、text 500→400/600 与 700→300/800→200/900→100、斜杠透明度经 color-mix 保原透明度、hover:/placeholder: 前缀形态单独转义覆盖（全部 Tailwind v3 默认值）。终态 176 条规则，覆盖集 = 全树 grep 实际使用清单（Python 双向 diff 零遗漏），豁免项（实心 500/600 实色、装饰光斑、300/400 浅亮档）在覆盖层末尾注释留档。
- **theme-toggle.tsx**：Palette 图标点击改为 antd Dropdown 三选一菜单（AI 紫/明亮蓝/暗夜，色板小方块 + 当前项高亮勾选）。

### 5.3 全站浅色清理（bg-white → bg-card）

65 处 `bg-white` 分布 **23 个文件**（Grill C-04 对账修正，原稿误记 18）。大头：agent-log 系列 12+6、runtimes 页 6、team-progress 4、daemon 卡片 4、login 页 4；其余为 1-2 处的：hero-header、workspace-switcher、confirm-captcha、daemon/machine-card、change-file-tree、ask-user-dialog-card、agent-log/tool-renderers、top-bar、mission-summary-card、error-boundary、agent-run-panel、m/ppm/workbench/page、app/error.tsx、(dashboard)/workspaces/[id]/page.tsx、approvals/page.tsx、runtimes/[id]/audit/page.tsx、(dashboard)/ppm/workbench/page.tsx。逐处判断：

- 卡片/面板/气泡/输入底等**表面场景** → `bg-card`（浅色两主题 `--card`=#FFFFFF 观感零变化；暗色自动 #1e293b）。
- 品牌色块/渐变头图上的白底白字（`border-white`、hero 区）→ 保留原样。
- `text-white`（29 处）多数在 brand-600 底上：暗色翻转后 brand-600=#a78bfa 亮紫，白字依旧可读，逐处核对保留。

### 5.4 图表适配（ECharts）

图表文字色（legend/axisLabel/label）实际生成于 `lib/ppm/aggregations.ts` 的 toBarSeries/toPieSeries（Grill C-05 核实：CHART_COLORS 为编译期静态、取 themes[DEFAULT_THEME]，组件只透传 option），三个图表组件（WorkHourPieChart / WorkHourBarChart / RuntimeUsageLineChart）当前零主题感知，ECharts 默认文字深灰在暗色底上不可读。改造：aggregations.ts 的颜色入参化（series 构建函数接收主题取值，CHART_COLORS 静态表改为按当前主题取值的工厂或参数），组件订阅 `useThemeStore` 把 `themes[theme].color` 的文字色（slate-600）/分割线色（border）传入 option，主题切换即时重渲染（订阅驱动 re-render）。ECharts 读不到 CSS 变量，必须走 themes 表这条既有通道。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/styles/themes.ts | `ThemeName` 扩 `'dark'`；新增 `darkTheme: ThemeDef`（§5.1 取值）；`themes` 注册表加 dark。取值数据流：producer=themes.ts → consumer1=globals.css 变量块（人工同步）→ consumer2=antd-providers token 查表 → consumer3=图表组件（本变更新增） |
| 修改 | frontend/src/styles/themes.test.ts | 新增 dark 用例：取值完整性（brand 十一档/slate 十档/语义五档/primary 等）、对称翻转断言（dark.slate[50]===浅色 slate[900] 等） |
| 修改 | frontend/src/stores/theme.test.ts | 脏值用例口径更新：dark 转合法值后换用新的非法样例（现有 :66-82 以 dark 为脏值的前提反转） |
| 修改 | frontend/src/app/globals.css | 新增 `[data-theme="dark"]` 全套变量块 + `--muted-fg`/`--color-loading-track` 三主题定义；斑马纹混白→混 var(--color-card)；spinner 边框走变量；清理遗留未启用 .dark 块（176-196 行） |
| 修改 | frontend/tailwind.config.ts | slate 阶改 `var(--color-slate-*)` 函数映射（照 brand 现成模式含 color-mix alpha 分支）；删除基础调色板段的写死 slate |
| 修改 | frontend/src/stores/theme.ts | merge：`persisted.theme === undefined` 时读 matchMedia 跟随系统；注释口径同步 |
| 修改 | frontend/src/app/layout.tsx | 防闪烁脚本：合法值加 `dark`；无记录分支跟随 prefers-color-scheme；注释同步 |
| 修改 | frontend/src/components/antd-providers.tsx | algorithm 按主题切换（dark→darkAlgorithm）；import theme as antdTheme |
| 修改 | frontend/src/components/theme-toggle.tsx | 二态直切改 antd Dropdown 三选一（含当前项高亮/aria） |
| 修改 | frontend/src/lib/ppm/aggregations.ts | 图表 series 颜色入参化（文字/分割线色由调用方按当前主题传入，替换编译期静态 CHART_COLORS） |
| 修改 | frontend/src/components/charts/WorkHourPieChart.tsx | 订阅 useThemeStore，option 文字/分割线色从 themes 表取并传入 aggregations |
| 修改 | frontend/src/components/charts/WorkHourBarChart.tsx | 同上 |
| 修改 | frontend/src/components/charts/RuntimeUsageLineChart.tsx | 同上 |
| 修改 | frontend/src/components/agent-log/run-error-item.tsx | bg-white→bg-card（表面场景；12 处，品牌底保留，§5.3 口径） |
| 修改 | frontend/src/components/agent-log-viewer.tsx | 同上（6 处） |
| 修改 | frontend/src/components/agent-log/tool-renderers.tsx | 同上（2 处） |
| 修改 | frontend/src/app/(dashboard)/runtimes/page.tsx | 同上（6 处） |
| 修改 | frontend/src/app/(dashboard)/runtimes/[id]/audit/page.tsx | 同上 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/page.tsx | 同上 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/approvals/page.tsx | 同上 |
| 修改 | frontend/src/app/(dashboard)/ppm/workbench/page.tsx | 同上 |
| 修改 | frontend/src/app/m/ppm/workbench/page.tsx | 同上 |
| 修改 | frontend/src/app/(auth)/login/page.tsx | 同上（4 处） |
| 修改 | frontend/src/app/error.tsx | 同上 |
| 修改 | frontend/src/components/team-progress.tsx | 同上（4 处） |
| 修改 | frontend/src/components/daemon/runtime-card.tsx | 同上 |
| 修改 | frontend/src/components/daemon/machine-card.tsx | 同上 |
| 修改 | frontend/src/components/workspace/hero-header.tsx | 同上（品牌底场景保留） |
| 修改 | frontend/src/components/workspace-switcher.tsx | 同上 |
| 修改 | frontend/src/components/ui/confirm-captcha.tsx | 同上 |
| 修改 | frontend/src/components/change-file-tree.tsx | 同上 |
| 修改 | frontend/src/components/ask-user-dialog-card.tsx | 同上 |
| 修改 | frontend/src/components/top-bar.tsx | 同上 |
| 修改 | frontend/src/components/mission-summary-card.tsx | 同上 |
| 修改 | frontend/src/components/error-boundary.tsx | 同上 |
| 修改 | frontend/src/components/agent-run-panel.tsx | 同上 |
| 新增 | .sillyspec/changes/2026-08-23-frontend-dark-theme/prototype-frontend-dark-theme.html | 已生成（三主题可切换原型，含顶栏/侧边栏/表格/气泡/徽标/表单） |

localStorage `sillyhub-theme` 存储格式不变（`{"state":{"theme":"..."},"version":0}`），仅取值域扩 `'dark'`：producer=useThemeStore persist 写入 → 首帧 layout inline script 直读 JSON.parse → html data-theme；React 侧 antd-providers 经 store state 取值（不直读 localStorage）。两端合法值白名单同步扩展是本变更必须成对完成的点。

## 7. 接口定义

```ts
// styles/themes.ts
export type ThemeName = 'blue' | 'ai-native' | 'dark';   // 扩展点：+ 'dark'
export const themes: Record<ThemeName, ThemeDef>;          // + dark 项（label: '暗夜'）
export const DEFAULT_THEME: ThemeName = 'ai-native';        // 不变

// stores/theme.ts —— ThemeState 签名不变（theme / setTheme），仅 merge 内部逻辑扩展：
// persisted.theme === undefined && matchMedia('(prefers-color-scheme: dark)').matches
//   → theme = 'dark'；否则 DEFAULT_THEME。persisted.theme 非法值兜底口径不变。

// antd-providers.tsx
import { theme as antdTheme } from 'antd';
algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm

// theme-toggle.tsx：Dropdown items 由 themes 注册表生成（id/label/色板），onClick setTheme(name)
```

## 7.5 生命周期契约表

本变更为纯前端主题系统扩展，不涉及生命周期契约（无 session/lease/agent_run/daemon/lifecycle 状态流转与事件）。

## 8. 数据模型

无数据库/后端 schema 变更。前端持久化仅 localStorage `sillyhub-theme` 取值域扩展（见 §6 数据流标注）。

## 9. 兼容策略（brownfield）

- **未选择过主题的老用户**：localStorage 无 `sillyhub-theme` → 新行为（跟随系统）；此前默认 ai-native。系统浅色用户观感不变，系统暗色用户首次获得暗色（正是需求目标，非破坏）。
- **已选择 blue/ai-native 的用户**：localStorage 有合法值 → 行为与现状完全一致。
- **脏值兜底**：merge 与 layout 脚本对非法值回落 ai-native（现状口径不变）；`dark` 从「非法值」转为合法值。
- **浅色两主题零回归**：slate 变量化逐值相等、bg-card 浅色=纯白、斑马纹混 var(--card) 浅色下=混白等值。
- 不改变的接口：后端 API、WS 协议、路由结构、组件 props 契约。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | slate 变量化后 `/` 透明度修饰符经 color-mix 生效，与原 hex+opacity 行为差异 | P1 | brand 阶同模式已在线上运行；themes.test.ts + tailwind 生成 CSS 抽查；浅色取值逐值相等断言 |
| R-02 | bg-white 清理误改品牌底/渐变上的白色导致浅色回归 | P1 | §5.3 判断口径逐处过；浅色两主题浏览器实测清单页+工作区页 |
| R-03 | darkAlgorithm 与手写 token（如表头 brand-50=#2e1065）组合出怪色 | P1 | 原型对照；实测表格/Menu/Tabs/Modal 高频组件，必要时 dark 表内微调取值（仍限 Tailwind 阶） |
| R-04 | ECharts 文字色适配遗漏（第三个图表 option 路径不同） | P1 | 三组件统一改造模式 + 三主题截图核对 |
| R-05 | 深嵌套内容（markdown 代码块、syntax highlight）暗色残留浅底 | P2 | knowledge/scan-docs 页实测；登记遗留清单（若语法高亮主题需引暗色样式，按需补） |
| R-06 | matchMedia 在旧浏览器/隐私模式返回异常 | P2 | 脚本 try-catch 包裹，异常回落 ai-native（与现状兜底一致） |
| R-07 | 存量测试 mock 主题名仅 blue/ai-native，加 dark 后断言口径过期 | P2 | 跑全量前端测试，按需补 mock 值（不改测试逻辑本身） |

## 11. 决策追踪

见 `decisions.md`。当前版本决策：

- **D-001@v1** 暗色作为第三主题（与 blue/ai-native 并列三选一）→ 覆盖 FR-01/FR-02，§2/§5.2
- **D-002@v1** 首次访问跟随 prefers-color-scheme，手动选择后以选择为准 → 覆盖 FR-03，§5.2 store/layout 段
- **D-003@v1** 实现走扩展 data-theme 变量体系（否决 dark: 前缀类 / 仅语义重映射两案）→ 覆盖全局，§5
- **D-004@v1** 暗色取值 = Tailwind 默认阶对称翻转 + 主色/语义提亮一档 → 覆盖 FR-01，§5.1
- **D-005@v1** tailwind slate 阶变量化（var(--color-slate-*) + color-mix alpha），浅色取值逐值相等 → 覆盖 FR-04，§5.2
- **D-006@v1** antd dark 主题经 darkAlgorithm，组件 token 继续查 themes 表不加分支 → 覆盖 FR-01，§5.2

无未解决决策。

## 12. 自审（Self-Review）

- 章节齐全：背景/目标/非目标/拆分/方案/清单/接口/数据模型/兼容/风险/决策/自审 ✓
- 生命周期关键词检查：本变更「不涉及生命周期契约」豁免声明已写（§7.5）✓
- 单一源铁律复核：取值仍收敛 themes.ts；globals.css 变量块为既定同步机制（人工同步注释+测试断言翻转对称）；组件零散 hex 只减不增 ✓
- 浅色零回归可验证性：slate 逐值相等 + bg-card 浅色=白，均有测试断言点 ✓
- ⚠️ 自审存疑 1：darkAlgorithm 与 brand-50 深紫表头的组合效果未经真机验证，R-03 已登记，execute 阶段首批验证。
- ⚠️ 自审存疑 2：agent-log 系列嵌套渲染路径多，bg-white 清理可能有二次发现，允许 execute 期间在清单外补录（走 quick log），不算 scope 变更。
- 原型核对：变更目录已有 prototype-frontend-dark-theme.html（建议级）✓
- **Design Grill 修正记录**（2026-08-23，独立审查 23 项交叉检查 17 pass / 6 gap / 0 fail，review.json 已注册）：C-04 bg-white 文件数 18→23（补 5 文件）；C-05 图表色归属补 lib/ppm/aggregations.ts 入参化改造；C-06 「补 --color-slate-* 声明」修正为「已存在，仅消费侧切映射」；C-08 spinner 边框改走 --color-loading-track 变量（浅色保持 rgba(0,0,0,0.08) 原值，严格零变化）+ 斑马纹变量名修正为 --color-card；C-21 遗留 .dark 死块纳入清理；C-22 accent 提亮措辞修正（cyan-600→400 两档）。关键可行性假设经实证：zustand 4.5.7 persist 正常水合不回写（「无记录=从未选择」成立）、服务端 storage 早退保证 SSR 安全、antd 6.4.4 导出 darkAlgorithm。
