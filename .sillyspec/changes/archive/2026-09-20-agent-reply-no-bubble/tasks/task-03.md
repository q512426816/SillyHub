---
id: task-03
title: 'Migrate mobile css rule and update tests for seg-text-body'
title_zh: 'mobile 规则迁移与测试同步——globals.css 迁新类名并更新断言'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 17:51:06
priority: P0
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001@v1, D-003@v1, D-005@v1]
allowed_paths:
  - frontend/src/app/globals.css
  - frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx
  - frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
target_files:
  - frontend/src/app/globals.css
  - frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx
  - frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
goal: >
  把 globals.css mobile 块的 .seg-text-bubble 规则迁到 .seg-text-body（仅字号/行高，不带
  max-width 覆盖防压掉 48rem 阅读限宽），并同步测试断言（旧类名改新类名 + 新增无框形态断言），
  保证 mobile 可读性规则不丢失、相邻面测试全绿。
implementation:
  - 修改 frontend/src/app/globals.css:818-826 mobile 块——.seg-text-bubble 选择器改 .seg-text-body，保留 font-size 14px / line-height 24px，删去 max-width 94% 行（阅读限宽由组件内 min(100%,48rem) 统一承担）；块注释改写为「.turn-bubble=用户气泡,.seg-text-body=段模型+旧路径 agent 无框正文」新口径
  - 修改 frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx:411——querySelectorAll(".seg-text-bubble") 改 ".seg-text-body"，相关注释同步
  - 修改 frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx——TextSegmentView 组新增无框形态断言（容器存在 .seg-text-body 且无 border/bg-card 类），:207「气泡内常驻挂载」注释措辞改「正文容器内常驻挂载」
acceptance:
  - mobile 变体下 .seg-text-body 规则为 font-size 14px / line-height 24px 且规则内无 max-width 声明
  - globals.css 内无 .seg-text-bubble 残留；.turn-bubble mobile 规则（含 max-width 94%）保留不动
  - session-panel-dialog.test 与 turn-segment-views.test 全绿，且含至少一条 .seg-text-body 无框断言
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/turn-segment-views.test.tsx src/components/daemon/__tests__/session-panel-dialog.test.tsx
  - cd frontend && pnpm exec vitest run "src/app/(dashboard)/sessions/__tests__/page.test.tsx"
constraints:
  - 不改 .turn-bubble 的 mobile 规则（用户气泡限宽 94% 放大逻辑不动）
  - 不新增视觉元素或分隔线（D-004）
  - 遵守仓库规则 0 只跑相关测试，不跑全量
related_tests:
  - path: frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx
    reason: :411 硬断言 .seg-text-bubble 类名，task-01 类名替换后失效，需同步为新类名
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
