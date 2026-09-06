---
id: task-02
title: '后端 DTO 与快照端点——AgentSessionTaskRead + GET /sessions/{id}/tasks（鉴权同 runs 端点，限 200 条）'
title_zh: '后端 DTO 与快照端点——AgentSessionTaskRead + GET /sessions/{id}/tasks（鉴权同 runs 端点，限 200 条）'
author: 'qinyi'
created_at: 2026-09-05 00:19:48
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-006@v1]
provides:
  - contract: AgentSessionTaskRead
    fields: [id, session_id, run_id, task_id, task_name, status, progress, summary, message, last_tool_name, tool_use_id, elapsed_ms, total_tokens, tool_uses, is_async, started_at, finished_at, updated_at]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
goal: >
  在 schema.py 新增 AgentSessionTaskRead（18 字段 snake_case 响应 DTO）并在 router.py 新增
  GET /sessions/{session_id}/tasks 快照端点（鉴权与 runs 端点同款、按 updated_at desc 限 200 条），
  为前端任务清单页签提供刷新/重连后可恢复的任务快照（FR-06）。
implementation:
  - schema.py 照 DaemonTaskLeaseRead（schema.py:808）先例新增 AgentSessionTaskRead(BaseModel)——model_config 含 from_attributes=True 读模型行；18 字段 snake_case 与 AgentTaskStatusEvent（schema.py:1219-1253）契约一一对应——id/session_id/run_id/task_id/task_name/status/progress/summary/message/last_tool_name/tool_use_id/elapsed_ms/total_tokens/tool_uses/is_async/started_at/finished_at/updated_at；事件契约名 async 在表列与 DTO 均落为 is_async（D-006）
  - router.py 照 list_session_runs（router.py:3532-3570）先例新增 GET /sessions/{session_id}/tasks，response_model=list[AgentSessionTaskRead]，依赖注入 user——TaskRunAgentUser（router.py:2295，与 runs 端点同款权限口径）
  - 鉴权与 runs 端点同款——DaemonService(session).get_agent_session(session_id, user.id) 归属/存在性校验（missing/跨用户/软删均 404 不泄露存在性）；查询内联在 router（service.py 非本卡 allowed_path，同 runs 端点口径注释）
  - 查询 select(AgentSessionTask).where(AgentSessionTask.session_id == session_id).order_by(AgentSessionTask.updated_at.desc()).limit(上限)——上限常量照 _SESSION_RUNS_MAX = 200（router.py:3529）先例定义为 _SESSION_TASKS_MAX = 200
  - 返回 AgentSessionTaskRead.model_validate 逐行列表；无任务数据的会话返回 [] 不报错（D-003 空态口径）
acceptance:
  - owner 请求 200，响应为 list[AgentSessionTaskRead]，18 字段 snake_case 齐全（含 run_id/progress/message 对齐事件契约，D-006）
  - 不存在/跨用户/软删会话返回 404；无 TASK_RUN_AGENT 权限用户被拒（与 runs 端点同口径）
  - 结果按 updated_at desc 排序且最多 200 条；空会话返回 []
  - ruff check 与 ruff format --check 通过（schema.py + router.py）
verify:
  - cd backend && uv run ruff check app/modules/daemon/schema.py app/modules/daemon/router.py && uv run ruff format --check app/modules/daemon/schema.py app/modules/daemon/router.py
  - cd backend && uv run pytest app/modules/daemon/tests/test_agent_task_status_payload.py -x -q --no-cov
constraints:
  - 端点行为测试归 task-04，本卡不新增测试
  - 快照只读，不做按 run 分组/关联消费（design 非目标第 5 条）；run_id 仅随事件入库展示
  - 不改 service.py 与 agent_task_store.py（后者 task-03 范围）；DTO 字段名一律 snake_case（D-006 对齐事件契约）
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
