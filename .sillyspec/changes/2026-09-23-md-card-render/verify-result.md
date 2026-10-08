---
author: WhaleFall
created_at: 2026-10-08 11:14:30
change: 2026-09-23-md-card-render
---

# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

## 结论 [层：人工判断]

结论枚举：PASS WITH NOTES
理由：两任务全部验收通过（矩阵全 covered、CLI 亲测 0 退出码、143/143 相关面测试绿、tsc/eslint 0 error、决策 D-001~003 闭环）；NOTES 为两条已披露的实现偏差（字号统一、连带测试改写）与一条部署级移交项（视觉手动验收）。

## 移交项（结构化） [层：人工判断——CLI 清单核验]

| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| manual-acceptance | FR-02/FR-04 视觉与交互手动验收：两页卡片模式对照原型 panel-c（浏览器实测色条/头底/锚点复制 toast/双主题换肤/INDEX 路由行锚点跳转）——jsdom 无法覆盖真实视觉与主题变量 | 部署后（或 dev server）打开 /workspaces/<id>/scan-docs 与 /knowledge，选 conventions.md 对照 `.sillyspec/changes/2026-09-23-md-card-render/prototype-card-render.html` panel-c；切 blue/ai-native 主题各看一遍；点 INDEX 路由行验证卡片滚动定位 |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]

- 无（execute 阶段无 cannot_verify 任务；verify-required-evidence.json 不存在）

## 集成验证回执 [层：自述声明——CLI 一致性校验]

无（非 integration/deployment-critical 变更——纯前端组件渲染改造，无跨进程/启动入口/状态机触碰；CLI 动态测试子集亲测即集成面证据）
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

## 任务完成度 [层：人工判断]

- task-01：✅ 已完成——`frontend/src/components/knowledge/card-markdown.tsx`（薄壳三类适配 + sanitize 继承）+ `frontend/src/components/knowledge/__tests__/card-markdown.test.tsx`（4 用例全绿）；提交 a3a40b2e
- task-02：✅ 已完成——`frontend/src/components/knowledge/entry-card-list.tsx`（4 处正文接入 + manual/SingleCard 卡片头重构 + parseFrontmatterMeta 元信息条降级 + data-entry-anchor 保留）+ 测试回归与 6 新用例（`frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx`）+ 连带 `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx` 断言改写；提交 4d56cb08 / 9d96984a
- 完成度 2/2（100%）；worktree apply SAFE 合入主仓（+354/-32，5 文件全计划内）

## 设计一致性 [层：人工判断]

一致（两条已披露偏差，均不违背设计语义）：
1. DecisionCard reason/body 字号由原 11.5px 统一为 MarkdownText compact 档 text-xs(12px)——薄壳集中适配的固有统一效果，落在设计「字号对齐卡片」语义内；
2. 锚点复制 toast 经 `App.useApp()` 注入（生产由全局 AntdProviders 提供上下文），测试 renderList 包 `<AntdApp>` 对齐——交互对齐「全文 ↗」先例 + 设计的 message 提示要求。
其余：文件清单 5 文件与 design §6 逐行一致（含执行期补登的连带测试行）；EntryCardList props 协议/stripFrontmatter 签名/纯函数导出零变化；非目标边界（原文 tab/后端/INDEX 路由行/DecisionCard 头部/移动端/conventions.md）零触碰（git diff 实证）。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ glob 项手动展开复核：frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx（方括号目录 CLI glob 未展开）——人工核对该文件为测试改写，无未实现标记 ✅

#### 探针 2：设计关键词覆盖
（agent 执行）design 能力关键词逐个核验实现落点：
- 渲染/markdown → `frontend/src/components/knowledge/card-markdown.tsx:41`（MarkdownText compact 委托）
- 表格横向滚动/overflow → `card-markdown.tsx:33`（overflow-x-auto + w-max）
- 表头品牌色/brand-50/brand-700 → `card-markdown.tsx:34`
- 锚点复制/clipboard → `entry-card-list.tsx` AnchorCopyButton（copyText + message.success）
- frontmatter/author/created_at/元信息 → `entry-card-list.tsx` parseFrontmatterMeta + FrontmatterMetaLine
- 降级/隐藏 → FrontmatterMetaLine 缺任一字段 return null
- sanitize/rehype → CardMarkdown 不透传 rehypePlugins（继承 markdown-text.tsx:90-92 单例）
结论：无 ⚠️ 未实现关键词。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（frontend/src/components/knowledge、frontend/src/components/knowledge/__tests__）找到 9 个测试文件（frontend/src/components/knowledge/__tests__/card-markdown.test.tsx、frontend/src/components/knowledge/__tests__/distill-history-dialog.test.tsx、frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx、frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx、frontend/src/components/knowledge/__tests__/entry-editor.test.tsx …）
- ✅ task-02: 模块目录（frontend/src/components/knowledge、frontend/src/components/knowledge/__tests__、frontend/src/app/(dashboard)/workspaces/[id]/__tests__）找到 13 个测试文件（frontend/src/components/knowledge/__tests__/card-markdown.test.tsx、frontend/src/components/knowledge/__tests__/distill-history-dialog.test.tsx、frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx、frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx、frontend/src/components/knowledge/__tests__/entry-editor.test.tsx …）
- 集成盲区标注（agent）：本变更为组件内部渲染改造，非路由/layout/跨进程装配——页面级集成路径（视图切换/文档树选中文档）已由 `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx`（卡片↔原文切换含真实 @uiw 管线）覆盖；真实视觉/主题/锚点滚动定位留移交项（manual-acceptance）。
- 断言有效性抽查（agent，抽 3 核心）：① `card-markdown.test.tsx` 委托断言——真实输出（stub 收到 content 原文与 data-size=compact）+ 结构性反断言（组件自身不产 table 节点），非空断言 ✅；② `entry-card-list.test.tsx` 元信息条——正例（3 卡各一条 + 文本精确匹配）+ 反例（无 frontmatter 整条隐藏）双分支 ✅；③ 锚点复制——真实副作用断言（writeText 调用参数=文件#slug 与裸文件名两种口径）✅。均走公开渲染行为，不测实现细节。

