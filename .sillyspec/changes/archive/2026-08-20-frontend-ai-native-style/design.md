---
author: qinyi
created_at: 2026-08-20T09:45:00
scale: large
source_change: 2026-08-20-frontend-ai-native-style
---

# 设计文档（Design）— 前端 AI-Native 视觉重构 + 蓝紫可切换主题

> 原型：`prototype-frontend-ai-native-style.html`（本变更目录内，评审稿同源，execute 对照基线）
> 评审记录：`docs/ui-redesign-ai-native-prototype-2026-08-20.html`（用户已确认方向与模板）

## 1. 背景

用户经 ui-ux-pro-max 技能生成的 AI-Native 模板评审，确认将全站视觉从现版"明亮蓝"（主色 #2563EB，2026-06 设计系统）切换为"AI 紫"（主色 #7C3AED × 交互青 #0891B2 × 淡紫底 #FAF5FF）。同时用户明确要求**本变更直接实现主题切换**（蓝 ↔ AI 紫两套，AI 紫默认，可切回旧蓝）。

现状（代码依据）：
- 样式已有单一源架构：`frontend/src/styles/tokens.ts`（TS 常量 + cssVars 字符串）→ `globals.css` 注入 → antd `antd-providers.tsx` ConfigProvider 消费 + Tailwind HSL 语义变量映射（`tailwind.config.ts`）。
- 主色以"蓝"渗透全站：**198 处** `bg/text/border-blue-*` Tailwind 类（分布 **56 文件**，其中浅档 bg-blue-50×43 / bg-blue-100×10 / border-blue-200×18 等 100+ 处是品牌用途）、17 处 `#2563eb` hex、kanban `PALETTE`（引用 tokens 阶常量的色板映射）、登录页渐变、`::selection`/`:focus-visible` 硬编码 `#3b82f6`、globals.css 路由 spinner `rgba(22,119,255,.7)`。这些**不会**随 token 切换自动变化，是主题化的最大障碍。现有 tailwind blue 阶是直接 hex（注释明言不走 CSS 变量），浅档品牌用途必须经**主题感知的 brand 语义色阶**（见 §5 P0，D-003@v2）才能在两套主题下正确还原。

## 2. 设计目标

1. 全站基础视觉落地 AI-Native 取值（按评审模板 token 表），antd 与 Tailwind 双消费方全局生效。
2. 可切换主题：`blue`（现版原值平移）/ `ai-native`（默认）两套，顶栏切换入口，localStorage 记忆偏好，SSR 首帧不闪烁。
3. 清扫硬编码品牌蓝 → 语义色，使两套主题下全站表现一致（D-003）。
4. 会话页 AI 原生细节：流式输出光标、typing 三点指示、上下文引用卡片（仅表现层，D-004）。
5. 骨架不动：PageContainer/PageHeader/SectionCard/DataTable/StatusBadge 结构与 FRONTEND_PAGE_STYLE.md 规范完全保留，只换取值。

## 3. 非目标

