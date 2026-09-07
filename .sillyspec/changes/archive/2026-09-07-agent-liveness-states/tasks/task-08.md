---
id: task-08
title: 'POST /agent-logs/states 端点——批量 upsert-create（origin=liveness-discovered）+ 转移检测'
title_zh: 'POST /agent-logs/states 端点——批量 upsert-create（origin=liveness-discovered）+ 转移检测'
author: 'qinyi'
created_at: 2026-09-07 13:43:27
priority: P0
depends_on: ['task-07']
blocks: []
requirement_ids: [FR-03]
decision_ids: ['D-001@v1', 'D-003@v1']
provides:
  - contract: agent_log_state_fields
    fields: [state, state_derived_at, state_evidence, last_event_at]
allowed_paths:
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/platform_sync/schema.py
  - backend/app/modules/platform_sync/tests/test_agent_log_states_push.py
target_files:
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/platform_sync/schema.py
  - NEW:backend/app/modules/platform_sync/tests/test_agent_log_states_push.py
goal: >
  新增 POST /api/agent-logs/states 批量上报端点（daemon 鉴权通道，与 /agent-logs 同
  分流）：按 (workspace_id, log_path) upsert-create 更新四状态列——自发现裸会话
  create 落库（origin 标 liveness-discovered）+ 进入 blocked 记段时间戳 + GET 响应
  透传（design §5.3/§7/§7.5，FR-03）。
implementation:
  - 'schema.py：增 AgentLogStateEntry/AgentLogStatePush 请求模型（design §7 逐字）——log_path、state Literal 五值（working/blocked/idle/ended/unknown）、evidence max_length=200、derived_at datetime、last_event_at 可空 + 行不存在时 create 用的 harness/format/agent_session_id(max 64)/agent_cwd；entries 批量上限 64；extra=ignore 宽松'
  - 'router.py：增 POST /agent-logs/states（仿 push_agent_logs :450 先例）——鉴权 _write_auth（require_platform_sync_write，仅 shpsync_，daemon 鉴权与 /agent-logs 同分流：无凭据 401 / shk_live_·JWT 403）；workspace_id 恒由 token 派生；响应 AgentLogPushOk 同款（upserted 计数，daemon 不读 body 任意 2xx 即成功）'
  - 'service.py：增 upsert_agent_log_states——按 (workspace_id, log_path) IN 批量预取（仿 upsert_agent_log_entries :999 的 ql-20260826-012 范式）：命中行定向 UPDATE 四状态列（既有 CLI 登记 upsert_agent_log_entries 列级赋值不含状态列，重推天然不清空、按既有键融合）；行不存在按 entry 最小元信息 create，detected_via 置 liveness-discovered（design §5.3 origin 标记落点 = 既有探测通道列）'
  - '转移检测：仅 state 变化时刷新 state_derived_at（进入 blocked 瞬间即段起点），同态连续上报不刷新（保留段起点；evidence/last_event_at 照常更新）——task-09 的 120s 阈值与等待时长以此段起点为数据源；方法返回转移信息（log_path/prev_state/new_state/段起点）供通知接线'
  - '新建 endpoint 测试 test_agent_log_states_push.py：鉴权矩阵（401/403/200）+ 裸会话 create 场景（元信息建行、detected_via=liveness-discovered、随后同键 CLI POST /agent-logs 登记融合同行且不清空状态列）+ 既有行定向更新 + blocked 段起点断言 + GET /agent-logs 透传四字段（旧行 unknown）+ 边界（entries 65 条 422 / state 非枚举 422 / evidence 超 200 字符 422）'
acceptance:
  - 'POST /api/agent-logs/states：shpsync_ token 200；无凭据 401；shk_live_/JWT 403（daemon 鉴权分流与 /agent-logs 同款）'
  - '裸会话 entry（无既有行）按元信息 create 落库并标记 liveness-discovered；随后 CLI 登记按既有键融合，状态列不被覆盖清空'
  - '既有行状态上报仅更新四状态列 + updated_at；同态重复上报 state_derived_at 不变，进入 blocked 时刷新为段起点'
  - 'GET /api/agent-logs 响应透传四字段；从未上报过的旧行 state 返回 unknown'
verify:
  - 'cd backend && uv run pytest app/modules/platform_sync/tests -n auto -k agent_log_states'
  - 'cd backend && uv run pytest app/modules/platform_sync/tests -n auto -k agent_log'
  - 'cd backend && uv run ruff check app/modules/platform_sync && uv run mypy app/modules/platform_sync/router.py app/modules/platform_sync/service.py app/modules/platform_sync/schema.py'
constraints:
  - '不信任 body 里的 workspace_id（token 派生唯一权威，与 /agent-logs 同款）；body 仅枚举级数据与短摘要，日志内容不入库（G-5：CLI 上报契约零变更）'
  - '本卡不做 agent_blocked 通知（task-09 范围），仅落段起点并在返回值暴露转移信息'
  - 'states 上报 best-effort：语义恒 200 成功体、无 base_ts 乐观锁；同请求内同 log_path 去重取后者（对齐既有 :999 语义）'
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
