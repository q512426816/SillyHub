---
id: task-07
title: 'Full-chain regression for cross-machine dispatch fix'
title_zh: '全链路回归——backend 测试子集 + ruff + daemon typecheck/vitest + 存量行为确认（depends_on: task-04,06）'
author: 'WhaleFall'
created_at: 2026-08-28 15:48:26
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-06, NFR-01, NFR-02]
decision_ids: []
allowed_paths:
  - backend/app/modules/agent/tests/
  - backend/app/modules/workspace/member_runtimes/tests/
  - backend/app/modules/agent/mcp_tools.py
  - backend/app/modules/agent/placement.py
  - backend/app/modules/workspace/member_runtimes/queries.py
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/interactive-cwd-guard.ts
  - sillyhub-daemon/tests/
goal: >
  全链路回归收口——跑 backend 相关测试子集 + ruff + daemon typecheck/vitest，
  对照 design「全局验收标准」5 条逐项确认（存量 :283/:317/:684 行为不变、
  batch 路径与普通会话零波及），修复暴露的测试与实现缝隙（不改设计语义），
  产出回归结论供 verify 阶段引用。
implementation:
  - 'backend 相关子集回归（agent tests + workspace member_runtimes tests + daemon host_fs tests）——pytest 跑 test_worker_subsession_dispatch.py、test_placement_member_binding.py、app/modules/workspace/member_runtimes/tests、关联套件 test_integration_cross_workspace.py 与 test_mcp_tools_cross_workspace.py（batch 路径/普通会话不受影响确认）、app/modules/daemon/host_fs/tests（host_fs 方法零波及确认）'
  - 'ruff——cd backend && uv run ruff check app --fix（仅针对本 change 改动文件），确认零告警'
  - 'daemon——cd sillyhub-daemon && pnpm typecheck（tsc --noEmit）+ pnpm test（vitest 全量，含 interactive-cwd-guard.test.ts 三形态×双 OS 与 daemon 认领链路既有测试）；task-06 已实证 23 个存量夹具红（_startInteractiveSession 系假 rootPath + mockConfig 无 allowed_roots 被新守卫正确拒绝，stash 基线对照确认）——给这些夹具 mockConfig 补 allowed_roots 覆盖假 cwd 或使 cwd 真实存在（需求变更驱动的夹具更新，非放水）'
  - '对照 design 全局验收标准 5 条逐项确认——①新增/修改相关单测全绿；②存量 :283/:317/:684 零改动通过；③brownfield 未涉及路径零变化（batch 派发、普通 create_session、host_fs 方法测试不受影响）；④daemon typecheck 通过；⑤拒绝路径均有可诊断中文错误信息（422 既有 / 400 新增 / cwd_forbidden / cwd_not_found）'
  - '修复回归暴露的连带问题——只修测试与实现缝隙（如 mock 缺字段、接线缝隙），不改设计语义、不新增功能；源码改动仅限 allowed_paths 所列实现文件'
  - '产出回归结论——跑过的测试文件清单 + 通过数 + 5 条验收逐项结论，写入本卡片执行记录或 verify-result，供 verify 阶段引用'
acceptance:
  - 'backend pytest 子集、ruff、daemon typecheck/vitest 各命令 exit 0（含 vitest 全绿）'
  - 'design 全局验收标准 5 条逐项有结论与证据——含存量 :283/:317/:684 行为不变、batch 路径与普通会话不受影响（关联套件通过）'
  - '暴露的缝隙已修复且仅限测试/实现缝隙，无设计语义变更、无新增功能'
  - '回归结论（测试文件清单 + 通过数）已写入卡片执行记录或 verify-result，verify 阶段可直接引用'
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_worker_subsession_dispatch.py app/modules/agent/tests/test_placement_member_binding.py app/modules/agent/tests/test_integration_cross_workspace.py app/modules/agent/tests/test_mcp_tools_cross_workspace.py app/modules/workspace/member_runtimes/tests app/modules/daemon/host_fs/tests -q
  - cd backend && uv run ruff check app
  - cd sillyhub-daemon && pnpm typecheck && pnpm test
  - '人工核验——各命令 exit 0 + 列出跑过的测试文件清单与通过数；daemon.ts 接线级「不 mkdir/保留 mkdir」无自动化断言，按 design Wave C 口径人工核验'
constraints:
  - '只修测试/实现缝隙不改设计语义；不新增功能；源码改动仅限 allowed_paths 所列文件'
  - '禁止跑全量测试套件（CLAUDE.md 规则0）——backend 仅跑与本 change 修改相关的测试子集；daemon vitest 为该仓测试且均与 daemon.ts/守卫改动相关，属修改相关闸门'
  - '产出回归结论写入卡片执行记录或 verify-result 供 verify 阶段引用'
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