- ❌ 暗色模式（`globals.css` 的 `.dark` 变量位继续预留不启用，沿用 2026-06 变更 D-001@v1）
- ❌ 不改业务逻辑 / 数据流 / API / SSE 协议
- ❌ 不替换 antd 组件、不引第三方 UI 库（沿用 D-006@v1 双库边界）
- ❌ 不做第三套主题、不做主题自定义器
- ❌ 不做移动端 m/* 专项适配（顺带受益但不逐页核对）

## 4. 拆分判断

单一变更，不拆分、不批量。理由：主题注册表、蓝色清扫、会话页细节三者强耦合——清扫不完成则切换主题后蓝色残留；注册表不落地则清扫无目标取值。属同一设计系统的连贯改造，由 plan 阶段按 Wave 分组管理（清扫段按目录分 Wave 控制单 Wave 体量）。

## 5. 总体方案（分 Phase，plan 细化为 Wave）

| Phase | 内容 | 类型 |
|---|---|---|
| P0 地基 | `themes.ts` 主题注册表（blue/ai-native 两套完整 color，radius/shadow/font/spacing 共享）；**brand 语义色阶**：globals.css 定义 `--color-brand-50..950` 双套取值（`:root`=violet 紫阶 / `[data-theme="blue"]`=现有 blue 阶值），tailwind 映射 `brand.*` 走 CSS 变量（D-003@v2）；`stores/theme.ts`（zustand persist）；`antd-providers.tsx` 动态化（token 取当前主题 + 同步 html data-theme）；`app/layout.tsx` 防闪烁 inline script | 核心 |
| P1 切换入口 | `components/theme-toggle.tsx`（Palette 图标两态直切）接入 `top-bar.tsx` | 核心 |
| P2 蓝色清扫 | 品牌用途 `bg/text/border-blue-*`（**含全部浅档**）→ `brand-*` 语义阶类（主题感知，blue 主题下自动还原旧蓝观感）；17 处 hex、登录页渐变、`agent-profile-form.tsx`/`lib/file/utils.tsx` hex 直引改主题引用；kanban `PALETTE` 的 tokens 阶引用改 themes/brand 阶；9 文件 `message.xxx` 裸调迁 `useNotify()`（静态方法不吃主题，两主题下都渲染 antd 默认蓝）；按目录分 Wave（56 文件，ppm/kanban 集群、workspaces、components/…） | 渐进 |
| P3 会话页 AI 细节 | 流式光标（caret blink）、typing 三点、上下文引用 chip 样式（数据源=turn 快照既有 whoLine/上下文字段，仅新增展示样式；无自然接入位则仅交付样式组件入库）；动效全部尊重 reduced-motion | 核心 |
| P4 收尾验收 | vitest 单测、tsc/eslint、Docker rebuild 截图对照原型（两套主题各过核心页；blue 主题验收口径见 §9）、grep 验收品牌蓝清零、文档同步（FRONTEND_PAGE_STYLE.md §7 info 档说明 + scan 文档） | 收尾 |

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/styles/themes.ts` | 主题注册表：`themes: Record<ThemeName, ThemeDef>` + `DEFAULT_THEME`；替代 tokens.ts 的单一 palette |
| 新增 | `frontend/src/stores/theme.ts` | `useThemeStore`（zustand persist）；**数据流标注（新增配置键）**：producer=`useThemeStore` persist 写 `localStorage["sillyhub-theme"]` → consumer1=`app/layout.tsx` inline script 首帧前读取并设 `document.documentElement.dataset.theme`（防 SSR 闪烁）→ CSS 变量双套消费；consumer2=store state 驱动 antd token（React 侧，不走 localStorage 直读） |
| 新增 | `frontend/src/components/theme-toggle.tsx` | 顶栏切换按钮（lucide Palette，两态直切，title 提示当前主题） |
| 新增 | `frontend/src/styles/themes.test.ts` | 两套主题结构一致性单测（color 键集合相同、语义五档齐全） |
| 删除 | `frontend/src/styles/tokens.ts` | 已被 themes.ts 取代。实际消费方 9 处全部迁移：`antd-providers.tsx`、`ppm/work-hour-statistics/page.tsx`、`workspaces/[id]/components/topology/page.tsx`、`ppm/kanban/page.tsx` + kanban `_components/*` 3 文件、`lib/ppm/aggregations.ts`、`styles/index.ts` barrel 本体（Grill X2 修正） |
| 修改 | `frontend/src/app/globals.css` | 双套 CSS 变量（`:root`=ai-native / `[data-theme="blue"]`=旧蓝），**含 brand 语义阶 50-950 双套**（紫阶/蓝阶，D-003@v2）；`::selection`/`:focus-visible` 改 `var(--primary)` 系；滚动条紫调；路由 spinner `rgba(22,119,255,.7)` 改 var；新增会话页 caret/typing/ctx-chip utility（P3） |
| 修改 | `frontend/tailwind.config.ts` | extend.colors 增 `brand` 语义阶（50-950，走 `var(--color-brand-*)`，主题感知）；blue 阶保留（真实信息色用途 + 非 brand 场景） |
| 修改 | `frontend/src/components/antd-providers.tsx` | ConfigProvider token 从 `useThemeStore` 当前主题取（组件 token 的 blue 阶引用 → 主题 palette.brand 阶字段）；useEffect 同步 `document.documentElement.dataset.theme` |
| 修改 | `frontend/src/app/layout.tsx` | `<head>` 注入防闪烁 inline script（读 localStorage 设 data-theme，默认 ai-native） |
| 修改 | `frontend/src/components/top-bar.tsx` | 接入 `<ThemeToggle />`（通知铃与用户菜单之间） |
| 修改 | `frontend/src/app/(auth)/login/page.tsx` | 硬编码蓝渐变/hex → 主题 CSS 变量（两主题下登录页均协调） |
| 修改 | `frontend/src/app/(dashboard)/ppm/kanban/page.tsx`（含 `_components/*`） | `PALETTE` 对 tokens 阶常量的引用 → themes/brand 阶引用（D-003@v2） |
| 修改 | `frontend/src/components/ui/status-badge.tsx` | info 档色值改 accent 青（两主题统一，D-003@v2；blue 主题例外声明见 §9） |
| 修改 | 蓝色清扫目标文件集 | 品牌用途 `bg/text/border-blue-*` → `brand-*` 语义阶（198 处分布 56 文件，P2 grep 枚举，plan 阶段列精确清单）；含 `agent-profile-form.tsx`、`lib/file/utils.tsx` hex 直引；含 9 文件 `message.xxx` 裸调迁 `useNotify()`（kanban 集群 / sessions/page / ppm-user-select / session-config-bar / stores/kanban.ts 等） |
| 修改 | `frontend/src/components/daemon/turn-timeline.tsx`（及 sessions 相关组件） | 流式输出光标 + typing 指示 + 上下文引用 chip（P3，仅样式层；ctx-chip 数据源=turn 快照 whoLine） |

> 无后端 / DTO / OpenAPI 变更，不涉及 `pnpm gen:types`。

## 7. 接口定义

```ts
// styles/themes.ts
export type ThemeName = "blue" | "ai-native";
export type BrandScale = Record<"50"|"100"|"200"|"300"|"400"|"500"|"600"|"700"|"800"|"900"|"950", string>;
export interface ThemeColorDef {
  primary: string;                    // blue: #2563EB / ai-native: #7C3AED
  primaryHover: string;               // #1d4ed8 / #6D28D9
  accent: string;                     // #06b6d4 / #0891B2（交互青）
  bg: string; card: string; border: string;           // 页面底/卡片/边框
  brand: BrandScale;                  // 品牌阶：blue=现有 blue 阶值 / ai-native=violet 阶值（CSS 变量 --color-brand-* 双套注入）
  slate: { 50: string; /* …同现 tokens.slate 结构… */ 900: string };
  semantic: { success: string; warning: string; error: string; info: string; neutral: string }; // 五档（info=accent）
}
export interface ThemeDef { name: ThemeName; label: string; color: ThemeColorDef }
export const themes: Record<ThemeName, ThemeDef>;
export const DEFAULT_THEME: ThemeName = "ai-native";

