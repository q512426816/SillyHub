---
id: task-02
title: 'Wire CardMarkdown into entry-card-list with card header rework'
title_zh: 'entry-card-list 渲染接入与卡片头视觉重构（色条/头底/锚点复制/元信息条）与测试回归'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-08 10:24:03
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/components/knowledge/entry-card-list.tsx
  - frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx
target_files:
  - frontend/src/components/knowledge/entry-card-list.tsx
  - frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx
expects_from:
  task-01:
    - contract: CardMarkdownProps
      needs: [content, className]
related_tests:
  - path: frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
    reason: 卡片头 DOM 重构与正文改 mock 渲染后，正文纯文本断言（L303-304）与 DecisionCard 理由断言（L359）需同步调整
  - path: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx
    reason: 卡片正文经 md-preview 渲染后，「卡片态无 md-preview」旧断言前提失效（执行期实测发现，plan 期漏声明），视图切换断言等强度改写
goal: >
  把 scan-docs/knowledge 卡片模式的 4 处纯文本正文接入 task-01 的 CardMarkdown，并按原型 panel-c 重构 manual 与 SingleCard 卡片头
  （品牌色条、元信息条、锚点复制），保持锚点跳转与热度徽标零回归。
implementation:
  - 4 处正文替换为 CardMarkdown——manual 小节卡正文（frontend/src/components/knowledge/entry-card-list.tsx:629-633）、SingleCard 正文（712-716）、DecisionCard 理由块与正文段（477-487）；DecisionCard 保持现有卡片结构不动
  - manual 卡与 SingleCard 卡片头重构——卡片容器加 3px brand-600 左色条、头部区 brand-50 底加分隔线、小节标题 brand-700 加粗、右侧锚点复制图标（clipboard 复制 + antd message 提示，交互对齐既有全文复制先例 entry-card-list.tsx:525-535；SingleCard 复制串为裸文件名）
  - data-entry-anchor 属性原样保留在新卡片根容器（两页 querySelector 加 CSS.escape 锚点跳转依赖它，见 knowledge/page.tsx:380 与 scan-docs/page.tsx:348）
  - 新增 parseFrontmatterMeta 辅助函数（解析 frontmatter 块提取 author 与 created_at），stripFrontmatter 签名与其 3 处调用点不动；EntryCardList 顶层解析一次向各卡传递，卡片头下方渲染一行作者与收录时间，字段缺失整条隐藏
  - 热度徽标收敛——卡片头内仅保留一处（列表头文件级徽标不动）
  - 更新 entry-card-list.test.tsx——渲染类断言适配新 DOM 与 mock 渲染；新增元信息条显示与缺失降级两分支、data-entry-anchor 保留、锚点复制点击用例；纯函数单测（slugifyAnchor 与 parseEntrySections 等）不动
acceptance:
  - 4 处正文经 CardMarkdown 渲染（表格、列表、加粗、行内代码生效）且全文渲染无折叠（D-002）
  - manual 卡与 SingleCard 有品牌色条 + brand-50 头底 + brand-700 标题 + 锚点复制图标；热度徽标仅卡片头一处；视觉对照 .sillyspec/changes/2026-09-23-md-card-render/prototype-card-render.html 的 panel-c
  - data-entry-anchor 保留在卡片根容器，既有锚点跳转测试与断言通过
  - frontmatter 元信息条显示作者与收录时间；无 frontmatter 或缺字段的文件整条隐藏不报错；stripFrontmatter 函数签名不变
  - entry-card-list.test.tsx 与 card-markdown.test.tsx 全绿
verify:
  - cd frontend && pnpm exec vitest run src/components/knowledge
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec eslint src/components/knowledge/card-markdown.tsx src/components/knowledge/entry-card-list.tsx src/components/knowledge/__tests__/card-markdown.test.tsx src/components/knowledge/__tests__/entry-card-list.test.tsx
  - 手动验收——两页卡片模式对照原型 panel-c；INDEX 路由行跳转锚点定位；顶栏切 blue 与 ai-native 双主题检查色条与表头色
constraints:
  - 不改两页面 page.tsx（EntryCardList 对外 props 协议不变）
  - 不改后端；不做 INDEX 路由行渲染；不做 DecisionCard 头部重构（仅 reason 与 body 接渲染）
  - 不做折叠展开与卡片内二级滚动交互（D-002）
  - 色值只用 brand 语义阶，禁硬编码 hex；UI 文案中文
  - 不向 .sillyspec/knowledge/conventions.md 写任何内容（D-001 仅演示样本）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->