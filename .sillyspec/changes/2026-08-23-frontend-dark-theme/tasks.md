---
author: qinyi
created_at: 2026-08-23
---
# 任务清单（Tasks）

- [x] task-01: themes.ts 新增 dark 主题取值（ThemeName 扩 'dark' + 翻转色阶 + 语义提亮档 + 注册表/label）
- [x] task-02: globals.css 新增 [data-theme="dark"] 变量块 + 修正斑马纹/spinner/--muted-fg 三处硬编码 + 清理遗留 .dark 死块
- [x] task-03: tailwind.config.ts slate 阶变量化（var(--color-slate-*) 函数映射，照 brand 模式）
- [x] task-04: stores/theme.ts merge 扩展（无记录时跟随 prefers-color-scheme）(depends_on: task-01)
- [x] task-05: layout.tsx 防闪烁脚本扩展（合法值加 dark + 无记录跟随系统）(depends_on: task-01)
- [x] task-06: antd-providers.tsx 按主题切换 darkAlgorithm (depends_on: task-01)
- [x] task-07: theme-toggle.tsx 升级三选一下拉 (depends_on: task-01)
- [x] task-08: 全站 bg-white→bg-card 清理（23 文件，表面场景替换/品牌底保留）(depends_on: task-01,task-02,task-03)
- [x] task-09: ECharts 主题感知（aggregations.ts 颜色入参化 + 3 图表组件订阅 useThemeStore）(depends_on: task-01)
- [x] task-10: themes.test.ts 扩展 + 存量测试回归 (depends_on: task-01,task-02,task-03,task-04,task-05,task-06,task-07,task-08,task-09)
- [x] task-11: 三主题浏览器实测与浅色回归目测 (depends_on: task-10)
