---
author: WhaleFall
created_at: 2026-10-08 11:10:30
change: 2026-09-23-md-card-render
---

# UI 渲染对照证据（Visual Evidence）

> 执行环境无浏览器截图工具，本证据为「实现类名 × 原型 panel-c × 测试断言」三方对照结论型证据（验收基准：prototype-card-render.html panel-c；每项附测试锚点）。

## 对照表（原型 panel-c → 实现 → 测试锚点）

| 原型 panel-c 视觉要素 | 实现落点（entry-card-list.tsx / card-markdown.tsx） | 测试断言锚点 |
|---|---|---|
| 卡片左侧 3px 品牌色条 | `border-l-[3px] border-l-brand-600`（manual 卡 + SingleCard 容器） | entry-card-list.test「卡片头视觉重构」`className).toContain("border-l-brand-600")` |
| 卡片头 brand-50 底色带 + 分隔线 | 头部区 `border-b border-border/60 bg-brand-50 px-2.5 py-1.5` | 同上 `querySelector("div.bg-brand-50")` 非空 |
| 小节标题 brand-700 加粗 | `h4 … font-semibold text-brand-700` | 同上 `h4 className 含 text-brand-700` |
| 🔗 锚点复制图标（头部右侧） | `AnchorCopyButton`（clipboard 复制 + message 提示） | 「卡片头锚点复制」用例：writeText 断言 manual=`文件#slug`、SingleCard=裸文件名；title 属性断言 |
| ✍ 作者 · 日期 收录（元信息条） | `FrontmatterMetaLine`（parseFrontmatterMeta 顶层解析一次传各卡） | 「frontmatter 元信息条渲染」：3 卡各一条 `✍ qinyi · 2026-06-23 收录`；无 frontmatter 降级隐藏 |
| 表头品牌色（brand-50 底 + brand-700 字） | card-markdown.tsx `CARD_MD_CLASS`：`[&_.wmde-markdown_th]:!bg-brand-50 [&_.wmde-markdown_th]:!text-brand-700` | card-markdown.test「容器携带卡片适配类」断言两个类名 |
| 宽表格横向滚动（不撑破窄卡） | 容器 `overflow-x-auto` + 表格 `w-max` | card-markdown.test 断言 `overflow-x-auto`；页面测试「卡片态 md-preview>0」证明渲染链通 |
| 正文 markdown 渲染（表格/列表/加粗/行内代码） | 4 处正文经 `CardMarkdown`（MarkdownText compact + 统一 sanitize） | scan-docs-page.test 卡片态 `getAllByTestId("md-preview").length > 0`（真实 @uiw 管线经页面测试 mock 下层验证）；CardMarkdown 委托断言 |
| 🔥 热度徽标收敛（仅卡片头一处） | 卡片头 UseBadge 保留；原型 meta 行重复的 🔥 不实现（CC-03 口径） | 既有徽标断言原样通过（getAllByTestId("entry-use-badge") 计数不变） |

## 双主题说明

全部色值经 brand-* 语义阶类名（随 `html data-theme` 换肤，blue / ai-native 双主题自动适配），实现零硬编码 hex（eslint + 代码审查核验）；原型文件自带 light / ai-native 切换可对照参考。

## DecisionCard 说明（非目标边界）

原型未展示 DecisionCard 重构——实现保持其现有卡片结构（状态 pill / 理由高亮块 / 取代链条），仅 reason / body 接入 CardMarkdown 渲染（D-003 收敛口径），测试锚点：既有 DecisionCard 断言（理由文本可见、取代链、状态 pill）原样通过。
