---
id: task-15
title: 'Wave3 拆分 lib/daemon.ts → lib/daemon/ 10 文件目录'
title_zh: 'Wave3 拆分 lib/daemon.ts → lib/daemon/ 10 文件目录'
author: 'qinyi'
created_at: 2026-09-07 08:48:02
priority: P0
depends_on: ['task-13']
blocks: []
requirement_ids: [FR-02, FR-04]
decision_ids: [D-004@v1, D-005@v3]
allowed_paths:
  - frontend/src/lib/daemon.ts
  - frontend/src/lib/daemon/index.ts
  - frontend/src/lib/daemon/runtimes.ts
  - frontend/src/lib/daemon/machines.ts
  - frontend/src/lib/daemon/shared-agents.ts
  - frontend/src/lib/daemon/dir.ts
  - frontend/src/lib/daemon/session-sse.ts
  - frontend/src/lib/daemon/sessions.ts
  - frontend/src/lib/daemon/session-queue.ts
  - frontend/src/lib/daemon/group-chat.ts
  - frontend/src/lib/daemon/team-missions.ts
goal: >
  按 design §5 Wave 3 表把 4090 行 lib/daemon.ts 拆为 lib/daemon/ 目录 10 文件，index.ts 全量再导出，140 条 import 与 55 处 vi.mock 零改动。
implementation:
  - 按资源域把函数与类型搬入九个模块（runtimes、machines、shared-agents、dir、session-sse、sessions、session-queue、group-chat、team-missions）
  - zod schema 与 parse 事件解析、重连常量随用它们的 session-sse 模块走，streamSession 490 行单体原样搬移不顺手重构
  - index.ts 全量再导出，对照 task-13 产出的导出面基线逐项核对无遗漏
  - 删除原 lib/daemon.ts 后跑定向测试，全绿再收尾
acceptance:
  - index.ts 再导出面与拆前完全一致，140 条 import 与 55 处 vi.mock 零改动通过
  - 新拆出文件均 ≤800 行（D-005@v3）
  - 请求路径、事件解析与重连行为零变化
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run $(grep -rl 'vi.mock("@/lib/daemon"' src | tr '\\\\' '/') --silent
constraints:
  - 只搬移不改逻辑，不改任何函数签名与导出名
  - 不改任何既有测试文件与 vi.mock 形状
  - 不触碰 session-panel.tsx 与 D-001 排除的在途文件
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
