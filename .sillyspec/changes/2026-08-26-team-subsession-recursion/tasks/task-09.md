---
id: task-09
title: '测试补全（深度门/层0收口/全树/预算强收/会话闸/分层注入）+ 三端全量回归'
title_zh: '测试补全（深度门/层0收口/全树/预算强收/会话闸/分层注入）+ 三端全量回归'
author: 'qinyi'
created_at: 2026-08-26 03:10:00
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05', 'task-06', 'task-07', 'task-08']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08]
decision_ids: [D-001@v1, D-002@v1, D-003@v2, D-004@v1, D-005@v1, D-006@v1, D-007@v1]
allowed_paths:
  - backend/app/modules/agent/tests/test_subsession_recursion_depth_gate.py
  - backend/app/modules/agent/tests/test_subsession_recursion_converge_layer0.py
  - backend/app/modules/agent/tests/test_subsession_recursion_full_tree.py
  - backend/app/modules/agent/tests/test_subsession_recursion_budget_force_end.py
  - backend/app/modules/agent/tests/test_subsession_recursion_session_limit.py
  - backend/app/modules/agent/tests/test_worker_subsession_control.py
  - backend/app/modules/agent/tests/test_worker_subsession_converge_close.py
  - backend/app/modules/agent/tests/test_worker_subsession_dispatch.py
  - backend/app/modules/agent/tests/test_worker_subsession_done.py
  - backend/app/modules/agent/tests/test_worker_subsession_lifecycle.py
  - backend/app/modules/agent/tests/test_worker_subsession_list_workers.py
  - backend/app/modules/agent/tests/test_worker_subsession_patrol_orphan.py
  - backend/app/modules/agent/tests/test_worker_subsession_status.py
  - sillyhub-daemon/tests/interactive/mcp-server-worker-tiers.test.ts
  - sillyhub-daemon/tests/interactive/session-manager-session-limit.test.ts
related_tests:
  - backend/app/modules/agent/tests/test_worker_subsession_control.py
  - backend/app/modules/agent/tests/test_worker_subsession_converge_close.py
  - backend/app/modules/agent/tests/test_worker_subsession_dispatch.py
  - backend/app/modules/agent/tests/test_worker_subsession_done.py
  - backend/app/modules/agent/tests/test_worker_subsession_lifecycle.py
  - backend/app/modules/agent/tests/test_worker_subsession_list_workers.py
  - backend/app/modules/agent/tests/test_worker_subsession_patrol_orphan.py
  - backend/app/modules/agent/tests/test_worker_subsession_status.py
goal: >
  为 task-01 至 task-08 全链路补齐六类自动化守护并收尾三端全量回归——新增
  test_subsession_recursion_* 族（深度门/层0收口/全树/预算强收/会话闸）与 daemon
  interactive 分层注入测试，更新 8 个既有 test_worker_subsession_* 中因预期行为
  变更而失效的断言，跑通 backend / frontend / daemon 三端全量（plan 全局验收
  标准 1-4）。
implementation:
  - '深度门 test_subsession_recursion_depth_gate.py——分身派孙成功（parent=分身、tree_depth=2 落库、worktree_path 忽略置 None）；孙调 dispatch_worker 400 中文零写入；分身调 list_workers/get_worker_result/mission_status 正常（爬根不 404）、懒建 miss 404'
  - '层0收口 test_subsession_recursion_converge_layer0.py——分身调 converge_mission 403；主控 X-Session-Id 正常；用户 JWT（Bearer）豁免；apiKey 无 Bearer 无 X-Session-Id 裸调 403（D-007@v1 通道嗅探）'
  - '全树 test_subsession_recursion_full_tree.py——孙 worker_done 可用（成员校验含孙，summary 挂首 run）；三口径含孙（MAX_WORKERS 计数/成本 union/cancel kill 名单）；converge 收口与 cleanup 副本清理含孙；workers_all_terminal_with_stats 含孙（孙未完成不误发唤醒）；摘要一层直查+sub_workers_count 折叠计数；无孙存量 mission 与一层枚举等价（FR-08 零回归）'
  - '预算强收 test_subsession_recursion_budget_force_end.py——触顶（含孙未完成）批量强收后 mission derive degraded 且 converge 可置位；标记先落库；未触顶不误收；会话闸 test_subsession_recursion_session_limit.py——闸拒绝后首 run failed+从未 ready+parent 非空 → 子会话 failed+ended_at 终态可收敛；追问轮中途失败的存活分身不误杀（D-006@v1）；restore 不受限'
  - '分层注入 sillyhub-daemon/tests/interactive/mcp-server-worker-tiers.test.ts——非叶（worker_depth=1）恰注册五件、叶（worker_depth=2）恰 worker_done 一件、converge_mission/report_progress 永不注册、旧 lease 无 worker_depth 按叶档兜底、重启后档位保持（snapshot 保档）；session-manager-session-limit.test.ts——SILLYHUB_MAX_ACTIVE_SESSIONS 超限拒绝（默认 20、0=不限）'
  - '既有断言更新（8 个 test_worker_subsession_*）仅限预期行为变更——枚举换全树、摘要 sub_workers_count 新字段、非叶简报新段、dispatch 落库多 tree_depth 值等随 task-01..08 落地而变的可见差异；随后三端全量回归收尾（backend uv run pytest / frontend pnpm test / sillyhub-daemon pnpm test 全绿）'
acceptance:
  - '三端全量测试全绿（backend / frontend / sillyhub-daemon）'
  - 'test_subsession_recursion_* 覆盖集成冒烟路径——分身派孙（parent/depth 落库）→ 孙 worker_done 可用 → 全树收敛；孙调 dispatch 400；分身调 converge 403；预算触顶强收后 mission 可收敛 degraded；会话闸拒绝后子会话 failed 且 mission 不卡死'
  - '递归双保险守护断言存在——backend 深度门 400 + daemon 叶档单工具（D-001@v1/D-002@v1 验收）'
  - '无孙存量 mission 全量回归零失败（FR-08 brownfield 零回归）'
verify:
  - cd backend && uv run pytest -q --no-cov
  - cd frontend && pnpm test
  - cd sillyhub-daemon && pnpm test
constraints:
  - '既有断言更新仅限预期行为变更——判据、枚举范围、注入形态、展示字段随 task-01..08 落地而改变属预期行为变更而非测试逻辑有误，禁止为通过而弱化或删除断言（CLAUDE.md 规则 9 边界）'
  - '本卡只改测试不改源码——回归暴露实现缺陷时回对应任务卡修复后重跑，不在本卡顺手修实现'
  - '新增测试文件限定 allowed_paths 枚举的 test_subsession_recursion_* 五件与 daemon interactive 两件，不散落其它目录'
  - 'daemon 测试不依赖真实 backend——hub-client mock 契约对齐转发端点路径与 payload 字段'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
