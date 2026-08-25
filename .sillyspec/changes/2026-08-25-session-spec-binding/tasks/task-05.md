---
id: task-05
title: 'run_sync 消息入库命令解析接线（agent_session_id NULL 守卫 + 既有 run_sync 测试更新）'
title_zh: 'run_sync 消息入库命令解析接线（agent_session_id NULL 守卫 + 既有 run_sync 测试更新）'
author: 'qinyi'
created_at: 2026-08-25 22:54:07
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003@v1, D-004@v1, D-005@v2]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
  - backend/app/modules/daemon/tests/test_run_sync_agent_session_id_backfill.py
  - backend/app/modules/daemon/tests/test_run_sync_assistant_override.py
  - backend/app/modules/daemon/tests/test_run_sync_cache_parse.py
  - backend/app/modules/daemon/tests/test_run_sync_fire_background_task.py
  - backend/app/modules/daemon/tests/test_run_sync_gate_decision_task.py
  - backend/app/modules/daemon/tests/test_run_sync_gate_enqueue.py
goal: >
  run_sync 消息入库通道接线自动绑定（FR-01 主通道 / D-003）——submit_messages
  落库循环中识别 tool_kind 为 sillyspec 的 tool_call 行，json.loads(content) 取
  args.command 经 extract_spec_bindings 提取 --change 变更名，通过
  AgentRun.agent_session_id 二跳定位平台会话后调 change.binding 的
  bind_session_to_change 落 change_session_links 多对多绑定；agent_session_id
  为 NULL 的 run（batch run / 会话被删）静默跳过（X-002），绑定 best-effort
  不阻断消息入库主流程。
implementation:
  - 'submit_messages 落库循环内（tool_kind 打标判定点 L677-691 之后）对 tool_kind 为 sillyspec 且 channel 为 tool_call 的行收集待绑定命令——json.loads(content) 取 args.command；JSON 解析失败或结构不符静默跳过，不落绑定不抛错'
  - '会话定位经 run 二跳——循环后现成 AgentRun 加载点（L776 self._session.get）复用同一行，守卫 agent_run.agent_session_id 为 None 时跳过全部绑定（batch run 无会话 / 会话删除 FK 置空两类场景，X-002）；再按该 id select AgentSession 取 workspace_id，会话行不存在同样跳过'
  - '命令解析与落绑定走 task-02 公共入口——from app.modules.change.binding import extract_spec_bindings 与 bind_session_to_change；对每条收集命令 extract_spec_bindings 产出变更绑定目标（quick 子命令与 --change default 已由解析规则加 bind 内部守卫双保险跳过，D-004 / D-005@v2），逐个 bind_session_to_change(db, workspace_id, change_key, session_id)'
  - '绑定全程 best-effort——bind 函数自带 savepoint + log.warning 不抛（task-02 契约），submit_messages 的 AgentRunLog 落库、AgentRun 状态推进与 token 写回零改动，绑定失败不影响 SubmittedMessages 返回'
  - '新增绑定用例落 test_run_sync_agent_session_id_backfill.py（run 与会话归属同主题文件）——sillyspec run execute --change 变更名 的 tool_call 消息入库后 change_session_links 出现该绑定行且重放幂等；agent_session_id 为 None 不绑不抛；--change default 不绑；sillyspec run quick 的 --change 值不产生变更绑定（D-004）'
  - '既有 run_sync 测试回归——上方 6 个 submit_messages 链路测试文件全绿；断言因绑定行为失效的按新行为更新，不许删用例躲回归'
acceptance:
  - '平台会话内执行 sillyspec run 任意阶段 --change 变更名，消息经 submit_messages 入库后 change_session_links 出现该变更与会话的绑定行，重复提交不产生重复行'
  - 'AgentRun.agent_session_id 为 NULL（batch run）或 run 不存在时静默跳过绑定，消息照常入库（X-002）'
  - 'sillyspec run quick 的 --change 值（CLI quick 会话短码）与 --change default 均不产生变更绑定（D-004 / D-005@v2）'
  - '绑定路径任意异常仅 log.warning——既有 run_sync 测试断言全部保持绿'
verify:
  - cd backend && uv run pytest app/modules/daemon/tests -q -k run_sync
constraints:
  - '仅在 tool_kind 为 sillyspec 且 channel 为 tool_call 的行触发解析（R-03 低频热路径），禁止全量消息扫描；不入库的信号行（override / 去重跳过）不触发'
  - 'quicklog 绑定不经此通道——run quick 时 ql_id 未知（D-004），本卡只落变更绑定'
  - '禁止在 run_sync 重复实现 placeholder 变更行 / default 守卫 / savepoint 逻辑——一律复用 change.binding 公共函数'
  - '不改 AgentRun 状态机、token 写回与 dedup / thinking 去重逻辑；sillyhub-daemon 零改动'
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