// stores/theme.ts
export const useThemeStore = create<ThemeState>()(persist(
  (set) => ({ theme: DEFAULT_THEME, setTheme: (t: ThemeName) => set({ theme: t }) }),
  { name: "sillyhub-theme" },
));
```

antd 消费：`const { theme } = useThemeStore()` → `themes[theme].color` 填 ConfigProvider `token` / `components`。CSS 消费：`globals.css` 双套块（结构同现有 `--color-*`/HSL 变量）+ brand 阶双套（`--color-brand-50..950`）。Tailwind 消费：`bg-brand-50` 等类经 `var(--color-brand-50)` 自动随主题切换。

## 7.5 生命周期契约

不涉及生命周期契约（本变更纯前端样式/主题表现层：不改 session/lease/agent_run/daemon 的任何事件、状态流转、必需字段与 API；会话页仅改渲染样式，SSE 数据流与协议零变更）。

## 8. 数据模型

不涉及（无表结构/字段变更，无后端改动）。

## 9. 兼容策略（brownfield）

- 旧观感保留路径：切到 `blue` 主题 = 现版取值原样平移（含登录页、kanban、antd 组件 token、brand 阶全部浅档），老用户一键回旧观感。**例外（D-003@v2）**：info 状态徽标色两主题统一 accent 青（现版为 antd 默认蓝），切回 blue 后"进行中"等状态点为青色而非蓝色——保证状态语义跨主题一致，用户已在设计②段确认。
- **blue 主题验收口径**（"原样平移"的可测定义）：Docker rebuild 后 blue 主题逐页人工对照重构前同页截图——主色/选中态/表格头/卡片边框/按钮/徽章色一致（info 徽标档除外）；不要求像素级 diff，语义色位逐项核对。
- 新用户/未设偏好：默认 `ai-native`。
- localStorage 旧值不存在 → inline script 兜底 `ai-native`；值非法（非 ThemeName）→ 同样兜底。
- 回退路径：主题机制若出问题，`DEFAULT_THEME` 改回 `blue` + 不渲染 ThemeToggle 即回到现版观感（token 层结构不变）。
- 不改变的 API / 表结构 / SSE 协议：零后端变更。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | 蓝色清扫遗漏（198 处类名 + 17 处 hex 分布 56 文件），切换主题后残留蓝色 | P1 | P2 结束 grep 全量扫描 `bg-blue|text-blue|border-blue|#2563eb|#3b82f6|rgba(22, 119, 255` 复核品牌用途清零；verify 抽查 + 两套主题截图对照 |
| R-02 | antd 动态切换瞬间样式重算，可能出现短暂闪烁 | P2 | 主题切换为低频操作，antd 官方动态主题路径可接受；如实测明显再评估 cssVar 优化（另立项，不在本变更） |
| R-03 | SSR 首帧主题闪烁（服务端默认渲染与 localStorage 偏好不一致） | P1 | layout inline script 在首帧渲染前设 data-theme（`<html suppressHydrationWarning>` 已备，Grill X10 确认可行）；antd 侧首帧以 store 初始值渲染（blue 偏好用户有一次重绘，低频可接受），CSS 变量侧由 script 保证 |
| R-04 | AI 紫阶对比度不足（紫 300 文字在淡紫底上可读性） | P2 | 取值沿用评审模板已核档位（正文用 #1E1B4B/#475569，紫只用于强调/交互）；verify 两主题逐页人工核对 |
| R-05 | 静态方法弹层（message）不跟随主题：实测 9 文件仍裸调 `message.xxx`（kanban 集群、sessions/page、ppm-user-select、session-config-bar、stores/kanban.ts 等） | P1 | P2 并入迁移 `useNotify()`（App.useApp 走主题 context）；迁移后 grep `from "antd".*message` 复核无裸调残留（Grill X5 修正事实） |
| R-06 | Docker 前端不热重载，需 rebuild 实测 | P2 | verify 阶段 rebuild + 截图，不只靠 tsc |
| R-07 | PPM 已上线模块观感突变影响存量用户 | P2 | 主题全局生效但可一键切回 blue；PPM 页面在 verify 单独截图核对 |

