
## ql-20260824-014-f1bd | 2026-08-24 11:19:47 | 暗色去紫改青配色定案落地
状态：已完成
关联变更：2026-08-23-frontend-dark-theme
文件：
- frontend/src/styles/themes.ts（darkTheme 去紫改青+中性底）
- frontend/src/app/globals.css（dark 块整体换 zinc 底与 cyan 阶）
- frontend/src/styles/themes.test.ts（dark 断言改 cyan zinc 口径）
需求：暗色去紫改青配色定案落地
根因：用户两轮反馈紫在暗色下刺眼且可读性差，经原型对比定案去掉紫色
方案：dark 换 zinc-900 中性黑底（slate 阶换 zinc 翻转去蓝调振动），primary 换 cyan-600 hover cyan-500，brand 阶换 cyan 阶翻转（text-brand-600=cyan-400 对比 8:1），themes.ts 与 globals.css 成对同步
结果：tsc 零错误；主题相关 3 测试文件 35/35 绿；本地容器重建后实测 bg/primary/brand-600/slate-500 新值全部生效；两份选型原型归档变更目录
