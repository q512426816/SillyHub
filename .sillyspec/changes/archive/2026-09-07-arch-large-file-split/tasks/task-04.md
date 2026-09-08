---
id: task-04
title: 'daemon-light-refactor-payload-utils-event-wire-dialog-result'
title_zh: 'daemon 轻重构——payload-utils.ts + event-wire.ts + dialogResult 收敛（白名单①②⑥）'
author: 'qinyi'
created_at: 2026-09-07 08:48:02
priority: P1
depends_on: ['task-02', 'task-03']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-002@v1, D-005@v3]
allowed_paths:
  - sillyhub-daemon/src/payload-utils.ts
  - sillyhub-daemon/src/event-wire.ts
  - sillyhub-daemon/tests/payload-utils.test.ts
  - sillyhub-daemon/tests/event-wire.test.ts
  - sillyhub-daemon/tests/dialog-result.test.ts
  - sillyhub-daemon/src/interactive/session-manager/helpers.ts
  - sillyhub-daemon/src/interactive/session-manager/events.ts
  - sillyhub-daemon/src/interactive/session-manager/permission.ts
  - sillyhub-daemon/src/task-runner/payload.ts
  - sillyhub-daemon/src/task-runner/spawn-stream.ts
goal: >
  在 task-02/task-03 拆出的新包结构上完成 daemon 轻重构白名单①②⑥——新增 src/payload-utils.ts 统一鸭子读取器、新增 src/event-wire.ts 收敛 AgentEvent 到 wire dict 的平行转换、permission 簇 dialogResult 读取收敛，每项独立提交并带新增定向测试。
implementation:
  - 白名单① 新增 payload-utils.ts，统一 task-runner/payload.ts 的 pickStr/pickNum/pickStrList/pickBudgetUsageSnapshot 与 session-manager/helpers.ts 的 strOf/numOf 两套鸭子读取实现，保留原函数名做一行委托后调用点切换
  - 白名单② 新增 event-wire.ts，收敛 _eventToReportDict（session-manager/events.ts）与 _eventToMessages（task-runner/spawn-stream.ts 侧调用点）平行维护的 AgentEvent 转换核心，两处复用同一实现
  - 白名单⑥ 在 session-manager/permission.ts 提取 dialogResult 读取 helper，收敛 4 处 decision 上 dialogResult 鸭子读取与判空的重复模式
  - 每项独立 git 提交（独立可 revert），并新增 tests/payload-utils.test.ts、tests/event-wire.test.ts、tests/dialog-result.test.ts 三个定向测试文件
acceptance:
  - 白名单①②⑥ 三项各带新增定向测试且全绿，白名单外零行为改动（FR-05）
  - 两个新源文件与三个新测试文件落地，包内调用点完成切换且两包对外导出面不变
  - session-manager 与 task-runner 相关既有测试零修改全绿，tsc --noEmit 通过
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
  - cd sillyhub-daemon && pnpm exec vitest run tests/payload-utils.test.ts tests/event-wire.test.ts tests/dialog-result.test.ts --silent
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/session-manager.test.ts tests/task-runner.test.ts --silent
constraints:
  - 仅限白名单①②⑥（③④⑤属 backend 后续任务），白名单外禁止顺手改
  - 每项轻重构独立提交、独立可 revert，不改任何对外导出面
  - 既有测试零修改，只新增测试文件（新增测试路径已进本卡 allowed_paths）
  - 不碰 daemon.ts、hub-client.ts 等在途变更排除文件
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
