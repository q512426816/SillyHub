---
id: task-08
title: 'Full regression gate: typecheck + 8 enumerated test files + grep sweep + real bin hash guard + scope audit'
title_zh: '整体回归（typecheck + 枚举 8 测试文件全绿 + 真实 bin hash 不变 + 范围核对）'
author: 'qinyi'
created_at: 2026-08-30 17:45:33
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05', 'task-06', 'task-07']
blocks: []
requirement_ids: [FR-09]
decision_ids: [D-001, D-002, D-003, D-004, D-005, D-006, D-007, D-008, D-009]
allowed_paths:
  - sillyhub-daemon/src/preflight.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/preflight.test.ts
  - sillyhub-daemon/tests/preflight-download-replace.test.ts
  - sillyhub-daemon/tests/daemon-heartbeat-pending.test.ts
  - sillyhub-daemon/tests/integration/selfupdate-scenarios.test.ts
  - sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts
goal: >
  整体回归闸门（本卡零代码改动）：跑 typecheck + plan.md Wave5 枚举的 8 个测试
  文件全绿 + grep 兜底 + 真实 bin 防污染（测试前后 hash 不变）+ git status 范围
  核对（7 文件白名单 = 2 源码 + 5 测试），确认本变更全部产出收敛、无超范围改动。
  allowed_paths 在本卡仅作范围核对白名单，不代表本卡要改这些文件。
implementation:
  - "typecheck：cd sillyhub-daemon && pnpm typecheck（tsc --noEmit 0 错）"
  - "8 个枚举测试文件逐一跑绿（vitest run 按文件点名，禁止无参全量）：tests/preflight.test.ts、tests/preflight-download-replace.test.ts、tests/daemon-heartbeat-pending.test.ts、tests/integration/selfupdate-scenarios.test.ts、tests/daemon-selfupdate-orchestrator.test.ts、tests/interactive/daemon-recovery-boot.test.ts（task-05 boot 零变化正主证据）、tests/daemon-interactive-codex.test.ts、tests/integration/resilience-scenarios.test.ts"
  - "grep 兜底：grep -rn 「_recoverSessionsOnBoot|_heartbeatFailSince」 sillyhub-daemon/src sillyhub-daemon/tests --include=*.ts，命中的全部文件核对均已在枚举/白名单内（2026-08-30 现状命中：src/daemon.ts、src/cli.ts（注释）、src/hub-client.ts（注释）、src/api-types.ts（后端生成注释）、tests/integration/resilience-scenarios.test.ts——叙述性注释不改）"
  - "真实 bin 防污染回归：跑测试前后对 ~/.sillyhub/daemon/bin/ 下 sillyhub-daemon.js 与 mcp-server.js 各取 hash（Linux/macOS sha256sum、Windows certutil/Get-FileHash 均可），断言前后一致（防 8-30 生产 bin 污染事故复发）"
  - "范围核对：git status --short 改动仅限 7 文件白名单（2 源码 preflight.ts/daemon.ts + 5 测试 preflight.test.ts、preflight-download-replace.test.ts、daemon-heartbeat-pending.test.ts、integration/selfupdate-scenarios.test.ts、daemon-selfupdate-orchestrator.test.ts）；出现白名单外改动即回溯对应 task 卡修掉，不在本卡新开改动面"
acceptance:
  - "pnpm typecheck 0 错；plan.md Wave5 枚举的 8 个测试文件全绿（含 daemon-recovery-boot 的 task-05 零变化证据）"
  - "grep 兜底命中的文件全部落在枚举清单/白名单内，无意外扩散"
  - "测试前后 ~/.sillyhub/daemon/bin/（sillyhub-daemon.js、mcp-server.js）hash 不变"
  - "git status 改动仅限 7 文件白名单（preflight.ts / daemon.ts / preflight.test.ts / preflight-download-replace.test.ts / daemon-heartbeat-pending.test.ts / integration/selfupdate-scenarios.test.ts / daemon-selfupdate-orchestrator.test.ts）"
verify:
  - 'cd sillyhub-daemon && pnpm typecheck'
  - 'cd sillyhub-daemon && pnpm exec vitest run tests/preflight.test.ts tests/preflight-download-replace.test.ts tests/daemon-heartbeat-pending.test.ts tests/daemon-selfupdate-orchestrator.test.ts'
  - 'cd sillyhub-daemon && pnpm exec vitest run tests/integration/selfupdate-scenarios.test.ts tests/integration/resilience-scenarios.test.ts tests/interactive/daemon-recovery-boot.test.ts tests/daemon-interactive-codex.test.ts'
  - 'grep -rn "_recoverSessionsOnBoot\|_heartbeatFailSince" sillyhub-daemon/src sillyhub-daemon/tests --include=*.ts'
  - 'git status --short （核对仅 7 文件白名单）'
  - '测试前后 ~/.sillyhub/daemon/bin/ 下 sillyhub-daemon.js 与 mcp-server.js 的 hash 对比（sha256sum / Get-FileHash / certutil 任一）'
constraints:
  - "本卡零代码改动：回归发现的问题回对应 task 卡修（allowed_paths 仅作范围核对白名单，不新增改动面）"
  - "禁止跑全量测试（pnpm test / vitest run 无参），全量留给 CI；仅跑枚举 8 文件"
  - "Windows/Linux/macOS 兼容：hash 命令按平台任选（sha256sum / certutil / Get-FileHash），路径不经硬编码分隔符"
  - "不 commit；backend / frontend / api-types.ts 等生成物零改动（design 文件变更清单之外）"
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
