---
id: task-11
title: 'Daemon tests cover plan/bash event reporting'
title_zh: 'daemon 测试覆盖事件上报'
author: 'qinyi'
created_at: 2026-08-24 11:07:30
priority: P0
depends_on: ['task-03', 'task-04']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - sillyhub-daemon/tests/session-plan-bash-events.test.ts
goal: >
  为 daemon HubClient 与 session-manager 新增的 plan/bash 上报路径补充 vitest 覆盖，
  验证 HTTP 调用方法、URL、body 及 session-manager 在 turn 事件流中的触发时机。
implementation:
  - 新建 sillyhub-daemon/tests/session-plan-bash-events.test.ts
  - mock global fetch，验证 HubClient.notifyPlanModeEntered / notifyBashStatus / notifyBashChunk
    的 URL、method、鉴权头、字段透传
  - stub session-manager turn 事件流，验证 plan/Bash 识别后调用对应 notify 方法
  - 覆盖重复上报抑制、未知 event 忽略、HubHttpError 透传等边界
acceptance:
  - vitest 通过且断言与 design.md / plan.md 契约一致
  - 测试不发起真实网络请求
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/session-plan-bash-events.test.ts
constraints:
  - 仅新增测试文件，不修改生产实现来适配测试
  - 使用项目现有 fetch mock 风格（vi.stubGlobal）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
