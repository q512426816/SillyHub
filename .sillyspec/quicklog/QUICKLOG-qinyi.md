
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

## ql-20260824-015-7d95 | 2026-08-24 11:37:33 | 暗色会话 MD 表格白底白字复发根治
状态：已完成
关联变更：2026-08-23-frontend-dark-theme
文件：
- frontend/src/app/globals.css（markdown 库表格覆盖块重写为 .markdown-text 高特异度元素级规则）
需求：暗色会话 MD 表格白底白字复发根治
根因：库的偶数行斑马纹规则 tr:nth-child(2n) 与此前修复同特异度且库 CSS 后加载靠源序取胜，并行会话的变量重定义方案也与库 :root 同特异度同样输在加载顺序，两路修复在系统浅色用户上双双失效
方案：改元素级覆盖并经 MarkdownText 恒定包装类 .markdown-text 把特异度抬到 0,4,3 与加载顺序无关，奇数行 偶数行 表头三类行底全透明随容器，边框走 var(--color-border)；修正 dark 块内变量覆盖注释标明其仅为系统暗色补充
结果：三行表忠实级联测试（库 CSS 后注入最坏顺序+系统浅色+手动 dark）奇偶表头行底全透明边框 zinc-700 全 PASS；浅色两主题零覆盖
