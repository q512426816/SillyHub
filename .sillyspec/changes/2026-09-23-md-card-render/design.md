---
author: WhaleFall
created_at: 2026-10-08 10:08:36
generated_by: sillyspec-design-init
scale: large  # 4 文件（2 新增 2 修改）+ 用户指定完整流程；单模块但走 plan 拆 Wave
---

# 设计文档（Design）— 2026-09-23-md-card-render

## 背景

`/workspaces/[id]/scan-docs` 与 `/workspaces/[id]/knowledge` 两页的「卡片」视图模式中，卡片正文按 markdown 源文本原样显示：`#`、`**`、`|表格|`、行内反引号等标记全部裸露，表格不渲染，可读性差。

根因（调研结论，行号经 Grill CC-01 刷新至 2026-10-08 源码态）：两页共用组件 `frontend/src/components/knowledge/entry-card-list.tsx` 内 4 处正文输出用的是 `whitespace-pre-wrap` 纯文本 `<p>` 节点——manual 小节卡正文（`entry-card-list.tsx:629-633`）、SingleCard 正文（`entry-card-list.tsx:712-716`）、DecisionCard 理由块与正文段（`entry-card-list.tsx:477-487`）。

项目内 md 渲染能力完整且成熟：`frontend/src/components/ui/markdown-text.tsx`（`@uiw/react-markdown-preview` + rehype-sanitize 统一安全过滤 + compact/reading 双档，全仓 16 处复用，两页「原文」tab 即其渲染效果）——卡片模式未接入。后端 `GET /scan-docs/{doc_id}` 与 `GET /knowledge/{filename}` 均已返回全文 content，后端零改动。

## 设计目标

1. 卡片正文 md 正常渲染：标题/加粗/列表/行内代码/表格/代码块/引用全部生效，继承项目统一 sanitize 安全红线。
2. 卡片视觉重构（用户经原型确认的方案 C，基准 `prototype-card-render.html` panel-c）：卡片头品牌色条 + brand-50 底 + 标题 brand-700、frontmatter 元信息条（作者/收录时间）、锚点复制图标、表头品牌色。
3. 渲染全文不折叠、不加卡片内二级滚动（D-002）。
4. 既有交互零回归：锚点跳转（data-entry-anchor + scrollIntoView）、条目热度 🔥 徽标、双主题（blue / ai-native）换肤。

## 非目标

- 两页「原文」tab（已正常渲染，不动）。
- 后端任何 API / 表结构 / 解析逻辑（零后端改动）。
- INDEX 路由行（导航元素，不做 md 渲染）。
- DecisionCard（决策卡）头部视觉重构——保持其现有专属卡片结构（状态 pill / 理由高亮块 / 取代链条），仅正文与理由块接入 CardMarkdown 渲染（D-003 收敛口径：原型未展示其重构，以原型为基准）。
- 移动端 `m/` 页面。
- `.sillyspec/knowledge/conventions.md` 约定沉淀——仅作原型演示样本，不新增条目（D-001）。
- 折叠/展开、卡片内滚动等新交互（D-002 明确不做）。

## 拆分判断

单一功能改造（一个共用组件的渲染升级），文件集中在 `frontend/src/components/knowledge/` 一处，无跨模块依赖、无 schema/API 变更、无多角色视图——不拆分；非「模板 × 数据」型任务——不走批量模式。

## 总体方案

### Phase 1：渲染层——CardMarkdown 薄壳（新建）

新建 `frontend/src/components/knowledge/card-markdown.tsx`（约 30 行）：

```tsx
import { MarkdownText } from "@/components/ui/markdown-text";
import { cn } from "@/lib/utils";

export interface CardMarkdownProps {
  content: string;
  className?: string;
}

/** 卡片场景 md 渲染薄壳：MarkdownText compact + 表格横向滚动 + 字号对齐 + 表头品牌色 */
export function CardMarkdown({ content, className }: CardMarkdownProps) {
  if (!content) return null;
  return (
    <div className={cn(CARD_MD_CLASS, className)}>
      <MarkdownText content={content} size="compact" />
    </div>
  );
}
```

`CARD_MD_CLASS` 通过 Tailwind 任意值选择器对 `@uiw` 产物做卡片场景适配（对齐 `markdown-text.tsx` COMPACT_CLASS 的既有写法）：

- 容器 `overflow-x-auto`——宽表格在窄卡片内横向滚动不撑破（原型 A/B 对比所示的差异点）；
- 表格字号对齐 `text-[11.5px]`（与卡片元信息行一致）；
- 表头品牌色：`[&_.wmde-markdown_th]:!bg-brand-50 [&_.wmde-markdown_th]:!text-brand-700`（brand-* 语义阶随 `html data-theme` 换肤，禁硬编码 hex——FRONTEND_PAGE_STYLE §0.5 铁律）；
- 正文行距对齐卡片现有 `leading-relaxed`。

