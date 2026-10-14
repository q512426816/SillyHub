---
id: task-02
title: '渲染层预览卡'
title_zh: '渲染层预览卡（TurnPreviewCard）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-14 10:18:30
priority: P0
depends_on: ['task-01']
blocks: [task-03]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1, D-002@v1, D-005@v1]
expects_from:
  - contract: task-01
    needs: [SessionTurnView.preview, mergePreviewIntoDisplayTurns]
allowed_paths:
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx
target_files:
  - frontend/src/components/daemon/turn-timeline.tsx
  - NEW:frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx
related_tests:
  - frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx
goal: >
  TurnRow 增加预览分支渲染 TurnPreviewCard（FR-01 视觉与交互基准=原型
  prototype-turn-preview-cards.html），新 onExpandPreview 可选 prop——缺省不渲染分支，
  dialog / /runtimes 弹窗等旧消费方零回归。
implementation:
  - 'TurnTimelineProps 新增可选 expandPreview（runKey 字符串入参无返回）；TurnRow props 新增 per-row 基元（onExpandPreview 回调引用 + isPreview 布尔派生进 memo 行，防字符串/对象直传击穿行 memo，R-07 同法先例 isHighlighted）'
  - 'TurnRow（frontend/src/components/daemon/turn-timeline.tsx:479）render 分支最前置：turn.preview 存在且无 prompt/output → 渲染 TurnPreviewCard；缺省 expandPreview 时整分支不渲染（类型收窄守卫）'
  - 'TurnPreviewCard（同文件组件族内）：整卡 button（data-testid=turn-preview-card + aria-label 轮号/状态/摘要，对齐 turn-nav-list.tsx:118 buildAriaLabel 口径）＝ 轮号徽章 + 状态点（复用 statusDotCls 语义色）+ 时间 + 提问摘要 line-clamp-2 + 答复摘要条件渲染 line-clamp-2 +「展开完整对话」文案；点击上抛 onExpandPreview(runKey=turn.realRunId ?? turn.runId)；data-turn-key 锚点照挂（与真实块同源，替换后定位键不变）'
  - '视觉：border-dashed + bg-brand-50 + hover 时 bg-brand-100（brand-* 语义阶随主题，零硬编码 hex）；content-visibility auto 屏外跳过（先例同文件 :555-560）'
acceptance:
  - 预览卡渲染轮号/状态/时间/提问摘要；答复摘要仅有 answerSummary 时显示
  - 点击触发 onExpandPreview 且实参=该轮 runKey；缺省 expandPreview 挂载（旧消费方形态）不渲染任何预览分支
  - NEW:frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx 三组用例绿
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/turn-preview-card.test.tsx src/components/daemon/__tests__/session-panel-variant.test.tsx
constraints:
  - 不改既有真实轮块渲染路径与 memo 结构（仅前置分支）
  - 不发网络请求（渲染纯静态）；样式不硬编码色值
  - 既有测试断言不因本改动失效（related_tests 声明面复跑确认，失效即修）
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
