---
id: task-01
title: 'export-desktop-format-helpers'
title_zh: '桌面列表页 export 三个格式化 helper（formatTokensCompact/formatCount/formatDurationZh，不改逻辑）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 21:19:19
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-003@v1, D-005@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
target_files:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
goal: >
  为 task-02 移动卡片用量行复用铺路：桌面列表页三个私有格式化 helper
  （formatTokensCompact/formatCount/formatDurationZh）加 export 关键字，
  逻辑零改动（PENDING_REVIEW_LABEL :74 export 同款先例；D-005 禁止复制第二份实现）。
implementation:
  - page.tsx :101/:109/:115 三个 helper 的 function 声明前各加 export 关键字，函数体/签名/逻辑零改动
  - 自查 git diff：除 export 关键字外零 diff（桌面 UsageExecCell 消费点与渲染行为不变）
acceptance:
  - 三个 helper 可从 @/app/(dashboard)/workspaces/[id]/changes/page import 且 tsc 零错误
  - 桌面列表页行为零变化（既有 __tests__/page.test.tsx 全绿，无渲染回归）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- "src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx"
constraints:
  - 只加 export 关键字，禁止改任何函数体/逻辑/签名（不改逻辑红线）
  - 不导出 UsageExecCell/formatMmDdHm（移动用量行由 task-02 用 helper 自绘，不消费这两者）
  - 不新增测试（桌面既有测试即回归防线）
provides:
  - contract: format-helpers
    fields: [formatTokensCompact, formatCount, formatDurationZh]
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
