---
id: task-16
title: 'Wave3 验收——frontend 定向测试全绿（components/daemon/__tests__ + lib/daemon mock 相关）+ tsc --noEmit + 行数核查'
title_zh: 'Wave3 验收——frontend 定向测试全绿（components/daemon/__tests__ + lib/daemon mock 相关）+ tsc --noEmit + 行数核查'
author: 'qinyi'
created_at: 2026-09-07 08:48:02
priority: P0
low_risk: true
depends_on: ['task-14', 'task-15']
blocks: []
requirement_ids: [FR-06, FR-03]
decision_ids: [D-006@v1, D-003@v1]
allowed_paths:
  - frontend/src/components/daemon/session-panel/index.tsx
  - frontend/src/lib/daemon/index.ts
goal: >
  frontend 阶段验收门（Wave 11）——定向测试零修改全绿、tsc 通过、行数达标三项核查全过才放行 task-17 总验收。
implementation:
  - 跑 tsc 与 components/daemon/__tests__ 58 个测试，确认零修改全绿
  - 用 grep 圈定 55 处 vi.mock 消费方测试并运行，确认 mock 形状零失效
  - wc -l 核查新文件 ≤800 与两项豁免（page ≤3000、dialog ≤2000）
  - git diff 对照拆分前基线确认既有测试文件与 24 个 session-panel 引用文件零改动，结果记入验收记录
acceptance:
  - src/components/daemon/__tests__ 58 个测试文件内容零修改且全绿
  - 55 处 vi.mock 消费方测试零失效，session-panel 7 符号导入正常
  - pnpm exec tsc --noEmit 通过
  - 行数达标（新文件 ≤800、session-panel-page.tsx ≤3000、session-panel-dialog.tsx ≤2000）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__ --silent
  - cd frontend && wc -l src/components/daemon/session-panel/*.tsx src/components/daemon/session-panel/*.ts src/lib/daemon/*.ts
constraints:
  - 只读验证任务，不改代码与测试（allowed_paths 两入口仅作核查锚点）
  - 不新增测试，既有测试零修改（D-006）
  - 任一核查失败即阻断返工，不放行总验收
  - 只跑定向子集不跑全量测试
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
