---
id: task-03
title: 'group message ingest and mention routing pipeline'
title_zh: '群消息与@触发管线'
author: 'qinyi'
created_at: 2026-09-02 00:35:00
priority: P0
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-05, FR-06, FR-07, FR-08]
decision_ids: [D-001@v1, D-002@v1, D-004@v1, D-005@v1, D-007@v1, D-010@v1]
allowed_paths:
  - backend/app/modules/daemon/group/service.py
  - backend/app/modules/daemon/group/router.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/agent/placement.py
  - backend/app/modules/daemon/tests/test_group_mention_pipeline.py
goal: >
  群消息端点（载体 run + user_input 落库 + 群频道 log 事件）→ @解析 → 影子会话懒建（grants 授权）→ 注入组装（成员简报+群背景摘要+当前消息）→ 忙轮排队，打通群聊核心触发链路。
implementation:
  - POST group-message 端点——载体 run status='completed' 且写 started_at、AgentRunLog channel='user_input' 落库、publish 群频道 log 事件带 sender 身份（sender_member_name/sender_user_id）
  - _parse_group_mentions——全/半角 @、@全体/@all、display_name 精确匹配、边界规则；@全体并行触发全部 agent 成员，未 @ 消息仅落时间线不触发
  - 影子会话懒建照 worker 三件套——直接 ORM 建行 config manual_approval=False + prepare_interactive_dispatch；机器授权走 skip_owner_check=False + workspace_id grants 分支 + allowed_roots 预检（不照抄 worker 豁免）；仅首次触发懒建并回填 shadow_session_id
  - 注入 prompt 组装——成员简报（昵称/成员列表/仅被 @ 回应规则）+ 群背景摘要（最近 N 条含投影行、带身份标签、单条截 500 字）+ 当前消息
  - 忙轮排队——AgentSessionQueuedMessage 挂影子会话、sender_user_id=实际发送者、prompt 拼入摘要快照、链 metadata source_carrier_run_id/chain_depth 透传、满 5 条 409；自带 pytest test_group_mention_pipeline.py
acceptance:
  - 群消息 @解析矩阵测试通过；未 @ 消息仅落时间线不触发，影子懒建只在首次触发发生
  - 非群主机器无 grant 返回 400、有 grant 放行（grants 两路覆盖）
  - 排队满 5 条返回 409，入队快照按入队时刻冻结
verify:
  - cd backend && uv run pytest -q app/modules/daemon/tests/test_group_mention_pipeline.py
  - cd backend && uv run ruff check app && uv run mypy app
constraints:
  - 影子会话 parent_session_id 恒 NULL（D-007，经成员表 shadow_session_id 反向指针关联）
  - 不走 create_session 路径——审批开关生效位在 AgentSession.config 列
  - 群会话 change_id 恒 NULL（首期群不绑 change）
expects_from:
  - task-01: AgentGroupChat/AgentGroupMember 模型字段（六要素列、shadow_session_id、context_window）
  - task-02: group service 骨架与 _require_group_member 权限分支
provides:
  - contract: 影子会话懒建与注入管线
    fields: [shadow_session_id, source_carrier_run_id, chain_depth]
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
