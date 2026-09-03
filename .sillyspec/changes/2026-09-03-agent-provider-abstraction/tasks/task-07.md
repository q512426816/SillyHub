---
id: task-07
title: 'backend _persist_agent_event 分支与 SSE agent_event 透传（兼容轨保留）'
title_zh: 'backend _persist_agent_event 分支与 SSE agent_event 透传（兼容轨保留）'
author: 'qinyi'
created_at: 2026-09-03 23:55:50
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001@v1, D-004@v1, D-003@v1]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
  - backend/app/modules/daemon/tests/test_run_sync_agent_events.py
goal: >
  backend submit_messages 双轨接收：识别 kind='agent_event' 消息 → _persist_agent_event
  （文本行合成+既有结构化列+metadata_.agent_event+override 撤回+usage 实时+session pin 无行化），
  旧形态走原 _extract_sdk_messages 兼容轨（FR-03 / D-001@v1 / D-004@v1 / D-003@v1）。
implementation:
  - submit_messages 主循环：msg 为 dict 且 msg.get('kind')=='agent_event' → 新分支 _persist_agent_event(ev=msg['event'])；无 kind 键消息原路径不动（service.py:1039-1046 分发点前插）
  - _persist_agent_event：①按现行为合成同款文本行——text→[ASSISTANT]/thinking→[THINKING]/tool_use→[TOOL_USE] name: args/tool_result→[TOOL_RESULT]（前缀拼装与 _extract_sdk_messages 现状逐字一致）②结构化列填充（tool_kind 走现有 tool_kind.py 映射、parent_tool_use_id/subagent_type/depth/segment_id/edit_patch 直填）③metadata_={'agent_event': ev}（不与群聊投影键冲突，merge 不覆盖）④channel 推导（error→stderr 其余 stdout；tool 事件双写 tool_call 通道对齐现状）
  - override:true+segment_id → 先 DELETE (run_id, segment_id) 已落库 partial 再 INSERT（对齐现有 stale 撤回链，service.py:1155/1218 语义）
  - usage：任意携带 usage 的事件（含 partial）→ agent_runs token 统计更新 + SSE summary 透传（复用现 input_tokens/output_tokens/cache_* summary 通道）；status/session_started（session_id）→ resume 指针守卫更新（对齐 service.py:1687-1707）；status 其余 subtype 不落行不处理（daemon 侧已被 onSessionEvent 消费）
  - publish payload：published_logs 与 session_payload 增可选 agent_event 字段（取自 metadata_['agent_event']，.get() 容错）
  - tests/test_run_sync_agent_events.py：每型事件落库断言（列值+metadata_+文本行前缀逐字）；override 撤回；usage 实时更新+SSE summary；session pin；旧形态兼容轨回归用例
acceptance:
  - agent_event 落库行与旧路径同事件产物逐字段等价（文本行前缀逐字一致+结构化列+metadata_）
  - override 撤回后 DB 无残留 partial 行；SSE 无 stale
  - 旧形态（无 kind）消息行为与现状完全一致（兼容轨测试）
  - 零 DB 迁移（不加列）；LeaseMessagesRequest schema 不变
verify:
  - cd backend && python -m pytest app/modules/daemon/tests/test_run_sync_agent_events.py -q
  - cd backend && python -m pytest app/modules/daemon/tests/ -q -k "run_sync" （相关既有套件零回归）
constraints:
  - _extract_sdk_messages 不删不改（退役为后续 change）；本 task 只加分支
  - 文本行合成必须与现状逐字一致（未升级前端渲染依赖它）
  - 中文报错文案遵守 test_error_message_l10n 守护
expects_from:
  - task-01: AgentEvent wire 形态（kind:'agent_event' 载荷契约）
related_tests:
  - backend/app/modules/daemon/tests/test_run_sync_assistant_override.py（override 语义对齐参照）
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