#### 探针 7：验收×测试覆盖矩阵
**task-01**
| acceptance 条目 | 归属测试文件 | 判定 | 证据 |
|---|---|---|---|
| card-markdown.tsx 导出 CardMarkdown 与 CardMarkdownProps，内部复用 MarkdownText 且不透传 rehypePlugins（继承统一 sanitize） | `frontend/src/components/knowledge/__tests__/card-markdown.test.tsx` | covered | `frontend/src/components/knowledge/__tests__/card-markdown.test.tsx`「content 原文委托 MarkdownText 渲染」用例（stub 断言 data-size=compact + 转发原文；不透传 rehypePlugins 由组件实现与该 mock 结构共同锁定） |
| 表格在窄容器内横向滚动（容器 overflow-x-auto），表头 brand-50 底 brand-700 字 | `frontend/src/components/knowledge/__tests__/card-markdown.test.tsx` | covered | `frontend/src/components/knowledge/__tests__/card-markdown.test.tsx`「容器携带卡片适配类」用例（断言 overflow-x-auto / th bg-brand-50 / th text-brand-700 类名） |
| 空 content 渲染为 null；className 经 cn 合并透传 | `frontend/src/components/knowledge/__tests__/card-markdown.test.tsx` | covered | `frontend/src/components/knowledge/__tests__/card-markdown.test.tsx`「空 content 返回 null」「className 透传经 cn 合并」两用例 |
| card-markdown.test.tsx 用例全绿（含 dynamic mock） | `frontend/src/components/knowledge/__tests__/card-markdown.test.tsx` | covered | CLI verify 实测 `module[]+deps(jsx3)` 退出码 0（16.1s / 7.3s 两轮）；4/4 用例 |

**task-02**
| acceptance 条目 | 归属测试文件 | 判定 | 证据 |
|---|---|---|---|
| 4 处正文经 CardMarkdown 渲染且全文渲染无折叠（D-002） | `frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx` | covered | entry-card-list.test 手册形态断言（正文文本经 md-stub 渲染命中）+ scan-docs-page.test「卡片态 getAllByTestId("md-preview").length > 0」（真实 @uiw 管线经页面 mock 下层验证渲染链通）；无折叠为结构性事实（CardMarkdown/卡片无折叠类与状态） |
| manual 卡与 SingleCard 卡片头（色条+头底+标题+锚点复制；徽标收敛；对照 panel-c） | `frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx` | covered | entry-card-list.test「手册形态渲染」卡片头断言块（border-l-brand-600 / div.bg-brand-50 / h4 text-brand-700 / anchor-copy-btn×3）+ 视觉对照结论型证据 `.sillyspec/changes/2026-09-23-md-card-render/visual-evidence.md` |
| data-entry-anchor 保留在卡片根容器，既有锚点跳转测试与断言通过 | `frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx` | covered | entry-card-list.test 断言 `toHaveAttribute("data-entry-anchor", "conventions.md#sillyspec-文档驱动开发流程")`；slugifyAnchor 纯函数双端契约用例原样通过 |
| frontmatter 元信息条（显示/降级/stripFrontmatter 签名不变） | `frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx` | covered | 「parseFrontmatterMeta（FR-03 纯函数）」4 分支用例 + 「frontmatter 元信息条渲染」正例（✍ qinyi · 2026-06-23 收录 ×3 卡）与反例（GENERATED 降级隐藏）；签名不变由既有 parseEntrySections 用例零改动通过佐证 |
| entry-card-list.test.tsx 与 card-markdown.test.tsx 全绿 | 两测试文件 | covered | CLI verify 实测退出码 0；相关面 13 文件 143/143（2026-10-08 11:01） |

