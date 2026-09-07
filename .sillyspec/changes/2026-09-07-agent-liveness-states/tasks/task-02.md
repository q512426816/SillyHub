---
id: task-02
title: 'zcode deriver（E-03 实证规则）+ fixture 单测'
title_zh: 'zcode deriver（E-03 实证规则）+ fixture 单测'
author: 'qinyi'
created_at: 2026-09-07 13:43:27
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/agent-log/liveness/derive-zcode-model-io.ts
  - sillyhub-daemon/src/agent-log/liveness/registry.ts
  - sillyhub-daemon/tests/agent-log/liveness/derive-zcode.test.ts
target_files:
  - NEW:sillyhub-daemon/src/agent-log/liveness/derive-zcode-model-io.ts
  - NEW:sillyhub-daemon/src/agent-log/liveness/registry.ts
  - NEW:sillyhub-daemon/tests/agent-log/liveness/derive-zcode.test.ts
goal: >
  实现 zcode model-io 格式的 L1 活性推导器（E-03 实证规则：completedAt 新鲜或 toolCalls 未配对即 working，静默即 idle，永不产 blocked）并注册进 liveness 注册表。
implementation:
  - 新建 derive-zcode-model-io.ts 实现 LivenessDeriver：定位 tail 末条有效 model_io 行（行结构校验与 parse-zcode-model-io.ts 实证 schema 同口径、按尾部判定轻量独立实现）；末行 completedAt 距 now ≤ QUIET_MS → working，evidence 记 last_event=model_io。
  - 末行 response.toolCalls 非空且无后续行 → working（工具执行中，evidence 附 toolCalls 计数）；末行事件超 QUIET_MS → idle；tail 空/全坏行 → unknown 交 L0 兜底；QUIET_MS 等常量模块导出可注入。
  - 修改 liveness/registry.ts 增注册行：键 zcode-model-io-jsonl → 本 deriver（键与 platform_agent_logs.format 逐字一致，扩展点模式同既有 agent-log/registry.ts）。
  - 新建 tests/agent-log/liveness/derive-zcode.test.ts fixture 单测：新鲜 completedAt→working、toolCalls 未配对→working、超静默→idle、空/坏行→unknown。
acceptance:
  - fixture「末行 completedAt 新鲜」推导为 working，「超 QUIET_MS 无新事件」推导为 idle。
  - 全部用例断言 state 不为 blocked（E-03 实证 model_io 无 CLI 交互层事件，R-01 无正向证据不产 blocked）。
  - getDeriver 对 zcode-model-io-jsonl 返回非 null（注册行生效，task-03 tailer 可分派）。
verify:
  - cd sillyhub-daemon && pnpm test -- tests/agent-log/liveness/derive-zcode.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 纯函数约束：不读文件系统/时钟，now 经 DeriverInput 注入，fixture 零 mock。
  - 不修改既有 agent-log/registry.ts 与 parse-zcode-model-io.ts（schema 词汇同源但不 import 其私有函数）。
  - 不实现 blocked 分支（zcode 永久 L0+working/idle，design §5.1）。
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
