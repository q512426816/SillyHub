---
id: task-03
title: '后端持久化写入——上报端点接入 upsert（终态定格 + started_at/finished_at 维护，持久化旁路失败不影响 SSE 转发）'
title_zh: '后端持久化写入——上报端点接入 upsert（终态定格 + started_at/finished_at 维护，持久化旁路失败不影响 SSE 转发）'
author: 'qinyi'
created_at: 2026-09-05 00:19:48
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-006@v1]
expects_from:
  task-01:
    - contract: agent_session_task
      needs: [session_id, task_id, status, started_at, finished_at]
allowed_paths:
  - backend/app/modules/daemon/agent_task_store.py
  - backend/app/modules/daemon/router.py
goal: >
  新建 agent_task_store.py 的 upsert 服务函数（与前端 applyAgentTaskStatusEvent 归约同构——终态定格、
  None 字段保留、started_at/finished_at 维护）并接入 notify_agent_task_status 上报端点，使 agent_task_status
  事件在 SSE 转发的同时落库 agent_session_task（持久化旁路失败只记日志，不影响转发与返回，FR-05）。
implementation:
  - 新建 backend/app/modules/daemon/agent_task_store.py——async def upsert_agent_task（AsyncSession + AgentTaskStatusEvent 入参），按 (session_id, task_id) 查行做 insert-or-update 单行写入（R-03 控写放大，不做事件流水表）
  - upsert 语义与前端归约（session-panel.tsx:6527 applyAgentTaskStatusEvent）同构——①首事件插入新行且 started_at=now(UTC)，此后 started_at 不再变；②行已是终态（completed/failed/stopped）时再收 running 整行跳过（终态定格不回退，任何字段不刷新）；③后到的异种终态允许覆盖（如 completed 后到 failed 以最新终态为准）并置 finished_at=now(UTC)；④Optional 字段（progress/summary/message/last_tool_name/tool_use_id/elapsed_ms/total_tokens/tool_uses/is_async）事件为 None 时保留行内旧值（服务端累计量只增不减），非 None 值逐次覆盖；⑤每次写入维护 updated_at=now(UTC)（快照排序键）
  - router.py notify_agent_task_status（router.py:2067-2094）在 publish_session_event 转发之外调用 upsert——try/except 包裹 + logger.exception 记日志，持久化失败不影响 SSE 转发与端点正常 200 返回（持久化旁路，design §兼容策略/非功能「可回退」）
  - 转发与落库彼此独立不做强事务绑定（SSE 主链路优先，落库失败零影响）
acceptance:
  - 同一 (session_id, task_id) 连续上报只产生一行——首事件建行 started_at 非空，后续事件刷新字段不新建行
  - running 到终态后 finished_at 置位；终态后再收 running——status 不回退、finished_at 不清除、字段不刷新（终态定格）
  - 事件 Optional 字段为 None 不清空行内既有值（累计量只增不减）
  - upsert 抛异常时 notify 端点仍返回 200 且 publish_session_event 已执行（旁路失败只记日志）
  - ruff check 与 ruff format --check 通过（agent_task_store.py + router.py）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_agent_task_status_payload.py -x -q --no-cov
  - cd backend && uv run ruff check app/modules/daemon/agent_task_store.py app/modules/daemon/router.py && uv run ruff format --check app/modules/daemon/agent_task_store.py app/modules/daemon/router.py
constraints:
  - 用例级测试归 task-04，本卡不新增测试文件
  - 不改 publish_session_event / run_sync（SSE 主链路零改动）；不改 schema.py 与 GET 端点（task-02 范围）
  - router.py 与 task-02 共享——编辑前先拉最新文件；代码 Windows 兼容
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
