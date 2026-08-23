---
author: qinyi
created_at: 2026-08-23
---
# 提案书（Proposal）

## 动机

前端现有 blue（明亮蓝）/ ai-native（AI 紫，默认）两套浅色主题，夜间使用时浅色底刺眼、长时间阅读不适。需要一套暗色主题与便捷切换，让晚上使用更舒适。现有主题系统（2026-08-20-frontend-ai-native-style 立）本就按多主题预留架构（themes.ts 单一源 + html data-theme 换肤 + antd token 查表），本变更是其自然扩展，不引入第二套换肤机制。

## 关键问题

1. **无暗色可用**：两套主题均为浅色（bg #f8fafc / #FAF5FF），夜间长时间盯屏不适；tailwind 虽预留 `darkMode:["class"]` 但从未启用。
2. **中性色不随主题走**：tailwind 的 slate 阶写死 hex、65 处 `bg-white` 硬编码，即使加暗色变量，全站大量界面仍会残留浅色——暗色必须全站生效才有意义。
3. **antd 与图表无暗色通道**：antd 组件灰阶依赖 algorithm（当前固定默认浅色算法）；3 个 ECharts 图表文字色编译期写死，暗色底上不可读。

## 变更范围

- `themes.ts` 新增第三套 `dark` 主题取值（AI 紫暗色版，Tailwind 默认阶对称翻转），ThemeName 扩 `'dark'`
- `globals.css` 新增 `[data-theme="dark"]` 变量块 + 三处既有硬编码修正（斑马纹混白/spinner 边框/--muted-fg）+ 清理遗留 .dark 死块
- `tailwind.config.ts` slate 阶变量化（照 brand 现成模式）
- store 与 layout 防闪烁脚本：合法值扩 `dark`，无记录时跟随系统 `prefers-color-scheme`
- `antd-providers` 按主题切 darkAlgorithm；`theme-toggle` 升级三选一下拉
- 23 个文件 bg-white→bg-card 清理；3 图表 + aggregations.ts 主题感知改造
- `themes.test.ts` 扩展（取值完整性/翻转对称性/浅色零回归断言）

## 不在范围内（显式清单）

- 不做系统明暗实时监听（运行中切系统需刷新才跟随）
- 不做 blue 主题的暗色版（明暗×品牌四象限不做，暗色仅 AI 紫一族）
- 不改后端 / daemon / 数据库 / 对外接口
- 不重设计页面布局，只做配色维度扩展

## 成功标准（可验证）

- 浅色两主题观感零变化（slate 取值逐值相等断言 + bg-card 浅色=纯白 + 浏览器目测回归）
- dark 主题下全站无残留纯白大色块，antd 表格/表单/弹窗/菜单协调变暗，图表文字可读
- 三主题可切换、刷新不闪烁、刷新后保持记忆；系统暗色 + 无手动记录时首帧即暗色（不闪白）
- 前端测试全绿（含新增 dark 用例与存量回归）
