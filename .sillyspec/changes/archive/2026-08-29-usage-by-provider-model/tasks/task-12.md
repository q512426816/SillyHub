---
id: task-12
title: 'runtime-card by_provider 分组明细 + 计费口径 footnote + 测试（mock 增 by_provider）'
title_zh: 'runtime-card by_provider 分组明细 + 计费口径 footnote + 测试（mock 增 by_provider）'
author: 'qinyi'
created_at: 2026-08-29 02:52:55
priority: P0
depends_on: ['task-02', 'task-05']
blocks: []
requirement_ids: [FR-04-2, FR-02-3]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/components/daemon/runtime-card.tsx
  - frontend/src/components/daemon/runtime-card-helpers.tsx
  - frontend/src/app/(dashboard)/runtimes/__tests__/page-usage.test.tsx
goal: >
  runtime-card 用量区新增 by_provider 分组明细表（供应商 tag+模型+四维+调用数）与计费口径 footnote；空态隐藏。
implementation:
  - 消费 usage.by_provider（类型来自 task-02 gen:types）渲染明细行
  - 「未记录」tag 兜底 + footnote 文案（NFR-04）
  - mock 补 by_provider 字段修既有测试
acceptance:
  - 分组明细照原型渲染；窗口切换数值随动
  - 既有 page-usage 用例绿
verify:
  - cd frontend && pnpm exec vitest run src/app/(dashboard)/runtimes/__tests__/page-usage.test.tsx
constraints:
  - 不改 RuntimeUsageLineChart 与 summary 数字
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
