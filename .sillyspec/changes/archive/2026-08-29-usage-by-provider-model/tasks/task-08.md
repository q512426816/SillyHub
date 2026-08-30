---
id: task-08
title: 'daemon 测试补齐（bridge 明细/计数/缺省 + stats-passthrough batch model/requests）'
title_zh: 'daemon 测试补齐（bridge 明细/计数/缺省 + stats-passthrough batch model/requests）'
author: 'qinyi'
created_at: 2026-08-29 02:52:55
priority: P0
depends_on: ['task-06', 'task-07']
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/tests/daemon-interactive-bridge.test.ts
  - sillyhub-daemon/tests/stats-passthrough.test.ts
goal: >
  补 daemon 侧测试：bridge（明细行/计数/缺省回落）与 stats-passthrough（batch model/api_requests）。
implementation:
  - bridge：modelUsage 多模型拆行 + 分摊 + 计数 + 空对象回落既有用例零改
  - stats：message_start 计数 + model 字段断言
acceptance:
  - 新增用例全绿且既有 26+88+72 用例零回归
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/daemon-interactive-bridge.test.ts tests/stats-passthrough.test.ts tests/stream-json.test.ts tests/task-runner.test.ts
constraints:
  - 断言真实输出不 mock 被测方法
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
