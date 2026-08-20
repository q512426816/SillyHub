---
plan_level: full
---

# 实现计划（Plan）：前端 AI-Native 视觉重构 + 蓝紫可切换主题

> 来源：design.md（§5 Phase P0-P4）+ tasks.md（15 任务骨架）+ decisions.md（D-101@v1 / D-102@v1 / D-003@v2 / D-004@v1）。
> 技术方案经 Design Grill 独立审查通过（brand 阶机制/消费方清单/info 例外均已定），无 Spike 前置需求。
> Wave 结构按 CLI 拓扑排序校验重排（task-05 依赖 task-04 不得同 Wave 等），8 Wave 串行推进。

## Wave 1（地基·并行，无依赖）
- [ ] task-01: `styles/themes.ts` 主题注册表——blue/ai-native 两套完整 ThemeDef + BrandScale 十一档 + DEFAULT_THEME='ai-native'（覆盖：FR-01, D-101@v1, D-003@v2）
- [ ] task-03: `tailwind.config.ts` 增 `brand` 语义阶（50-950 走 `var(--color-brand-*)`，不依赖 themes.ts，纯变量名映射）（覆盖：FR-01, D-003@v2）

## Wave 2（依赖 Wave 1，两任务并行无共享文件）
- [ ] task-02: `globals.css` 双套 CSS 变量（`:root`=ai-native + `--color-brand-*` 紫阶；`[data-theme="blue"]`=旧蓝 + brand 蓝阶）+ `::selection`/`:focus-visible`/滚动条/spinner 硬编码蓝改 var（覆盖：FR-01, D-003@v2）
- [ ] task-04: `stores/theme.ts` useThemeStore（zustand persist，key `sillyhub-theme`，非法值兜底）（覆盖：FR-02, D-101@v1, D-102@v1）

## Wave 3（依赖 Wave 2；task-05 需 task-04 完成后方可编译，四任务并行无共享文件）
- [ ] task-05: `antd-providers.tsx` 动态化——token/components 从 useThemeStore 当前主题取（含 antd-providers 自身 tokens→themes 迁移）+ useEffect 同步 html data-theme（覆盖：FR-03, D-101@v1）
- [ ] task-06: `app/layout.tsx` 防闪烁 inline script（首帧前读 localStorage 设 data-theme，兜底 ai-native）（覆盖：FR-02, D-102@v1）
- [ ] task-07: `theme-toggle.tsx` 组件 + `top-bar.tsx` 接入（Palette 图标两态直切）（覆盖：FR-02, D-101@v1）
- [ ] task-13: 会话页 AI 细节——流式光标/typing 三点/ctx-chip（globals.css utility + turn-timeline 样式，whoLine 数据源，reduced-motion 退化；SSE 协议零改动）（覆盖：FR-05, D-004@v1）

## Wave 4（依赖 Wave 3；tokens 删除须在 antd-providers 迁移后）
- [ ] task-08: 删除 `tokens.ts` + 其余 8 处消费方迁移（work-hour-statistics / topology / kanban×4 / aggregations.ts / styles/index.ts barrel）+ tsc 断链复核（覆盖：FR-04, D-003@v2）
- [ ] task-12: info 档改 accent 青——经 `themes.semantic.info`（antd ConfigProvider `colorInfo`）实现，`status-badge.tsx` 本体核对后预计零代码改动（组件是 kind→antd Badge status 映射，无色值）；登录页渐变主题化（覆盖：FR-04, FR-06, D-003@v2）

## Wave 5（依赖 Wave 4；清扫与单测并行无共享文件）
- [ ] task-09: 清扫 Wave A——ppm 域 + kanban 集群（品牌用途含浅档 blue-*→brand-*；kanban PALETTE 阶引用迁 themes/brand；本域 message 裸调文件 kanban×4 + work-hour-statistics 的 useNotify 迁移并入）（覆盖：FR-04, D-003@v2）
- [ ] task-14: vitest 单测——themes 两套结构一致性（color 键集合/brand 十一档/五档语义）/ store 切换与持久化 / antd token 跟随当前主题（覆盖：FR-01, FR-02, FR-03）

