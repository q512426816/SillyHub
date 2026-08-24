
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

## ql-20260824-017-a6ef | 2026-08-24 13:22:21 | 会话面板技能装载内容不再误入对话正文
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-log-assembler.ts（classifySessionLog 新增 kind=skill 分类规则 + attachSkillInjection 挂载辅助函数）
- frontend/src/components/daemon/__tests__/session-log-assembler.test.ts（第 10 组技能装载 6 用例）
需求：会话面板技能装载内容不再误入对话正文，归入过程（进度）视图
根因：Claude Code 装载技能时 SKILL.md 全文以 assistant 文本块注入（[ASSISTANT] Base directory for this skill: 前缀，DB run d01bd6d2 实证），前端 classifySessionLog 把它归 reply，整份技能说明直接刷进对话气泡
方案：session-log-assembler.ts 分类器识别该前缀归新 kind=skill（仅 [ASSISTANT] 前缀形态，裸文本不误吞）；装配器 attachSkillInjection 把全文追加到同桶内最近 Skill 工具段 result（进度视图工具卡展开可见，多技能各挂最近不串段，子代理桶路由照常），无 Skill 工具段时退化文本段不丢内容
结果：新增 6 测试用例 TDD 先红后绿；daemon+sessions 28 文件 403 测试全绿；tsc 0 错；eslint 仅存量 warning（520/577 行未改动代码）
审计：📝 文档欠账（D-8）：2 个源码文件改动未同步任何模块文档（涉及模块：frontend）（已核对修正：模块文档 frontend.md 变更索引已同步本条，CLI 审计时该文件属 baseline 脏文件未计入本轮）