安全：MarkdownText 内部固定挂 `markdownRehypePlugins`（rehype-sanitize，`markdown-text.tsx:90-92` 单例），薄壳不透传 rehypePlugins、不新开渲染路径——卡片渲染扫描文档/知识库等不可信内容仍走统一 sanitize。

### Phase 2：entry-card-list.tsx 渲染接入 + 视觉重构

1. **4 处正文替换**：manual 小节卡 `{s.body}`、SingleCard `{body}`、DecisionCard `{entry.reason}` / `{entry.body}` 的纯文本 `<p>` 换 `<CardMarkdown content={...} />`。
2. **卡片头重构**（manual 小节卡 + SingleCard）：
   - 卡片容器加左侧品牌色条：`border-l-[3px] border-brand-600`；
   - 头部区 `bg-brand-50` 底 + 底部分隔线，小节标题 `text-brand-700 font-semibold`；
   - 🔥 条目热度徽标收敛口径（Grill CC-03）：**卡片头内不重复**（原型 panel-c 卡片头与元信息条两处收敛为卡片头一处）；**列表头的文件级 🔥 徽标不动**（列表头元信息行现状保持）；
   - `data-entry-anchor` 属性**原样保留在新卡片容器上**（锚点跳转依赖 `document.querySelector('[data-entry-anchor=...]')?.scrollIntoView()`，两页面 page.tsx 的 jumpToDoc/selectEntry 不动）。
3. **frontmatter 元信息条**：`stripFrontmatter`（`entry-card-list.tsx:44-51`）现有 3 处调用点（L117 / L575-576 / L639,655），**签名保持不动**；新增 `parseFrontmatterMeta` 辅助函数（解析 `---` 块提取 `author` / `created_at`，Grill CC-07 收窄方案），EntryCardList 顶层解析一次向 N 张卡传递。卡片头下方一行小字「✍ {author} · {created_at}」；**文件无 frontmatter 或字段缺失时整条隐藏**（不渲染空行，不抛错）。
4. **锚点复制图标**：卡片头右侧 🔗（仅图标按钮），点击复制锚点定位串（`navigator.clipboard` + antd `message` 成功提示），交互模式对齐 DecisionCard 既有「全文 ↗」复制路径先例（`entry-card-list.tsx:525-535`）。SingleCard 现状无 data-entry-anchor（Grill CC-02），其 🔗 复制串取值定为**裸文件名**（与锚点跳转的 querySelector 语义不冲突，复制结果可直接用于定位文件）。
5. **DecisionCard 仅接渲染**：reason 块（保留 brand-50 高亮底）与 body 换 CardMarkdown，卡片结构不动。

### Phase 3：测试与验收

- 新增 `card-markdown.test.tsx`：md 元素渲染（表格 th/td、列表、加粗、行内 code）、空内容返回 null、className 透传；
- 更新 `entry-card-list.test.tsx`：卡片头新结构断言（品牌色条类名、元信息条显示/降级两分支）、锚点属性保留断言；
- jsdom 已知坑规避：MarkdownText 是 `next/dynamic` + `ssr:false`，jsdom 同步 render 得 null（`.sillyspec/knowledge/testing-gotchas.md` 已收录）——测试沿用项目既有 mock 方案（经 Grill CC-11 核实的先例：`frontend/src/components/daemon/__tests__/team-task-block.test.tsx:42-50` 的 `vi.mock("next/dynamic")` Fake 占位方案，引坑档案 ql-20260825-004）；
- 手动验收：两页卡片模式对照原型 panel-c；双主题切换；INDEX 路由行跳转卡片锚点定位回归。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:frontend/src/components/knowledge/card-markdown.tsx | CardMarkdown 薄壳组件（包 MarkdownText compact + 表格横向滚动 + 字号对齐 + 表头品牌色），导出 CardMarkdownProps |
| 新增 | NEW:frontend/src/components/knowledge/__tests__/card-markdown.test.tsx | 新组件测试（渲染元素/空内容/className 透传；jsdom dynamic mock 沿用既有方案） |
| 修改 | frontend/src/components/knowledge/entry-card-list.tsx | ① 4 处纯文本正文换 CardMarkdown；② manual 卡与 SingleCard 卡片头重构（品牌色条 + brand-50 头 + 锚点复制图标 + data-entry-anchor 保留）；③ stripFrontmatter 改为解析并提取 author/created_at 供元信息条（缺失降级隐藏）；④ 🔥 徽标收敛卡片头一处 |
| 修改 | frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx | 卡片头新结构断言 + 元信息条显示/降级分支 + 锚点属性保留回归 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx | 执行期连带（Step 7 实测发现）：卡片正文经 md-preview 渲染后视图切换断言按新行为等强度改写 |

