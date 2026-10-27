---
author: qinyi
created_at: 2026-10-26 22:59:29
scale: large  # 见「拆分判断」Wave 证据
---

# 设计文档（Design）— 2026-10-26-mobile-four-page-layout-fix

## 背景

用户真机（iPhone，视口约 430pt）访问 /m/ 移动端四页面，截图暴露一批布局缺陷（2026-10-26 反馈）：会话对话页运行状态条与轮次信息胶囊横向溢出被裁切、输入占位与模型名截断、底部供应商行拥挤；变更中心页「平台同步」卡标题被挤成两行竖排、搜索行 4 控件一行放不下；工作区选择页控件偏大密度低（单屏仅 1~2 卡片）；会话列表页 FAB「+」与悬浮 TabBar 遮挡列表内容。

根因两类：① PC/移动共用组件（TurnLiveMarquee / RoundDivider / PlatformSyncSection 等）无 mobile 分支或分支不完整，窄视口下溢出挤压；② /m/ 专属页面控件尺寸未按手机密度收敛，外壳底部避让预留不足。移动端为独立 App UI（/m/ 路由，middleware 按 UA rewrite），此前已经 ql-20260915-009 / ql-20260915-013 两轮收敛，本轮为第三轮系统性收敛。

## 设计目标

1. 消灭四页面全部硬伤：横向溢出、文字截断、标题竖排挤压、悬浮元素遮挡列表内容。
2. 手机端密度彻底优化：控件尺寸/间距收紧，工作区选择页单屏可见卡片 1~2 → 3~4 个。
3. **硬约束：PC 端（dashboard 路由）效果零劣化**——共用组件所有改动锁在 mobile 分支内，desktop 路径样式一行不动，既有 PC 测试零回归。

## 非目标

