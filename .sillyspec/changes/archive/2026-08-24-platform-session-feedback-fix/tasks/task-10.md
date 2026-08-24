---
id: task-10
title: 'Backend tests cover new SSE events and plan-response endpoint'
title_zh: '后端测试覆盖新事件与 plan-response 端点'
author: 'qinyi'
created_at: 2026-08-24 11:07:30
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/tests/test_session_plan_bash_events.py
goal: >
  为后端新增的 plan/bash SSE 事件发布与 plan-response REST 端点补充 pytest 覆盖，
  确保事件 payload、频道路由、状态机转换及错误码符合 design.md 契约。
implementation:
  - 新建 backend/app/modules/daemon/tests/test_session_plan_bash_events.py
  - 按 design.md 中 PlanModeEnteredEvent / BashStatusEvent / BashChunkEvent 构造 payload，
    断言 redis.publish 发到 agent_session:{session_id} 频道
  - 调用 plan-response 端点，验证 200/404/422 行为及 WebSocket 通知 daemon 的消息内容
  - 覆盖重复事件去重、会话已结束不写入等边界
acceptance:
  - pytest 通过且覆盖率不低于现有 daemon 测试平均水平
  - 所有新增断言与 design.md §接口定义一致
  - 不引入真实 Redis / 不改动生产代码
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_plan_bash_events.py -q --no-cov
constraints:
  - 仅新增测试文件，不修改生产实现来适配测试
  - mock Redis 与 WebSocket hub，避免外部依赖
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