#### 探针 4：决策追踪覆盖
（agent 执行）闭环矩阵：
- D-001@v1（conventions.md 仅演示样本）→ requirements.md 决策覆盖矩阵显式归属行 → 约束 task-02 constraints（不写 conventions.md）→ 证据：git diff 无该文件 ✅
- D-002@v1（全文渲染不折叠）→ FR-01 → task-01/02 acceptance → 证据：CardMarkdown 无折叠交互 + 测试断言全文渲染 ✅
- D-003@v1（方案 C）→ FR-01/02/03/04 → 两卡全部 acceptance → 证据：visual-evidence.md 对照表 + 矩阵全 covered ✅
无未闭环决策；无 P0/P1 unresolved。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 627 backend endpoints (live [scan-root 631] + artifact 0), 0 frontend calls [scope: change-diff (12 files @ scan-root)]
- 本变更 0 端点（纯前端），无 contract gap。

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- agent 终审：-32 行删除全部为被替换的纯文本 JSX（4 处正文 <p> 与旧卡片头结构），无静默删除逻辑。

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件）
#### 探针 10：预填注清零（error 门）
- ✅ 预填注清零（3 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml）
#### 探针 12：UI 视觉证据（分级门）
- ✅ UI 视觉证据在场（visual-evidence.md 非空——结论型对照证据：实现类名×原型 panel-c×测试锚点三方表）

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]

| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| 本变更接口面：0 端点（agent 声明） | non-testable | design.md §接口定义「0 端点（无接口变更）」 | 不涉及 | 纯前端组件内部改造，无对外端点/DTO/事件变更 |

## 测试结果 [层：确定性检查——CLI 实测对账]

- CLI verify 亲测（noAI 质量扫描）：动态子集 `module[]+deps(jsx3)` 退出码 0（两轮：16.1s / 7.3s，结果落盘 .sillyspec/.runtime/verify-runs/20261008030903/ 与 20261008030929/test-result.json）
- agent 相关面实测（2026-10-08 11:01）：`pnpm exec vitest run`（knowledge 9 文件 + markdown-text 2 文件 + 两页面测试）= 13 文件 143/143 通过
- 类型检查：`pnpm exec tsc --noEmit` 全仓退出码 0
- Lint：`pnpm exec eslint`（4 改动文件）0 error（4 个 warning 为既有类型签名参数，非本次引入）
- known_failures：无

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | （非目标约束，无 FR 承载——requirements 覆盖矩阵显式归属） | task-02 constraints | git diff 无 conventions.md 改动；原型以其内容为演示数据 | 闭环 |
| D-002@v1 | FR-01 | task-01, task-02 | CardMarkdown 全文渲染零折叠交互；entry-card-list.test 手册正文断言 | 闭环 |
| D-003@v1 | FR-01/02/03/04 | task-01, task-02 | visual-evidence.md 对照表 + 探针 7 矩阵全 covered + 测试 143/143 | 闭环 |

## 技术债务 [层：人工判断]

- TODO/FIXME/HACK：0（探针 1 零命中）
- 既有 warning（非本次引入）：entry-card-list.tsx L372/L461 类型签名参数 no-unused-vars warning ×4（历史代码，不在本变更修复面）
- 无新增债务。

## 变更风险等级 [层：人工判断]

unit-sufficient——纯前端组件渲染改造（无启动入口/跨进程/状态机/schema 触碰；design 生命周期契约豁免 + 接口面 0 端点）；单元+组件测试已充分锁定行为，视觉面留 manual-acceptance 移交。显式声明 = 无（design frontmatter 未声明 risk_level）。

## Runtime Evidence [层：人工判断]

不涉及（无运行时组件触碰——前端静态渲染组件；测试运行时证据见「测试结果」节的 CLI 亲测落盘路径）。

## 代码审查 [层：人工判断]

- 走查结论（execute Step 8 轻量复审 + verify 抽查）：无 P1/P2 问题。
- ① 编辑/更新链路：不涉及（无编辑/更新流——纯展示渲染）；② 非主分支流：structured 兜底/manual 兜底 SingleCard 路径均有测试覆盖；③ 守卫一致性：不涉及（无端点权限面）；④ 载荷字段契约：不涉及（探针 8 不适用）；⑤ 分页/并发/事务：不涉及（静态组件，MarkdownText 已 memo）。
- 总体评价：实现与设计一致、边界处理完善（frontmatter 降级/clipboard 静默兜底/空内容 null）、安全红线守住（统一 sanitize）、适配集中单处无散写。

## 独立复核（可选回流槽） [层：人工判断——复核后追加]

无（ceremony 档 S1 self；execute 阶段 review.json checklist 9 项 pass 为独立存档证据）。
