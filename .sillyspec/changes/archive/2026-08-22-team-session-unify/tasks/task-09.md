---
id: task-09
title: daemon-claude-inject-predicate-and-mission-worker-stage-constant
title_zh: daemon 注入谓词放宽（claude 且 stage 为空或 orchestrator 才注入）+ 分身 lease stage 常量化 mission_worker（role 移 lease metadata 保留）
author: qinyi
created_at: 2026-08-22 03:35:53
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-002@v2, D-003@v1]
provides:
  - contract: MISSION_WORKER_STAGE
    fields: [stage 常量 mission_worker]
allowed_paths:
  - sillyhub-daemon/src/cli.ts
  - backend/app/modules/agent/execution.py
  - sillyhub-daemon/tests/cli-session-manager-injection.test.ts
  - backend/app/modules/agent/tests/test_team_mode_dispatch.py
goal: >
  团队 5 工具从「仅 orchestrator 主控注入」放宽为 Claude 会话常驻注入（design §5 Phase 2，D-002@v2），
  同时把分身派发的 lease stage 常量化为 mission_worker（Grill NEW-2 可判定谓词，run.role 移入
  lease metadata 保留语义，防 worker 递归派发与 converge 干扰即审查 CC-12；codex 不注入为 D-003@v1）。
implementation:
  - backend execution.py dispatch_worker 的 dispatch_to_daemon 调用（第 322 行附近，现为 stage=run.role or mission_worker 回落写法）改为固定传 stage 常量 mission_worker（模块级常量单一来源）
  - run.role 语义保留——dispatch 返回 lease_id 后按 _apply_worker_profile_to_lease 同款按 lease_id 补写 metadata 的模式，把 run.role 写入 lease metadata 的 role 键（空值不写）
  - cli.ts isMainAgentSession 谓词（第 719 行，现为 ctx.stage==='orchestrator'）改为 provider 为 claude 且 stage 为空或 'orchestrator' 时 true、stage 为 mission_worker 时 false，并同步修正 696-719 行旧注释（CLAUDE.md 规则 18）
  - 新增用例——cli-session-manager-injection.test.ts 用捕获的 SessionManager opts.isMainAgentSession 断言真值表（claude 与 codex × stage 空、orchestrator、mission_worker 六组合）；test_team_mode_dispatch.py 断言派发 lease metadata stage 恒为 mission_worker 且 role 键含原值
acceptance:
  - claude 普通会话（stage 空）谓词 true 注入 5 工具配置；存量 external 主控 stage=orchestrator 同样 true 照常注入
  - 分身会话 stage=mission_worker 谓词 false 不注入（防递归派发）；provider=codex 一律 false 不注入
  - execution 派发的 worker lease metadata stage 恒为 mission_worker 且 role 键含原 run.role 值
  - AgentRun.role 列与 daemon claim payload 透传链（context.py 读 lease metadata stage）零改动自通
verify:
  - cd sillyhub-daemon && pnpm exec vitest run --exclude tests/task-09-spec-pull-push.test.ts --exclude tests/spec-transport-tar-sync/daemon-interactive-spec-sync.test.ts --exclude tests/daemon-borrow-sandbox.test.ts && pnpm exec vitest run tests/task-09-spec-pull-push.test.ts tests/spec-transport-tar-sync/daemon-interactive-spec-sync.test.ts tests/daemon-borrow-sandbox.test.ts --poolOptions.forks.maxForks=1
  - cd backend && uv run pytest app/modules/agent -q --no-cov --deselect app/modules/agent/tests/test_dispatch_metadata.py::test_build_claim_payload_propagates_bundle_fields --deselect app/modules/agent/tests/test_execution_context.py::test_get_execution_context_task_run
constraints:
  - 只改 cli.ts 谓词一处；不动 session-manager.ts 与 mcp-config.ts 注入机制（属 task-10）
  - 不给 codex driver 加 mcpServers 消费（D-003@v1 另立后续变更）；daemon 侧对 role 的既有消费不改
  - grep 已确认无既有断言 cli 谓词或 worker stage 的用例，本任务为新增用例而非改断言；跨平台兼容（CLAUDE.md 规则 13）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
