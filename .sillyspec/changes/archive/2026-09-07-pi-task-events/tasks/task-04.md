---
id: task-04
title: 'daemon 全套件相关子集回归 + 模块卡 pi 派生说明'
title_zh: 'daemon 全套件相关子集回归 + 模块卡 pi 派生说明'
author: 'qinyi'
created_at: 2026-09-07 13:17:55
priority: P0
depends_on: [task-02, task-03]
blocks: []
requirement_ids: [FR-04]
decision_ids: []
allowed_paths:
  - .sillyspec/docs/SillyHub/modules/daemon.md
goal: >
  收尾回归与文档同步：daemon 相关测试子集全绿 + tsc 清零（FR-04），daemon.md 模块卡 interactive/ 段 pi-events 描述补任务事件派生说明（archive 前置同步，CLAUDE.md #18 文档与实现一致）。
implementation:
  - 回归子集：pi-events.test.ts + pi-task-dispatch.test.ts + pi-rpc-driver.test.ts（归一化器直接消费者，其断言为 tolerant find 应零回归——若暴雷按 R-01 语义定位根因，禁改断言凑绿）
  - pnpm exec tsc --noEmit 清零（daemon package.json 无 lint script，plan 验收的 lint 项由 typecheck 承担，执行记录中注明）
  - daemon.md interactive/ 段（pi-events 归一化描述处，:51）追加派生说明：rpc 归一化含实例级 turnTask 状态机派生 status/agent_task_status（turn_start→running(task_id=pi-t<seq>)、tool_execution_start→running 刷新、turn_end→stopReason error→failed 其余→completed，D-001/D-002@v1），pi 会话任务执行面板由此有数据
  - 对照 plan.md 验收 5 条（FR-01~04 + ESM/禁全量）逐条核对，证据（测试文件/命令/结果）记入执行记录
acceptance:
  - 三个测试文件子集全绿；tsc --noEmit 零错误（FR-04）
  - daemon.md pi 派生说明与实现一致，既有段落零重写
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/pi-events.test.ts tests/interactive/pi-task-dispatch.test.ts tests/interactive/pi-rpc-driver.test.ts
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 禁跑全量测试（留给 CI）；生产代码零改动（本卡仅模块卡文档）
  - 模块卡只追加 pi 派生说明，不动 claude/codex 及其它段落
  - Windows/Linux/macOS 兼容
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
