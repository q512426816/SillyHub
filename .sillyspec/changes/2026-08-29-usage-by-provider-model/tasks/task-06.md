---
id: task-06
title: 'daemon.ts _modelUsageRows 明细行 + run 级 assistant 消息计数 → payload.model_usage/api_requests'
title_zh: 'daemon.ts _modelUsageRows 明细行 + run 级 assistant 消息计数 → payload.model_usage/api_requests'
author: 'qinyi'
created_at: 2026-08-29 02:52:55
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-01-3, FR-02-1]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
goal: >
  interactive 终态 payload 新增 model_usage[]（modelUsage 逐 key 拆行 camel→snake）与 api_requests（run 级 assistant 消息计数含子代理）。
implementation:
  - _aggregateModelUsage 旁拆 _modelUsageRows（明细分摊 requests 按 input+output 占比，残差给最大模型）
  - onTurnMessage 桥接 per-run assistant 计数（turn 换 run 清零）
  - payload 组装：modelUsage 缺失两字段不写
acceptance:
  - 真实 modelUsage fixture 拆行正确且分摊和==总数
  - 无 modelUsage 时 payload 行为与现状一致
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/daemon-interactive-bridge.test.ts
constraints:
  - 不动 ql-20260829-002 已修的四维聚合语义；requests 分摊标注估算（design §2）
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