- 不重写移动端会话组件套件（D-003@v1 落选方案 C）。
- 不做全局响应式断点改造（D-002@v1 落选方案 B），不给 PC 端引入断点样式。
- 不改任何后端 API / schema / sillyspec CLI（纯前端布局变更，接口面 0 端点）。
- 不改移动端信息架构与交互流程（收纳/入口层级维持 ql-20260915-011 既有决策）。
- 不处理 PPM 移动页面（/m/ppm/**，本轮四页面之外）。

## 拆分判断

**scale=large，Wave 编排证据**：
- 可真并行任务簇：Wave 2（PC 共用会话组件链，文件集 A）与 Wave 3（/m/ 专属页面簇，文件集 B）**文件零重叠**，可并行执行；Wave 1（外壳+密度基底）与两者亦零重叠。
- 上下文分片：组件链含 turn-segment-views.tsx(1778 行)/turn-live-marquee.tsx(1002 行)/platform-sync-section.tsx(1108 行)/session-panel-page.tsx(6000+ 行) 等大文件，加测试面单上下文吃下后还需跑测试修复，分片更稳。
- 治理需求：PC 零回归是硬约束，逐 Wave 独立验收（mobile 用例 + desktop 锚定用例）降低一次性回归排查成本。

## 总体方案（方案 A：既有 mobile 分支机制，D-001@v1）

### Wave 1 — 全局外壳与密度基底（/m/ 独占，零 PC 风险）

1. `mobile-app-shell.tsx` 底部避让精确化：main 的固定 `pb-28` 改为「TabBar 胶囊高 56px + 底距 12px + `env(safe-area-inset-bottom)` + 缓冲」组合（CSS calc，env 带 0px fallback，桌面浏览器模拟器不炸）。
2. `mobile-tab-bar.tsx` 胶囊加不透明底（bg-background 实底或加重毛玻璃），滚动内容从下方穿过不再透字。
3. `globals.css` 新增 /m/ 壳内密度规约块（挂在 `m-app` 容器选择器下）：按钮高度、卡片内距、列表行距的 mobile 档基准——一处定义，Wave 3 页面引用，不逐页散调。

### Wave 2 — 会话对话页共用组件链（PC 共用，改动全锁 mobile 分支）

透传链：SessionPanel(variant="mobile") → session-panel-page.tsx:667 `const mobile = variant === "mobile"` → turn-timeline / SessionConfigBar。本轮补齐链尾：

1. `turn-live-marquee.tsx` 新增 `mobile?: boolean` prop（默认 false）：mobile 下状态胶囊收窄——次要信息（token 计数、tok/s）折叠进跑马灯轨道文本而非固定占位（现有 shrink-0 固定段 mobile 收起），主信息「等待模型响应」保证完整展示；顺带核查容器 `sh-live-marquee` 的 min-w-0 约束链（宽度溢出的结构性修复，desktop 同受益属允许的优化性影响）。
2. `round-divider.tsx`（chat/round-divider.tsx，130 行）新增 `mobile?: boolean` prop：mobile 下 meta 段（`↑78,489 ↓2,170 · 53 tok/s · 开始 2X:XX`）允许折行 + 数字缩写（≥10000 显示 78.5k），desktop 不缩写不折行。
3. 透传链新增两级 prop 入口（独立评审 gap 修正，brainstorm stage review review-2026-10-26-230204）：TurnTimeline（turn-timeline.tsx:1529）与 TurnSegmentViews 当前**均无** variant/mobile prop——为两者新增 `variant?: "desktop" | "mobile"` prop（默认 "desktop" = 既有行为），自判定点 session-panel-page.tsx:667 `const mobile = variant === "mobile"` 处透传；组件内部再向 TurnLiveMarquee（turn-timeline.tsx:2485 / turn-segment-views.tsx:1034 挂载点）与 RoundDivider 挂载点下传 mobile。
4. `session-config-bar.tsx` 已有 variant/mobile 机制（:970 max-w-[110px] 等）：收紧 mobile 模型名截断策略与用量徽章（QuotaPill/CtxUsageBar compact 形态）排列，消除「glm-5.3-fla…」截断观感——模型名截断宽度放宽或换行式布局。
5. `session-panel/page-helpers.tsx` `deriveSessionPlaceholder`：补「排队中，本轮结束后自动发送…」态的 mobile 短句（沿用既有 mobile opt 参数模式，ql-20260915-009 先例）。

### Wave 3 — /m/ 三页面密度收敛（/m/ 独占 + PlatformSyncSection 分支）

1. `platform-sync-section.tsx`（PC/移动共用，m 页走 compact 形态）新增 `mobile?: boolean` prop：标题行禁断行（whitespace-nowrap + 弹性收缩）、右侧统计（未决冲突/ghost 计数、数据源机器行）mobile 折行排列——修复「平台同/步」竖排挤压。
2. `app/m/workspaces/[id]/changes/page.tsx:1182` 搜索行改两行布局：搜索框独占一行，搜索/筛选/重新扫描按钮第二行（页面自身改动）。
3. `app/m/workspaces/page.tsx` 密度收紧：创建按钮/搜索框/筛选器高度收敛、筛选器压一行、卡片内距与字号降档、负责人与路径信息合并行——单屏卡片数 3~4。
4. `app/m/workspaces/[id]/sessions/page.tsx`：列表末尾 FAB 让位留白（bottom 预留 ≥ FAB 高 + 间距）；`mobile-workspace-header.tsx` 顶部「变更中心/会话」双按钮高度收紧。

### Wave 4 — 回归验证收口

1. 每个共用组件改动补双用例：mobile 行为用例 + desktop 锚定用例（断言 desktop 形态不变，ql-20260915 惯例）。
2. 相关测试面重跑：daemon sessions 套件、changes 套件、mobile 套件 + `tsc --noEmit` + `eslint`（仅相关文件面，全量归 CI）。
3. PC 端变更中心页 / 会话面板既有测试零回归核对。
4. 用户真机复验四页面。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/mobile/mobile-app-shell.tsx | 底部避让 safe-area 精确化（Wave 1） |
| 修改 | frontend/src/components/mobile/mobile-tab-bar.tsx | 胶囊不透明底（Wave 1） |
| 修改 | frontend/src/app/globals.css | m-app 密度规约块（Wave 1） |
| 修改 | frontend/src/components/daemon/turn-live-marquee.tsx | +mobile prop 胶囊收窄（Wave 2） |
| 修改 | frontend/src/components/chat/round-divider.tsx | +mobile prop 折行/缩写（Wave 2） |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | mobile 透传至 marquee/round-divider（Wave 2） |
| 修改 | frontend/src/components/daemon/turn-segment-views.tsx | marquee 挂载点透传 mobile（Wave 2） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | mobile 判定点向 TurnTimeline 挂载点透传 variant（Wave 2，plan 评审 gap-2 补录） |
| 修改 | frontend/src/components/sessions/session-config-bar.tsx | mobile 模型名/徽章排列收紧（Wave 2） |
| 修改 | frontend/src/components/daemon/session-panel/page-helpers.tsx | 排队态占位 mobile 短句（Wave 2） |
| 修改 | frontend/src/components/changes/platform-sync-section.tsx | +mobile prop 标题禁断行（Wave 3） |
| 修改 | frontend/src/app/m/workspaces/[id]/changes/page.tsx | 搜索行两行化+透传（Wave 3） |
| 修改 | frontend/src/app/m/workspaces/page.tsx | 密度收紧（Wave 3） |
| 修改 | frontend/src/app/m/workspaces/[id]/sessions/page.tsx | FAB 让位+透传（Wave 3） |
| 修改 | frontend/src/components/mobile/mobile-workspace-header.tsx | 顶部双按钮收紧（Wave 3） |
| 修改 | frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx | mobile 用例+desktop 锚（Wave 4） |
| 修改 | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx | variant 透传链端到端用例（task-05 执行期补录：该文件有轻量 renderTimeline helper，落点优于新建） |
| 修改 | frontend/src/components/chat/__tests__/round-divider.test.tsx | 同上（Wave 4） |
| 修改 | frontend/src/components/changes/__tests__/platform-sync-section.test.tsx | 同上（Wave 4） |
| 修改 | frontend/src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx | 布局断言更新（Wave 4） |
| 修改 | frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx | 布局断言更新（Wave 4） |
| 修改 | frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx | 布局断言更新（Wave 4） |

## 接口定义

本变更接口面：0 端点（无接口变更）。纯前端 UI 布局变更：新增的 `mobile?: boolean` 均为组件内部 props（默认 false = 既有 desktop 行为），不涉 API / OpenAPI / gen:types。

## 生命周期契约表

本变更不涉及生命周期契约（lifecycle contract）——纯展示层样式分支，不改 session/lease/agent_run/daemon 任一状态机与状态转移。

## 数据模型

无 schema 变更。

## 兼容策略（brownfield 必填）

- **未配置新功能时行为不变**：所有新 prop 默认 false/缺省，desktop 与 dialog/悬浮宿主等全部既有宿主零行为变化；/m/ 页面与外壳为移动端独占（middleware 按 UA rewrite），PC 浏览器正常访问不进入。
- **回退路径**：改动均为样式层（className 分支 + 少量条件渲染），git revert 单 Wave 提交即回退，无数据/接口迁移。
- **不改变的 API 与表结构**：零 API 改动、零 schema 改动、零 gen:types 义务。
- **允许的优化性影响**（用户已接受）：结构性宽度修复（如 marquee 容器 min-w-0 约束链）若对 desktop 现存的同款溢出隐患有修复效果，属「优化影响 PC 可以接受」范畴，逐处用 desktop 锚定用例断言不劣化。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | PC 端共用组件回归 | P1 | 改动锁 mobile 分支；desktop 锚定用例逐组件断言；相关既有测试（daemon sessions / changes 套件）全绿门槛 |
| R-02 | mobile prop 透传链长（SessionPanel→session-panel-page 判定→TurnTimeline/TurnSegmentViews 两级**新增**入口→marquee/round-divider），任一级漏透传致分支静默不生效 | P1 | 端到端 variant 渲染用例（variant="mobile" 断言 marquee/round-divider 实际呈现 mobile 分支标记）；desktop 锚定断言新 prop 缺省时零变化；用户真机复验 |
| R-03 | env(safe-area-inset-bottom) 桌面浏览器/真机差异 | P2 | env 带 0px fallback；避让值取保守上限 |
| R-04 | 跳过 UI 原型，视觉方向未经原型确认 | P2 | 原型跳过依据：既有页面布局修复无新交互/新信息架构，真机截图对照验证成本低于原型迭代；用户已知情确认（brainstorm Step 5），不满意按页迭代 |
| R-05 | 多 agent 并行同仓修改冲突 | P2 | Edit 前重读最新文件态；按 Wave 文件集隔离提交 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 总体方案全节（mobile 分支机制路线）；Wave 2/3 全部共用组件改动 | 已采纳（source=user） |
| D-002@v1 | 非目标第 2 条（不做响应式断点改造）；兼容策略「允许的优化性影响」边界 | 已否决（落选方案 B，防复潮） |
| D-003@v1 | 非目标第 1 条（不重写移动组件套件） | 已否决（落选方案 C，防复潮） |

无未解决决策。剩余风险即 R-01~R-05。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@vN（D-001/002/003 全引用，无未解决项）
- [x] 涉及生命周期关键词时含豁免短语（「不涉及生命周期契约（lifecycle contract）」紧邻否定）
- [x] UI 原型分级核对：跳过（依据记入 R-04，用户 brainstorm Step 5 知情确认）
- [x] 不确定的问题标注「⚠️ 自审存疑」：⚠️ 自审存疑一处——`mobile-workspace-header.tsx` 顶部双按钮的实际 DOM 尺寸未逐行核实（Wave 3 执行时以现场代码为准收紧，若该文件无直接按钮样式则改在调用页 sessions/page.tsx 收紧，文件清单可能微调）。行号基线：独立评审（brainstorm stage review review-2026-10-26-230204）修正初版一处误冠——turn-timeline.tsx:667 实为 TurnPreviewCard 定义行，真正 mobile 判定点在 session-panel-page.tsx:667（已按评审修订 Wave 2 透传链并把 R-02 升 P1）；全部行号以 HEAD 97d478090 时点核对，本仓多 agent 并行，执行时以符号定位为准。
