---
id: task-07
title: 'deriveSessionPlaceholder 排队态 mobile 短句（FR-03）'
title_zh: 'deriveSessionPlaceholder 排队态 mobile 短句（FR-03）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 23:19:47
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/daemon/session-panel/page-helpers.tsx
  - frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
target_files:
  - frontend/src/components/daemon/session-panel/page-helpers.tsx
goal: >
  治手机端输入框占位截断（截图②「排队中，本轮结束后自动发送…」放不下）：
  deriveSessionPlaceholder 补排队态的 mobile 短句分支（沿用既有 mobile opt 参数
  模式，ql-20260915-009 先例）；desktop 占位文案不变。
implementation:
  - deriveSessionPlaceholder 排队态分支加 mobile opt：短句改写（如「已排队」或等长短句），保持状态语义
  - 其他状态（running/restoring）已有 mobile 短句的不动（ql-20260915-013 已收敛）
  - 测试：排队态 mobile 短句断言 + desktop 长句锚（既有测试文件内补用例）
acceptance:
  - mobile opt + 排队态 → 返回短句（≤12 字）
  - desktop 占位返回值与改动前一致（既有用例零改动通过）
verify:
  - cd "frontend" && pnpm vitest run "src/app/(dashboard)/sessions/__tests__/page.test.tsx"
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 只改排队态分支，不动 running/restoring/ended 等其他状态文案
  - desktop 路径返回值逐字符不变
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
