---
author: qinyi
created_at: 2026-08-23 23:25:00
---
# 模块影响分析（Module Impact）— 前端暗色主题与三主题切换

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| frontend_app | 修改 | 主题系统核心：styles/themes.ts（+dark 取值）、app/globals.css（dark 变量块+三处硬编码修正）、tailwind.config.ts（slate 变量化）、stores/theme.ts（merge 跟随系统）、app/layout.tsx（防闪烁脚本）、components/antd-providers.tsx（darkAlgorithm）、components/theme-toggle.tsx（三选一下拉） |
| frontend_app | 修改 | 全站 bg-white→bg-card 清理 23 文件（agent-log 系列/runtimes/team-progress/daemon 卡片/login/top-bar/error 等，见 design §5.3 清单） |
| frontend_app | 修改 | 图表主题感知：lib/ppm/aggregations.ts（颜色入参化）+ components/charts/ 三组件（订阅 useThemeStore） |
| frontend_app | 修改 | 测试：styles/themes.test.ts 扩展（dark 完整性/翻转对称/浅色零回归）；stores/theme.test.ts 脏值用例口径更新（dark 转合法值） |
| docs（scan 规范） | 依赖变更 | .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md §0.5 主题系统需由「双主题」更新为「三主题（含暗色）」；模块文档 frontend_app.md 如登记了主题契约需同步——归 archive 阶段收口 |

## 未匹配文件

无（文件变更清单全部命中 frontend_app 模块归属的 frontend/ 源码树与 docs 规范文件；.sillyspec/changes/ 下的规范产物本身不计入模块映射）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/frontend_app.md` | 更新前端应用模块卡（契约摘要新增「主题系统契约」段：三主题/单一源/跟随系统/toggle+darkAlgorithm+slate 变量化） | done |
| `_module-map.yaml` | 无变化（未增删模块，仅既有模块内文件修改） | skipped |