## Wave 6（依赖 Wave 5 的 task-09；kanban/page.tsx 独占归 09 后 10 才动域内文件）
- [ ] task-10: 清扫 Wave B——`app/` 下非 ppm 域、非 login（归 task-12）的全部页面（workspaces/sessions/admin/settings/account/agent-profiles/runtimes/m/* 等；sessions/page 的 message 迁移并入）（覆盖：FR-04, D-003@v2）

## Wave 7（依赖 Wave 5/6）
- [ ] task-11: 清扫 Wave C——components/lib/stores 杂项域（含 agent-profile-form/lib-file-utils hex 直引 + 本域 message 裸调迁移）+ **同步更新 components 域 `__tests__` 中断言 blue 类名的 5 个用例文件**（change-step-badge / change-step-timeline / machine-card / session-list-layout / turn-segment-views），断言随 brand-* 类名同步改写（覆盖：FR-04, D-003@v2）

## Wave 8（依赖全部）
- [ ] task-15: 总验收——grep 复核品牌蓝清零（`bg-blue|text-blue|border-blue|#2563eb|#3b82f6|rgba(22, 119, 255`，信息语义逐一判断）/ tsc+eslint 0 error / `pnpm test` 全绿 / Docker rebuild 两主题核心页截图对照原型 + blue 逐页对照重构前截图（info 档除外）/ FRONTEND_PAGE_STYLE.md §7 与 scan 文档同步（覆盖：FR-04, FR-06, 全部 D）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | themes.ts 主题注册表 | W1 | P0 | — | FR-01, D-101, D-003@v2 | 两套取值含 brand 阶；radius/shadow/font 共享 |
| task-03 | tailwind brand 阶映射 | W1 | P0 | — | FR-01, D-003@v2 | 走 CSS 变量，与 themes.ts 无编译依赖可并行 |
| task-02 | globals.css 双套变量 | W2 | P0 | task-01 | FR-01, D-003@v2 | 值从 themes.ts 派生；硬编码蓝一并清理 |
| task-04 | 主题 store | W2 | P0 | task-01 | FR-02, D-101, D-102 | persist；JSDoc 写边界（localStorage 即真相源） |
| task-05 | antd-providers 动态化 | W3 | P0 | task-01, task-04 | FR-03, D-101 | 组件 token blue 阶引用→themes[t].color.brand |
| task-06 | layout 防闪烁脚本 | W3 | P1 | task-02 | FR-02, D-102 | `<html suppressHydrationWarning>` 已备 |
| task-07 | 切换按钮接入 top-bar | W3 | P1 | task-04 | FR-02, D-101 | 通知铃与用户菜单之间 |
| task-13 | 会话页 AI 细节 | W3 | P1 | task-02 | FR-05, D-004 | 仅表现层；whoLine 数据源；reduced-motion 退化 |
| task-08 | tokens.ts 删除+8 处迁移 | W4 | P0 | task-05 | FR-04, D-003@v2 | antd-providers 已在 task-05 迁移；删 barrel 重导出 |
| task-12 | info 青经 colorInfo+登录页 | W4 | P1 | task-01, task-05 | FR-04, FR-06, D-003@v2 | status-badge 本体预计零改动 |
| task-09 | 清扫 A：ppm/kanban+域内 message | W5 | P0 | task-08 | FR-04, D-003@v2 | 含 kanban×4+work-hour-statistics 的 message 迁移；kanban/page.tsx 独占 |
| task-14 | 单测 | W5 | P1 | task-01~08 | FR-01, FR-02, FR-03 | 结构一致性/持久化/antd 跟随 |
| task-10 | 清扫 B：app 非 ppm 页面 | W6 | P0 | task-08, task-09 | FR-04, D-003@v2 | login 归 task-12；含 sessions/page message 迁移 |
| task-11 | 清扫 C：components/lib/stores+测试同步 | W7 | P0 | task-09, task-10 | FR-04, D-003@v2 | 5 个 blue 类名断言测试随 brand-* 改写 |
| task-15 | 总验收+文档同步 | W8 | P0 | 全部 | FR-04, FR-06, 全 D | grep 清零+tsc/eslint+Docker 两主题截图+文档 |

## 关键路径

task-01 → task-04 → task-05 → task-08 → task-09 → task-10 → task-11 → task-15（themes 定义 → store → antd 动态化 → tokens 删除 → 清扫三连 → 验收）

## 全局验收标准

- [ ] 两套主题一键切换全站即时生效（antd + Tailwind 语义类 + brand 阶全部跟随），刷新保持偏好，首帧无闪烁
- [ ] grep 复核品牌用途蓝清零（`bg-blue|text-blue|border-blue|#2563eb|#3b82f6|rgba(22, 119, 255`，仅剩信息语义场景且逐一判断）
- [ ] blue 主题按 design §9 验收口径逐页对照重构前截图一致（info 徽标档除外）
- [ ] `pnpm -C frontend exec tsc --noEmit` + eslint 0 error；`pnpm test` 全绿（含新增单测）
- [ ] Docker rebuild 后两主题核心页（工作区/会话/PPM 表格/登录/kanban）截图对照原型通过
- [ ] （brownfield）未设偏好用户默认 ai-native；移除 ThemeToggle+DEFAULT_THEME 改 blue 可整体回退
- [ ] 集成冒烟：layout/providers/top-bar 跨组件装配经 Docker 实测（组件单测全绿 ≠ 集成正确）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-101@v1 | task-01, 02, 04, 05, 07 | 注册表+双驱动机制，task-15 切换实测 |
| D-102@v1 | task-04, 06 | persist+防闪烁，task-15 刷新实测 |
| D-003@v2 | task-02, 03, 08, 09, 10, 11, 12 | brand 阶+清扫+info 例外，task-15 grep+截图 |
| D-004@v1 | task-13 | 仅表现层，task-15 会话页截图 |
| FR-01~FR-06 | 见任务总表覆盖列 | requirements.md GWT 对应 |