## 执行记录（task-07，2026-08-28）

### 夹具债修复摘要（daemon 23 失败全数修复，非放水——夹具假 rootPath + 无 allowed_roots 被新守卫正确拒绝）

| 测试文件 | 修法 |
|---|---|
| tests/daemon-borrow-sandbox.test.ts | mkTmpDir 真实 mkdir（cwd 存在性终检）+ buildDaemon config 补 `allowed_roots: [workspaceDir]` |
| tests/daemon-budget-wiring.test.ts | interactive 用例 rootPath 假路径 `C:\work` → 真实 `tmpdir()` + mockConfig 补 `allowed_roots: [tmpdir()]` |
| tests/daemon-interactive-codex.test.ts | driveInteractiveStart 默认 rootPath `/tmp/work` → `tmpdir()` + mockConfig 补 `allowed_roots: [tmpdir()]` |
| tests/daemon-kind-dispatch.test.ts | interactive 用例 rootPath 假路径 `C:\work` → `tmpdir()`（AC-06 cwd 断言同步指向 tmpdir()，意图不变）+ mockConfig 补 `allowed_roots: [tmpdir()]` |
| tests/interactive/daemon-notify-session-ready.test.ts | 夹具 cwd 已是真实 tmpdir()，仅 mockConfig 补 `allowed_roots: [tmpdir()]` |
| tests/spec-transport-tar-sync/daemon-interactive-spec-sync.test.ts | driveInteractiveStart 默认 rootPath `C:\work` → `tmpdir()` + mockConfig 补 `allowed_roots: [tmpdir()]` |

连带修复：backend ruff `check app` 拦门 2 处 SIM114（mcp_tools.py / daemon/router.py 的 list_workers 与 mission summary 行化 elif 双分支同值）——系本分支搭载的 quick 873ebc46 引入（merge-base 对照实证非本 change 各 task 引入），按 ruff --fix 同款机械合并 `or`，零语义变化；守护用例 test_mcp_tools.py 52 绿 + test_derive_status_matrix.py 169 绿。

### 回归命令输出（全部 exit 0）

1. `cd backend && uv run pytest <六处子集> -q` → **145 passed**（test_worker_subsession_dispatch + test_placement_member_binding + test_integration_cross_workspace + test_mcp_tools_cross_workspace + workspace/member_runtimes/tests + daemon/host_fs/tests）
2. `cd backend && uv run ruff check app` → **All checks passed!**（exit 0）
3. `cd sillyhub-daemon && pnpm typecheck` → **tsc --noEmit 0 错**（exit 0）
4. `cd sillyhub-daemon && pnpm test` → **Test Files 170 passed (170) / Tests 2954 passed | 9 skipped (2963)**（基线 23 failed / 2931 passed → 0 failed）

### design 全局验收 5 条逐项结论

1. **新增/修改相关单测全绿**：通过——backend 子集 145 绿（含 TestAllowedRootsPrecheck 三形态 / A1 两段式 / 双源同序收敛 / :736 绑定钉定重写）；daemon vitest 2954 绿含 interactive-cwd-guard.test.ts 11 用例（三形态×双 OS）。
2. **存量 :283/:317/:684 零改动通过**：通过——base :283/:317 所在 `test_dispatch_creates_subsession_triple` 与 :684 `test_cross_ws_target_pinned_to_representative_machine` 与 merge-base 逐字节 diff IDENTICAL 且 2 passed。
3. **brownfield 未涉及路径零变化**：通过——batch 派发与普通会话由 test_integration_cross_workspace / test_mcp_tools_cross_workspace 通过证实；host_fs 方法测试（daemon/host_fs/tests）通过；daemon gap-8 空 rootPath 兜底 mkdir 保留用例（daemon-kind-dispatch gap-8 无 rootPath）+ batch 用例（AC-05 ×2 / budget batch ×2 / task-10 batch）全绿。
4. **daemon typecheck 通过**：通过——tsc --noEmit exit 0。
5. **拒绝路径均有可诊断中文错误信息**：通过——422 既有文案不变（两段 provider 无果维持）；400 新增（mcp_tools.py:1182「目标工作区路径 … 不在绑定机器的 allowed_roots 白名单内…」）；cwd_forbidden / cwd_not_found（interactive-cwd-guard.ts 中文 message 经 notifyRunResult result_summary 回传）。

