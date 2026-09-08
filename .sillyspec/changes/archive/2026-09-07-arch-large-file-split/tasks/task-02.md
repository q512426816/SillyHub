---
id: task-02
title: 'split-session-manager-into-13-submodules-with-thin-facade'
title_zh: '拆分 session-manager.ts → interactive/session-manager/ 13 子模块 + 瘦 facade（一次一簇、每簇定向测试）'
author: 'qinyi'
created_at: 2026-09-07 08:48:02
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02, FR-04]
decision_ids: [D-004@v1, D-005@v3, D-006@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/interactive/session-manager/types.ts
  - sillyhub-daemon/src/interactive/session-manager/notify-chain.ts
  - sillyhub-daemon/src/interactive/session-manager/permission.ts
  - sillyhub-daemon/src/interactive/session-manager/driver-factory.ts
  - sillyhub-daemon/src/interactive/session-manager/write-guard.ts
  - sillyhub-daemon/src/interactive/session-manager/usage.ts
  - sillyhub-daemon/src/interactive/session-manager/turn-control.ts
  - sillyhub-daemon/src/interactive/session-manager/lifecycle.ts
  - sillyhub-daemon/src/interactive/session-manager/persistence.ts
  - sillyhub-daemon/src/interactive/session-manager/events.ts
  - sillyhub-daemon/src/interactive/session-manager/background-tasks.ts
  - sillyhub-daemon/src/interactive/session-manager/helpers.ts
  - sillyhub-daemon/src/interactive/session-manager/index.ts
goal: >
  把 5438 行的 session-manager.ts 拆为 interactive/session-manager/ 下 13 个子模块 + 保留瘦 facade（SessionManager 类壳 + 一行委托 + re-export），导出面与行为零变化，全部既有测试零修改通过。
implementation:
  - 对照 task-01 基线与 design.md §5 Wave 1 表，按 types → notify-chain → permission → driver-factory → write-guard → usage → turn-control → lifecycle → persistence → events → background-tasks → helpers → index 顺序一次搬一个方法簇
  - 模块级类型、常量、纯函数原样搬移零改写；类方法体下沉为子模块函数或协作对象（write-guard 收编为 WriteGuardBridge、background-tasks 收编为 BackgroundTaskRegistry），this 状态改显式传参或由协作对象持有
  - facade 保留 SessionManager 类同名方法一行委托与核心编排（构造、create/_createInternal、_runConsume、reload），预计残留 2000-2500 行
  - 每搬完一个方法簇立即跑 tests/interactive 定向测试，全绿后再搬下一簇；全部完成后对照 daemon-export-baseline.md 逐项核对导出面并跑 tsc
acceptance:
  - facade 导出符号集合与拆前完全一致（对照 task-01 基线逐项核对，62 个引用方与全部测试导入零改动）
  - 13 个子模块均 ≤800 行，facade 保留核心编排 ≤2500 行（FR-04、D-005@v3）
  - tests/interactive 及相关顶层既有测试零修改全绿，tsc --noEmit 通过
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive --silent
  - cd sillyhub-daemon && pnpm exec vitest run tests/session-manager-busy-check.test.ts tests/cli-session-manager-injection.test.ts tests/daemon-session-lifecycle-wiring.test.ts --silent
  - cd sillyhub-daemon && git diff --stat src/daemon.ts src/hub-client.ts
constraints:
  - 不改任何公共方法签名、不改行为、不改异常文案与日志格式（只做搬移 + this 改显式传参）
  - 不碰 daemon.ts、hub-client.ts、config.ts、protocol.ts、sillyspec-manager.ts 等在途变更文件，也不改 src/interactive/ 下其它既有文件
  - ESM import 一律带 .js 扩展名（Node ESM 无目录导入，原路径保留为 facade）
  - 既有测试零修改；若发现测试需改 import 才能通过，判定为兼容层设计失败回炉修正而非改测试（D-006@v1）
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