纯前端组件内部改造，无对外字段/接口/DTO/事件 payload/配置键变动，无数据流标注项。

## 接口定义

本变更接口面：0 端点（无接口变更）。

组件契约（内部）：

```ts
// frontend/src/components/knowledge/card-markdown.tsx
export interface CardMarkdownProps {
  /** markdown 文本（卡片正文片段） */
  content: string;
  /** 外层容器 className（透传 cn 合并） */
  className?: string;
}
export function CardMarkdown(props: CardMarkdownProps): JSX.Element | null;
```

## 生命周期契约表

不涉及生命周期契约（纯前端展示组件改造，无 session/lease/agent_run/daemon/state transition/claim/heartbeat 语义）。

## 数据模型

无 schema 变更（后端零改动，不涉及任何表结构/DTO）。

## 兼容策略（brownfield 必填）

- **回退路径**：纯前端静态渲染改造，回退 = git revert 该组件目录提交，无数据迁移/状态残留。
- **降级行为**：无 frontmatter / frontmatter 缺 author 或 created_at 的文件，元信息条整体隐藏，卡片其余部分正常渲染；空正文（`s.body` / `body` 为空串）维持现状不渲染该段（CardMarkdown 空内容返回 null，与现状 `{s.body ? ... : null}` 等价）。
- **不改变的**：全部后端 API 与表结构、两页「原文」tab、INDEX 路由行跳转逻辑、页面级挂载与 props 协议（EntryCardList 对外 props 不变，scan-docs/knowledge 两 page.tsx 零改动）。
- **既有行为对齐**：SingleCard 整文件单卡全文渲染（D-002），与改造前「纯文本全文展示」行为粒度一致，仅展示形态从源文本变为渲染结果。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 卡片 DOM 结构重构破坏锚点定位（data-entry-anchor + scrollIntoView 跳转失效） | P1 | 重构时 data-entry-anchor 原样保留在新卡片根容器；entry-card-list.test.tsx 补锚点属性保留断言；验收手动回归两页 INDEX 路由行跳转 |
| R-02 | frontmatter 缺失/畸形（无 --- 块、字段空值、非标准格式）致元信息条渲染异常 | P1 | 解析失败/字段缺失时整条隐藏（降级不渲染），不抛错；测试覆盖显示/降级两分支 |
| R-03 | 双主题下品牌色漂移（硬编码 hex 或用 blue-* 阶表品牌用途） | P1 | 色值全部走 brand-* 语义阶（border-brand-600 / bg-brand-50 / text-brand-700），代码评审 grep 核对无硬编码 hex；双主题手动验收 |
| R-04 | jsdom 下 MarkdownText（next/dynamic ssr:false）渲染 null，测试假失败 | P1 | 沿用已核实先例 team-task-block.test.tsx:42-50 的 vi.mock("next/dynamic") Fake 占位方案（Grill CC-11），不新造 mock |
| R-05 | 卡片列表多卡时渲染性能（每卡一个 MarkdownPreview 实例） | P2 | MarkdownText 已 memo（markdown-text.tsx:190-196），卡片内容静态不触发重解析；现状「原文」tab 同规模单实例全量渲染无性能问题，卡片拆分后单实例更小 |
| R-06 | 无长驻进程/外部资源，生命周期面不适用 | — | 显式留痕：纯渲染组件，无进程/句柄/锁 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 非目标节（conventions.md 不沉淀约定）；原型 prototype-card-render.html（演示数据源） | 已覆盖 |
| D-002@v1 | 设计目标 3；总体方案 Phase 2（全文渲染，无折叠/卡片内滚动）；兼容策略（SingleCard 全文对齐） | 已覆盖 |
| D-003@v1 | 总体方案全部三 Phase（CardMarkdown 薄壳 + 视觉重构）；非目标节（DecisionCard 不做头部重构）；R-01/R-02/R-03 即其故障面落地 | 已覆盖 |

无未解决决策；无剩余风险（R-01～R-05 均有应对策略）。

多裁定组合推演：D-002（全文渲染）× D-003（视觉重构加头部/元信息条）互不约束——元信息条与色条只增加头部高度，不改变正文渲染策略；无组合死锁面。显式记：无组合约束。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale 待 Step 8 落值）
- [x] 引用所有当前版本 D-xxx@vN（D-001/D-002/D-003 全部出现在决策追踪表）
- [x] 生命周期关键词核验：正文含「生命周期契约表」豁免短语（紧邻否定式），无 session/lease 等契约语义
- [x] UI 原型分级核对：组件级变化（建议生成档）——已生成 prototype-card-render.html（A/B/C 三档对比，panel-c 为视觉基准，用户已确认）
- [x] 不确定的问题标注「⚠️ 自审存疑」——无存疑项（方案经用户原型确认 + 三处既有代码先例支撑）
