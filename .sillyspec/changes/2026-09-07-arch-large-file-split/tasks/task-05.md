---
id: task-05
title: 'Wave1 验收——daemon 定向测试全绿（session-manager/task-runner 相关子集）+ tsc --noEmit + 行数核查'
title_zh: 'Wave1 验收——daemon 定向测试全绿（session-manager/task-runner 相关子集）+ tsc --noEmit + 行数核查'
author: 'qinyi'
created_at: 2026-09-07 08:48:02
priority: P0
low_risk: true
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-06, FR-03]
decision_ids: [D-006@v1, D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/cli.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/task-runner.ts
goal: >
  Wave1 daemon 拆分成果的阶段验收门——定向测试子集全绿 + tsc --noEmit 零错误 +
  facade 与子模块行数达标 + 零测试文件改动 + 在途文件零改动，全部通过才放行进入 Wave2 backend（D-003 顺序门控）。
implementation:
  - 确认 task-02/task-03/task-04 均已完成并独立提交，本卡为只读验证不改任何文件（allowed_paths 三文件仅作被验证入口）
  - 在 sillyhub-daemon 下跑 pnpm exec tsc --noEmit，确认全量类型检查零错误
  - 跑定向测试子集——tests/interactive 全目录（session-manager 相关主战场）+ tests/task-runner 前缀 11 个文件 + 顶层 session-manager 相关文件
  - 用 wc -l 核查 session-manager.ts 与 task-runner.ts 两个 facade 及其包内全部新子模块的行数
  - 用 git diff --stat 核对 sillyhub-daemon/tests 与在途 5 个 daemon 文件零改动，任一项不满足即判验收失败，回退对应实现 task 修复后重验
acceptance:
  - tsc --noEmit 零错误退出
  - 定向测试子集全部通过——tests/interactive 全目录 + task-runner 相关 + session-manager 相关，零失败
  - 行数达标——session-manager.ts ≤2500、task-runner.ts ≤2500、两个包内全部新子模块 ≤800
  - git diff 确认 sillyhub-daemon/tests 下零测试文件改动（D-006 硬验收）
  - git diff 确认在途 5 个 daemon 文件零改动——daemon.ts、hub-client.ts、config.ts、protocol.ts、sillyspec-manager.ts
  - 本验收门未通过时禁止启动 Wave2 任何 backend task（D-003 门控语义，FR-03）
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive tests/task-runner tests/session-manager --silent
  - cd sillyhub-daemon && wc -l src/interactive/session-manager.ts src/task-runner.ts src/interactive/session-manager/*.ts src/task-runner/*.ts
  - git diff --stat -- sillyhub-daemon/tests
  - git diff --stat -- sillyhub-daemon/src/daemon.ts sillyhub-daemon/src/hub-client.ts sillyhub-daemon/src/config.ts sillyhub-daemon/src/protocol.ts sillyhub-daemon/src/sillyspec-manager.ts
constraints:
  - 只读验收卡——不修改任何源码、测试、配置，发现问题回退到对应实现 task 修复而非就地打补丁
  - 禁止跑全量测试套件，仅跑上述定向子集（全量测试留给 CI）
  - 禁止为让验收通过而修改任何测试文件（D-006 硬验收）
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