## 11. 决策追踪

见 `decisions.md`。当前版本决策均被本文覆盖：D-101@v1（主题机制=注册表+state 驱动+html 属性双驱动，§5 P0/§7）、D-102@v1（默认 ai-native + localStorage key `sillyhub-theme`，§6/§9）、D-003@v2（清扫原则升级：brand 语义色阶 CSS 变量双套 + info 统一青 + 例外声明，supersedes D-003@v1，§5 P0/P2/§9/§6）、D-004@v1（会话页 AI 细节仅表现层，§3/§7.5）。沿用 2026-06 变更 D-001@v1（暗色非目标，§3）、D-005@v1（状态语义五档，§6 status-badge）、D-006@v1（antd+Tailwind 双库边界，§3）。无未解决决策。

## 12. 自审（Self-Review）

| 检查项 | 结果 |
|---|---|
| 需求覆盖（AI-Native 落地/可切换主题/清扫/会话页细节/骨架不动） | ✅ §2 五目标对应用户确认的六段设计 |
| 非目标明确（暗色/业务逻辑/换库/第三主题/移动端专项） | ✅ §3 |
| 章节齐全（背景/目标/非目标/拆分/方案/清单/接口/数据模型/兼容/风险/决策/自审） | ✅ |
| 文件清单真实性 | ✅ Grill 后修正：tokens.ts 消费方 9 处实证、清扫量 198 处/56 文件、message 裸调 9 文件入清单；"清扫目标文件集"标注 plan 精确化 |
| localStorage 新配置键数据流标注 | ✅ §6 stores/theme.ts 行 producer→consumer |
| 生命周期关键词（session）出现但纯样式层 | ✅ §7.5 豁免短语「不涉及生命周期契约」紧邻成句 |
| YAGNI | ✅ 不做 cssVar 优化/暗色/自定义器（R-02 应对注明另立项） |
| 验收标准可测 | ✅ grep 清零 + 单测 + tsc/eslint + Docker 截图两主题对照 + §9 blue 验收口径（"原样平移"可测定义） |
| Design Grill P1 修正落实 | ✅ X1→brand 语义阶 CSS 变量双套（D-003@v2）；X2→消费方 9 处实证修正；X3→§9 例外声明；P2 项（X4 验收口径/X5 R-05 事实/X6 措辞/X7 grep 模式/X8 ctx-chip 数据源）全部落实 |
| ⚠️ 自审存疑 | 无 |
