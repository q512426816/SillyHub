---
id: task-04
title: agent cross-mention guardrails and hot config switch
title_zh: 互@协作护栏与配置热切换
author: 'qinyi'
created_at: 2026-09-02 00:35:00
priority: P0
depends_on: ['task-03', 'task-05']
blocks: []
requirement_ids: [FR-10, FR-11]
decision_ids: [D-006@v1, D-004@v1]
expects_from:
  task-03:
    - needs: [触发管线与注入组装（@解析、懒建/注入/忙轮排队）]
  task-05:
    - needs: [turn_completed 挂接点与成员身份字段（member_id/member_name/member_session_id）]
provides:
  - contract: 互@护栏与热切换分支
    fields: [agent_cross_mention, cross_mention_depth, group_chain, group_rate]
allowed_paths:
  - backend/app/modules/daemon/group/service.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/tests/test_group_cross_mention.py
goal: >
  turn_completed 后对 agent 回复最终文本跑 @ 检测触发对应成员（与用户 @ 同管线、注入标注来源成员）
  + Redis 防环护栏 + agent 成员六要素 diff 热切换两分支（FR-10/11，D-006@v1/D-004@v1）。
implementation:
  - 互@检测挂接 task-05 的 close_interactive_run turn_completed 路径——读群开关 agent_cross_mention，对回复最终文本跑 _parse_group_mentions，命中成员走 task-03 触发管线，注入 prompt 当前消息标注为来自 Agent 成员「X」的协作请求
  - Redis 防环护栏（全带 TTL 自清理不建表）——group_chain:{载体run_id} Hash 存链内成员去重集与 depth 计数（TTL 30min，触发时成员去重 SADD/查重 + depth INCR）；group_rate:{群id}:{成员id} INCR+EXPIRE 60s 滑窗限频默认每分钟 6 次，超限群内系统提示
  - 护栏判定与链 id——深度达 cross_mention_depth（默认 2）不再触发（可再 @ 但只作纯文本）；同链同成员最多触发一次；不自我触发（回复中 @自己 忽略）；链 id=触发用户消息载体 run id，互@触发读取注入 run metadata 的 source_carrier_run_id/chain_depth（task-03 写入），Redis 可判 + DB run metadata 可查双轨一致
  - 热切换——PATCH 成员六要素 diff——provider/llm_provider/agent_profile 变更走 SESSION_SWITCH_CONFIG（inject_session_as_service 服务身份下发，当前轮结束边界 reload，下轮生效）并同步影子会话三列；runtime/workspace 变更 end 旧影子 + shadow_status='pending' + 下次触发懒重建（记忆重置，接口层已提示确认）
  - 自带 pytest app/modules/daemon/tests/test_group_cross_mention.py——护栏矩阵（同轮去重/深度到顶/限频超限/不自我/开关关闭纯文本）+ 热切换两分支
acceptance:
  - A 回复最终文本含 @B 触发 B 且注入 prompt 标注来源成员身份
  - 深度 2 到顶不再触发；同链同成员去重；限频超限群内系统提示
  - 关闭 agent_cross_mention 后 agent 回复中的 @ 为纯文本零触发
  - 模型/引擎/方案切换下轮生效且独立记忆延续；机器/工作区切换影子重建记忆重置
verify:
  - cd backend && uv run pytest -q app/modules/daemon/tests/test_group_cross_mention.py
  - cd backend && uv run ruff check app/modules/daemon && uv run mypy app
constraints:
  - 护栏状态只存 Redis（带 TTL 自清理，不建表不留死键）
  - 链 id=触发用户消息载体 run id 并经 run metadata 双轨记录
  - 不自我触发（成员回复 @自己 忽略）
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
