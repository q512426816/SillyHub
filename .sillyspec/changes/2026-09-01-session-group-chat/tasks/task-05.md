---
id: task-05
title: bridge projection of agent replies to group timeline
title_zh: 桥接投影——agent 回复投影回群时间线
author: 'qinyi'
created_at: 2026-09-02 00:35:00
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-09]
decision_ids: [D-008@v1, D-011@v1]
expects_from:
  task-03:
    - needs: [shadow_session_id 与影子 run 挂接、群载体 run（投影行 run_id 指向载体 run）]
provides:
  - contract: 群频道 SSE 事件契约
    fields: [member_id, member_name, member_session_id, sender_member_name, projection_log_id, log 事件与 turn_completed 两类]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
  - backend/app/modules/daemon/tests/test_group_bridge_projection.py
goal: >
  run_sync 两改动点——submit_messages 事务内双写投影行（新 PK）+ 群频道事件携投影行 id，
  close_interactive_run 向群频道发带成员身份的 turn_completed，让实时事件与回放读库同源同 id（FR-09，D-008@v1/D-011@v1）。
implementation:
  - submit_messages 判定 run 所属会话 kind='group_member' 时同事务插投影行——新 uuid PK（原 log_id 已被影子行占用，复用必 PK 冲突）、run_id=群载体 run、dedup_key 复用原值、channel='stdout'、content/segment_id 原值、metadata 存 member_id/member_name/source_log_id（身份按落库时刻快照）
  - 仅投影 assistant 文本段——[ASSISTANT]/[THINKING] 前缀分类同前端口径，thinking/tool 段不投影；partial 半截行透传（segment_id 语义不变），override 到达按载体 run 的 segment_id DELETE 投影行 + 群频道 stale 信号（与单聊同机制）
  - PublishIntent 加标量 group_id/member_id/member_name/member_session_id/projection_log_id——submit 时快照、publish 阶段不查库；publish_submitted_messages 向群频道 agent_session:{群id} 发 log 事件，事件内 log_id 用投影行 id（实时与回放同 id，前端 seenLogIds 去重天然兼容）
  - close_interactive_run 影子 run 收口时向群频道发 turn_completed，payload 增 member_id/member_name/member_session_id（现 payload 只有 run_id/session_id，群 UI 靠它判哪个成员说完了）
  - 自带 pytest app/modules/daemon/tests/test_group_bridge_projection.py——新 PK 无冲突/投影 id 进事件/override DELETE/partial 透传/身份快照不回填/非群场景零变化
acceptance:
  - 双写投影行与影子原行共存无 PK 冲突（新 uuid id、dedup_key 复用、metadata 身份齐全）
  - 实时群频道 log 事件与回放读库 get_agent_session_logs 同 log_id（即投影行 id），刷新回放顺序一致
  - 非群场景（单聊/worker 回流）零行为变化——无投影行、无群频道事件、PublishIntent 群标量全空
  - 群频道 turn_completed 可判成员身份（member_id/member_name/member_session_id）
verify:
  - cd backend && uv run pytest -q app/modules/daemon/tests/test_group_bridge_projection.py
  - cd backend && uv run ruff check app/modules/daemon/run_sync && uv run mypy app
constraints:
  - publish 阶段纯 Redis 不写库（双写必须全部在 submit_messages 事务内完成，PublishIntent 标量 submit 时快照）
  - 单聊/worker/quick-chat 回流路径零改动（kind 判定分支隔离，非群不进投影逻辑）
  - 投影行身份按落库时刻快照，成员改名不回填历史行
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
