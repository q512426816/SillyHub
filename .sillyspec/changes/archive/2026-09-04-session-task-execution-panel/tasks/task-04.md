---
id: task-04
title: '后端测试——upsert 语义/快照端点/会话删除级联用例'
title_zh: '后端测试——upsert 语义/快照端点/会话删除级联用例'
author: 'qinyi'
created_at: 2026-09-05 00:19:48
priority: P0
depends_on: [task-01, task-02, task-03]
blocks: []
requirement_ids: [FR-05, FR-06]
decision_ids: [D-006@v1]
expects_from:
  task-02:
    - contract: AgentSessionTaskRead
      needs: [id, session_id, run_id, task_id, task_name, status, summary, message, elapsed_ms, started_at, finished_at, updated_at]
allowed_paths:
  - backend/app/modules/daemon/tests/
goal: >
  新增 test_agent_session_tasks.py，用 pytest 用例锁定 agent_session_task 的 upsert/终态定格语义、
  GET /sessions/{session_id}/tasks 的鉴权与限条形状、以及会话删除级联，作为 FR-05/FR-06 的自动化验收证据。
implementation:
  - 新建 backend/app/modules/daemon/tests/test_agent_session_tasks.py——HTTP 侧对齐 test_session_plan_bash_events.py 的 harness（client + auth_headers + mocked Redis），helpers 照 test_agent_task_status_payload.py 的复用先例（_admin_id / _create_runtime / _create_session_with_run / _mock_redis 等），文件头 docstring 注明所属变更/任务
  - upsert 语义组——首事件建行（started_at 置位、status 取事件值）；同 (session_id, task_id) 后续事件刷新字段不重复建行；summary/elapsed_ms/total_tokens 等非 None 值更新；事件 Optional 字段 None 不清空既有值
  - 终态定格组——running 到 completed/failed/stopped 置 finished_at；终态后再收 running——status 保持终态、finished_at 不清除、字段不刷新；后到异种终态允许覆盖
  - 快照端点组——owner 请求 200 且逐字段断言 AgentSessionTaskRead 18 字段 snake_case 形状；不存在/跨用户/软删会话 404；无 TASK_RUN_AGENT 权限用户被拒（TaskRunAgentUser 口径）；多行按 updated_at desc 排序；造超过 200 行断言最多返回 200 条；无任务会话返回 []
  - 会话删除级联组——删除 agent_sessions 行后其 agent_session_task 行级联清理（注意 conftest 的 db_engine 是 SQLite 内存库且默认不开 FK 强制——测试内对连接开 PRAGMA foreign_keys=ON 后删行断言级联，或按 conftest 既有口径以模型 ondelete 声明为断言对象，二选一在实现时定）
  - 持久化旁路组——monkeypatch upsert 抛异常，POST /sessions/{id}/agent-task-status 仍返回 200 且 publish 已发生（FR-05 非功能「可回退」）
acceptance:
  - cd backend && uv run pytest app/modules/daemon/tests/test_agent_session_tasks.py -x -q --no-cov 全绿
  - 用例覆盖 plan task-04 验收点——upsert（新插/更新/终态定格）、快照端点（鉴权/形状/限 200 条）、会话删除级联
  - 既有 test_agent_task_status_payload.py 保持全绿（notify 端点邻接回归）
  - 非测试逻辑有误时禁止改测试迁就——发现实现缺陷回改 task-01/02/03 范围文件（编辑前先拉最新）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_agent_session_tasks.py -x -q --no-cov
  - cd backend && uv run pytest app/modules/daemon/tests/test_agent_task_status_payload.py -x -q --no-cov
constraints:
  - 禁止跑全量测试（CLAUDE.md 规则 0，全量留 CI），只跑 verify 列出的两个文件
  - 测试代码 Windows 兼容（不依赖 POSIX 专属路径/权限行为）
  - Redis 一律 mock 不连真 broker（先例口径）；daemon tests conftest 的 _fast_session_readiness autouse fixture 自动生效不重复造
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
