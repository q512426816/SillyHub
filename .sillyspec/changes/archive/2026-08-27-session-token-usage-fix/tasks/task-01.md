---
id: task-01
title: 'R-09 spike: verify SDK result usage vs daemon turn-level accumulation on real session'
title_zh: 'R-09 spike——真实会话验证 SDK result usage 与 daemon 轮级累计一致性（结论记 QUICKLOG，偏差 >5% 则 task-05 启用 fallback）'
author: 'qinyi'
created_at: 2026-08-27 23:57:01
priority: P1
depends_on: []
blocks: ['task-05']
requirement_ids: [FR-02]
decision_ids: [D-001@v2]
allowed_paths:
  - .sillyspec/changes/2026-08-27-session-token-usage-fix/spike-r09.md
  - sillyhub-daemon/src/interactive/session-manager.ts
goal: >
  在真实多轮会话（含子代理更佳）上对照 daemon 流内逐 message_start input_tokens 求和
  与该轮终态 SDK result usage（DB agent_runs 落库值），验证 R-09 假设（SDK result =
  本轮 Σ per-call），决定 task-05 close 终态覆盖是否加 fallback 守卫。
implementation:
  - 在 sillyhub-daemon/src/interactive/session-manager.ts 的 _bufferPartial（message_start 分支）与 _onResult 加临时观测日志（逐 call input_tokens 与轮累计），补丁仅本 task 内使用、结束前还原
  - 本地起 daemon+backend 跑真实会话 ≥2 轮（尽量含子代理 Task 调用），逐轮记录两路数值并计算偏差率（阈值 5%）
  - 结论写入 .sillyspec/changes/2026-08-27-session-token-usage-fix/spike-r09.md：逐轮数据表 + 偏差 + 对 task-05 的唯一明确决策（≤5% 维持权威覆盖 / >5% 加「仅当 result > 实时值才覆盖」守卫），并按 plan Spike 节同步 QUICKLOG 条目
  - 环境不可跑真实会话时走 plan.md Spike 节降级路径：依据 turn 1 DB 实证（会话 64dca456 两路均 1,092,740）推定维持权威覆盖，spike-r09.md 记录降级依据与残留风险（显式标注未实测多轮）
  - 还原 session-manager.ts 临时补丁，确认 git diff 零残留
acceptance:
  - spike-r09.md 存在且含实测（或降级）路径说明、逐轮两路数值与偏差、对 task-05 的唯一明确决策
  - sillyhub-daemon/src/interactive/session-manager.ts 无临时日志残留（git diff 无该文件改动）
verify:
  - cd sillyhub-daemon && git diff --stat src/interactive/session-manager.ts
  - cd sillyhub-daemon && pnpm test -- --run tests/interactive/session-manager-usage-cache.test.ts
constraints:
  - 临时日志补丁必须在本 task 内还原，不提交、不并入 task-02 实现
  - 纯观测 spike：不改任何生产逻辑与接口；fallback 实现归 task-05，本 task 只出结论
  - 偏差判定阈值 5%（plan Spike 通过标准）；降级路径结论必须显式标注「未实测多轮」
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
