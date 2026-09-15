---
id: task-10
title: 'daemon 单测收口——守卫三态/锚点生命周期/4 处注入+2 处不可达/后台 dialog 兜底/USAGE_NOTE 全用例 + 相关既有测试跑绿'
title_zh: 'daemon 单测收口——守卫三态/锚点生命周期/4 处注入+2 处不可达/后台 dialog 兜底/USAGE_NOTE 全用例 + 相关既有测试跑绿'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 16:45:00
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05', 'task-06']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - NEW:sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts
  - NEW:sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts
  - sillyhub-daemon/tests/interactive/claude-sdk-driver-permission.test.ts
  - sillyhub-daemon/tests/interactive/permission-resolver.test.ts
  - sillyhub-daemon/tests/interactive/session-manager-write-guard.test.ts
  - sillyhub-daemon/src/interactive/session-manager/permission.ts
  - sillyhub-daemon/src/interactive/permission-resolver.ts
  - sillyhub-daemon/src/interactive/session-manager/events.ts
  - sillyhub-daemon/src/interactive/session-manager/background-tasks.ts
target_files:
  - NEW:sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts
  - sillyhub-daemon/tests/interactive/claude-sdk-driver-permission.test.ts
  - sillyhub-daemon/tests/interactive/permission-resolver.test.ts
related_tests:
  - sillyhub-daemon/tests/interactive/claude-sdk-driver-permission.test.ts（:494
    toContain('session not in running turn') 因 FR-03 的 PLATFORM_NO_RUNNING_TURN
    前缀插入而失效，需同步断言）
goal: >
  为 daemon 侧后台任务权限锚点与 background_task 标记补全单测收口，并同步
  FR-03 平台故障码前缀导致的既有断言变更，保证 daemon 行为与设计契约一致。
implementation:
  - 新建 session-manager-bg-anchor.test.ts：守卫三态、锚点生命周期（保留-注销-
    终态清）、4 处可达注入点逐一断言 background_task 透传、2 处不可达路径锚点态
    cancelled、后台 dialog 5min 兜底、USAGE_NOTE 两态。
  - 修改 claude-sdk-driver-permission.test.ts :494 断言：toContain('session not in
    running turn') 改为 toContain('PLATFORM_NO_RUNNING_TURN')（或含前缀的新文案）。
  - 按需修订 permission-resolver.test.ts / session-manager-write-guard.test.ts 中
    受 FR-03 前缀影响的断言，语义不变仅文案同步。
acceptance:
  - 新建锚点测试覆盖上述全部用例且通过。
  - 既有相关测试文件全部跑绿（含 :494 修订后断言）。
  - pnpm typecheck 通过。
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/claude-sdk-driver-permission.test.ts tests/interactive/permission-resolver.test.ts tests/interactive/session-manager-bg-anchor.test.ts && pnpm typecheck
constraints:
  - 注释与实现一致（CLAUDE.md 规则18）。
  - 不引入无关变更；断言修订仅限 FR-03 前缀同步，不改测试语义。
  - 不许跑全量测试套件（CLAUDE.md 规则0）。
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
