---
id: task-03
title: 'split-task-runner-into-8-submodules-with-thin-facade'
title_zh: '拆分 task-runner.ts → task-runner/ 8 子模块 + 瘦 facade'
author: 'qinyi'
created_at: 2026-09-07 08:48:02
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02, FR-04]
decision_ids: [D-004@v1, D-005@v3, D-006@v1]
allowed_paths:
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/task-runner/payload.ts
  - sillyhub-daemon/src/task-runner/change-write.ts
  - sillyhub-daemon/src/task-runner/runner-types.ts
  - sillyhub-daemon/src/task-runner/skill-prompt.ts
  - sillyhub-daemon/src/task-runner/render.ts
  - sillyhub-daemon/src/task-runner/spawn-stream.ts
  - sillyhub-daemon/src/task-runner/file-mcp.ts
  - sillyhub-daemon/src/task-runner/index.ts
goal: >
  把 3426 行的 task-runner.ts 拆为 task-runner/ 下 8 个子模块 + 保留瘦 facade（TaskRunner 类壳 + 委托方法 + re-export），导出面与行为零变化，全部既有测试零修改通过。
implementation:
  - 对照 task-01 基线与 design.md §5 Wave 1 表，按 runner-types → change-write → file-mcp → payload → skill-prompt → render → spawn-stream → index 顺序一次搬一个簇
  - 模块级函数与常量（pickStr/pickNum/pickStrList、ChangeWrite 校验、FILE_MCP_*、渲染与 prompt 构建）原样搬移零改写；_spawnAndStream 与 _handleLine 方法体下沉为 spawn-stream.ts 函数，this 状态改显式传参
  - facade 保留 TaskRunner 类同名方法一行委托与 runLease 编排、心跳循环、审批处理，预计残留 1400-1600 行
  - 每搬完一簇跑 tests/task-runner*.test.ts 相关子集定向测试，全绿后再搬下一簇；完成后对照 daemon-export-baseline.md 核对导出面并跑 tsc
acceptance:
  - task-runner.ts facade 导出符号集合与拆前完全一致（对照 task-01 基线，23 个引用方零改动）
  - 8 个子模块均 ≤800 行，facade 保留核心编排 ≤2500 行（FR-04、D-005@v3）
  - 全部 task-runner 相关既有测试（含 tests/task-11-change-write.test.ts）零修改全绿，tsc --noEmit 通过
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
  - cd sillyhub-daemon && pnpm exec vitest run tests/task-runner.test.ts tests/task-runner-approval-decision.test.ts tests/task-runner-budget.test.ts tests/task-runner-file-mcp.test.ts tests/task-runner-skill-detect.test.ts --silent
  - cd sillyhub-daemon && pnpm exec vitest run tests/task-runner-busy-check.test.ts tests/task-runner-lease-cancel-idempotent.test.ts tests/task-runner-policy-cache.test.ts tests/task-runner-provider-dispatch.test.ts tests/task-runner-retry-timeout.test.ts tests/task-runner-terminal-observer.test.ts tests/task-11-change-write.test.ts --silent
constraints:
  - 不改任何公共方法签名、不改行为、不改异常文案与日志格式（只做搬移 + this 改显式传参）
  - 不碰 daemon.ts、hub-client.ts 等在途变更文件，也不改 src/interactive/ 下任何文件（与 task-02 不交叉改文件）
  - ESM import 一律带 .js 扩展名（原路径保留为 facade）
  - 既有测试零修改；测试需改 import 才能通过即判定兼容层设计失败回炉修正（D-006@v1）
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
