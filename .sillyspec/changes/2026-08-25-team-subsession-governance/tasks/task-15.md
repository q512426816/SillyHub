---
id: task-15
title: '测试补全（backend + daemon）+ 三端全量回归 + 预期行为变更的既有断言更新（test_control_orchestrator_exclusion / test_session_team_mission / test_team_mission_create_block / test_mission_status / test_patrol / test_converge_mission_reentrant / cli-session-manager-injection / session-manager-main-agent-mcp）'
title_zh: '测试补全（backend + daemon）+ 三端全量回归 + 预期行为变更的既有断言更新（test_control_orchestrator_exclusion / test_session_team_mission / test_team_mission_create_block / test_mission_status / test_patrol / test_converge_mission_reentrant / cli-session-manager-injection / session-manager-main-agent-mcp）'
author: 'qinyi'
created_at: 2026-08-25 20:57:40
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05', 'task-06', 'task-07', 'task-08', 'task-09', 'task-10', 'task-11', 'task-12', 'task-13', 'task-14']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-004@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/agent/tests/test_worker_subsession_dispatch.py
  - backend/app/modules/agent/tests/test_worker_subsession_worker_done.py
  - backend/app/modules/agent/tests/test_worker_subsession_lifecycle.py
  - backend/app/modules/agent/tests/test_control_orchestrator_exclusion.py
  - backend/app/modules/agent/tests/test_converge_mission_reentrant.py
  - backend/app/modules/agent/tests/test_mission_status.py
  - backend/app/modules/agent/tests/test_patrol.py
  - backend/app/modules/daemon/tests/test_session_team_mission.py
  - backend/app/modules/daemon/tests/test_team_mission_create_block.py
  - sillyhub-daemon/tests/cli-session-manager-injection.test.ts
  - sillyhub-daemon/tests/interactive/session-manager-main-agent-mcp.test.ts
  - sillyhub-daemon/tests/interactive/mcp-server-worker-done.test.ts
related_tests:
  - backend/app/modules/agent/tests/test_control_orchestrator_exclusion.py
  - backend/app/modules/agent/tests/test_converge_mission_reentrant.py
  - backend/app/modules/agent/tests/test_mission_status.py
  - backend/app/modules/agent/tests/test_patrol.py
  - backend/app/modules/daemon/tests/test_session_team_mission.py
  - backend/app/modules/daemon/tests/test_team_mission_create_block.py
  - sillyhub-daemon/tests/cli-session-manager-injection.test.ts
  - sillyhub-daemon/tests/interactive/session-manager-main-agent-mcp.test.ts
goal: >
  为 task-01 至 task-14 的全链路补齐自动化守护并收尾三端全量回归——新增
  backend test_worker_subsession_*（三元组派发、worker_done、判据替换、批量
  收口、双判据兼容）与 daemon 受限注入测试，更新 8 个既有测试文件中因预期
  行为变更而失效的断言，跑通 backend / frontend / daemon 三端全量。
implementation:
  - 新增 test_worker_subsession_dispatch.py——三元组派发（parent 关系、owner=mission.created_by、lease metadata.stage、首 run 双标记、同事务原子）；worktree 失败分身标 failed 不崩 mission；跨 ws 代表机器钉定
  - 新增 test_worker_subsession_worker_done.py——置位 worker_done_at、summary artifact 挂首 run、追问重开工后回到未完成再完成（SETNX 幂等键随重开工 DEL）、mission 已终态迟到调用 409 不写状态
  - 新增 test_worker_subsession_lifecycle.py——判据替换（分身 idle 未 done 不误判完成、不触发超时收敛、不删未完成分身 worktree）、converge 沿树批量 end_session（冲突路径不收口）、cancel 名单含子会话、patrol 孤儿补收口、存量 batch 双判据行为不变
  - 新增 daemon tests/interactive/mcp-server-worker-done.test.ts——受限模式 env 门控单工具注册与 worker_done 转发契约（mock hub-client，对齐 task-07 端点）
  - 更新 8 个既有测试的预期行为变更断言——test_control_orchestrator_exclusion（cancel 名单与 cost union）、test_session_team_mission 与 test_team_mission_create_block（摘要 workers 行化 sub_session_id 与 first_run_id）、test_mission_status（derive 换 mission_derive_status）、test_patrol（孤儿子会话扫描与超时时钟口径）、test_converge_mission_reentrant（busy 前置换 is_worker_complete 与收口时序）、cli-session-manager-injection 与 session-manager-main-agent-mcp（mission_worker 三态注入）
  - 三端全量回归收尾——backend 与 frontend 与 daemon 全量测试全绿（plan 全局验收标准 1 至 4 逐条核对）
acceptance:
  - 三端全量测试全绿（backend uv run pytest、frontend pnpm test、daemon pnpm test）
  - test_worker_subsession_* 覆盖集成冒烟路径——派团队分身以子会话形态创建（parent 关系与 owner=创建者）、worker_done 后 mission 状态经 mission_derive_status 正确流转、converge 后子会话全部 ended 且清理只发生在已完成分身
  - 分身工具列表只含 worker_done 的守护断言存在（递归闸守护，D-003@v1 验收）
  - 存量 mission（未派团队与 batch 分身）行为断言保留且全绿（brownfield 零回归）
verify:
  - cd backend && uv run pytest -q --no-cov
  - cd frontend && pnpm test
  - cd sillyhub-daemon && pnpm test
constraints:
  - 既有断言更新仅限预期行为变更——判据、数据源、注入形态随 task-01 至 task-14 落地而改变，属预期行为变更而非测试逻辑有误，禁止为通过而弱化或删除断言（CLAUDE.md 规则 9 边界）
  - 本卡只改测试文件不改源码——回归暴露实现缺陷时回对应任务卡修复后重跑
  - 新增测试文件限定 allowed_paths 枚举的四个新文件，不散落其它目录
  - daemon 测试不依赖真实 backend——hub-client mock 契约对齐 task-07 端点路径与 payload 字段
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
