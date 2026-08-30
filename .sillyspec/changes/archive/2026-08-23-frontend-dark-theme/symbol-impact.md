---
author: qinyi
created_at: 2026-08-23 23:40:00
---
# 符号影响面报告（Symbol Impact）— 2026-08-23-frontend-dark-theme

对照 plan.md 11 个 task 逐一给出签名级变更结论（构造函数参数/接口/DTO/方法签名增删改）。基线：worktree 分支 sillyspec/2026-08-23-frontend-dark-theme（主仓 HEAD f32a2eeb）。

| task | 签名级变更 | 结论 |
|---|---|---|
| task-01 | 有——类型/接口级：`ThemeName` 联合类型扩 `'dark'`；`themes: Record<ThemeName, ThemeDef>` 注册表新增 `dark` 键。受影响调用点（全部类型检查即过，无运行时行为差异）：stores/theme.ts（merge 键集合）、antd-providers.tsx（查表）、theme-toggle.tsx（查表）、lib/ppm/aggregations.ts:11（import DEFAULT_THEME/themes——编译期取色，行为不变）、styles/themes.test.ts:83-86（键集合断言失效，归 task-10）。均在任务范围内（task-04~07/09/10 卡片覆盖） | 变更类型：type/interface 扩展（向后兼容，不破坏既有消费方） |
| task-02 | 无签名级变更（globals.css 纯 CSS 变量块与规则修正，不触 TS/JS 符号） | 无签名级变更 |
| task-03 | 无签名级变更（tailwind.config.ts 配置映射改造，colors.slate 值从 hex 换 var() 函数——构建配置变化，非代码符号签名） | 无签名级变更 |
| task-04 | 无签名级变更（stores/theme.ts 的 `ThemeState`/`setTheme` 签名不变，仅 persist merge 内部分支扩展） | 无签名级变更 |
| task-05 | 无签名级变更（layout.tsx 的 `themeInitScript` 内联脚本字符串内容更新，导出组件签名不变） | 无签名级变更 |
| task-06 | 无签名级变更（antd-providers.tsx 的 `AntdProviders({children})` props 不变，内部 ConfigProvider algorithm 三元） | 无签名级变更 |
| task-07 | 无签名级变更（theme-toggle.tsx 的 `ThemeToggle()` 无 props，内部改 Dropdown） | 无签名级变更 |
| task-08 | 无签名级变更（23 文件仅 className 字符串替换，不改组件签名/逻辑） | 无签名级变更 |
| task-09 | 有——导出符号形状变化：`CHART_COLORS` 常量 → `chartColors(theme: ThemeName)` 工厂函数（调用点：3 个图表组件 + aggregations.test.ts）；`toPieSeries` 新增可选配色入参（默认值兼容旧调用）；`toBarSeries` 新增可选文字色/分割线色入参（默认值兼容）。受影响调用点：WorkHourPieChart/WorkHourBarChart/RuntimeUsageLineChart（订阅 useThemeStore 后传当前主题取值）+ src/lib/ppm/__tests__/aggregations.test.ts（CHART_COLORS 断言失效）。处置：task-09 卡片 allowed_paths 已补入 4 个测试文件（aggregations.test.ts 与 3 图表测试），受影响面全部在范围内 | 变更类型：导出常量→工厂（breaking，调用点全量在卡内）+ 可选参数追加（非 breaking） |
| task-10 | 无签名级变更（测试用例内容扩展/口径更新，被测符号签名无变化） | 无签名级变更 |
| task-11 | 无签名级变更（纯浏览器实测，无代码产出） | 无签名级变更 |

汇总：签名级变更集中在 task-01（类型扩展，非破坏）与 task-09（导出形状变化，破坏面=4 调用点+1 测试，全部在任务 allowed_paths 内）。其余 9 个 task 无签名级变更。
