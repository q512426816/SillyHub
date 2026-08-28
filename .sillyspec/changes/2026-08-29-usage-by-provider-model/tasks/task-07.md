---
id: task-07
title: 'stream-json message_start 计数器 + task-runner stats 带 model/api_requests + hub-client 透传'
title_zh: 'stream-json message_start 计数器 + task-runner stats 带 model/api_requests + hub-client 透传'
author: 'qinyi'
created_at: 2026-08-29 02:52:55
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-01-4, FR-02-2]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/adapters/stream-json.ts
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/hub-client.ts
goal: >
  batch 侧：adapter 暴露 message_start 计数（reset 清零）；task-runner complete stats 带 model（ProviderConfig ?? unknown）与 api_requests；hub-client body 透传。
implementation:
  - stream-json.ts _messageStartCount + getter
  - task-runner lastStats 组装两字段
  - hub-client completeLease body 条件透传
acceptance:
  - 真实事件流计数==num_turns（沿用 08-29 实测 fixture 口径）
  - undefined 不写保持老链路兼容
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/stats-passthrough.test.ts tests/stream-json.test.ts
constraints:
  - 计数器与 resetAccumulator 同生命周期
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
