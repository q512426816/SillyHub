---
id: task-01
title: 'daemon 忙判定查询口（session-manager.hasRunningTurn + task-runner.hasActiveLease，不动 daemon.ts）'
title_zh: 'daemon 忙判定查询口（session-manager.hasRunningTurn + task-runner.hasActiveLease，不动 daemon.ts）'
author: 'qinyi'
created_at: 2026-08-29 15:04:03
priority: P0
depends_on: []
blocks: [task-04]
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/tests/session-manager-busy-check.test.ts
  - sillyhub-daemon/tests/task-runner-busy-check.test.ts
goal: >
  daemon 暴露忙判定查询口，供 tryUpdate 编排器（task-04）判定是否推迟升级——仅进行中算忙（FR-01 / D-001@v1）。
  hasRunningTurn 判 sessionManager._store 存在 status==='running' 的会话；hasActiveLease 判 taskRunner._controllers 非空；reconnecting/active 空闲会话不算。
implementation:
  - session-manager.ts 新增公开方法 hasRunningTurn()——遍历 _store.values()（Map 声明于 session-manager.ts:597），任一 SessionState.status==='running' 即返回 true；reconnecting/active/ended/failed 一律不算（遍历口径照 1316-1318 活会话计数先例）
  - task-runner.ts TaskRunner 新增公开方法 hasActiveLease()——返回 _controllers.size>0（Map 声明于 task-runner.ts:346；同口径计数先例 activeTaskCount 见 425-427）
  - 新增 tests/session-manager-busy-check.test.ts（vitest，导入带 .js 扩展名）——构造 SessionManager 后经公开链路或 as any 注入 _store 驱动 status，覆盖 running→true 与 reconnecting/active/ended/failed/空 store→false
  - 新增 tests/task-runner-busy-check.test.ts——实例化 TaskRunner 经 track/untrack（task-runner.ts:433/448）驱动，覆盖空 Map→false、track 后→true、untrack 后→false
acceptance:
  - hasRunningTurn 仅 status==='running' 判忙；reconnecting/active 及终态延迟清理残留条目均不误报（D-001@v1 口径）
  - hasActiveLease 与 _controllers 严格一致（空=false、非空=true）
  - 不改 daemon.ts（TaskRunnerLike 可选化归 task-04）；两个新测试全绿且既有相关测试零回归
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/session-manager-busy-check.test.ts tests/task-runner-busy-check.test.ts
  - cd sillyhub-daemon && pnpm run typecheck
constraints:
  - 禁止修改 daemon.ts——TaskRunnerLike 接口可选化与查询口消费统一归 task-04
  - 只读查询无副作用，不改变 _store/_controllers 生命周期，不新增挂起/取消逻辑
  - ESM 导入一律 .js 扩展名；仅跑本任务相关测试，全量留 CI
provides:
  - contract: BusyCheckApi
    fields: [hasRunningTurn, hasActiveLease]
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
