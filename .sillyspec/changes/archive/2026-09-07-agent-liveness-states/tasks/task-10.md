---
id: task-10
title: 'codex deriver（E-02 词汇表规则）+ fixture 单测'
title_zh: 'codex deriver（E-02 词汇表规则）+ fixture 单测'
author: 'qinyi'
created_at: 2026-09-07 13:43:27
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-003@v1]
expects_from:
  task-01:
    - contract: liveness_deriver
      needs: [LivenessState, DeriverInput, DeriverOutput, getDeriver]
allowed_paths:
  - sillyhub-daemon/src/agent-log/liveness/derive-codex-rollout.ts
  - sillyhub-daemon/src/agent-log/liveness/registry.ts
  - sillyhub-daemon/tests/agent-log/liveness/derive-codex.test.ts
target_files:
  - NEW:sillyhub-daemon/src/agent-log/liveness/derive-codex-rollout.ts
  - NEW:sillyhub-daemon/tests/agent-log/liveness/derive-codex.test.ts
  - NEW:sillyhub-daemon/src/agent-log/liveness/registry.ts
goal: >
  按 E-02 实证词汇表（本机 136 文件/13822 条 event_msg 全清单，18 型无 approval 类，
  approval_policy="never"）实现 codex rollout 的 L1 活性 deriver 并注册进
  liveness/registry.ts，使 'codex-rollout-jsonl' 会话能从日志尾部推导 working/idle。
implementation:
  - 新建 sillyhub-daemon/src/agent-log/liveness/derive-codex-rollout.ts——实现 task-01 契约的 LivenessDeriver 纯函数：(tail, prev, now) => { state, evidence }，tail 逐行 JSON.parse，坏行跳过并计数，从尾部向前找最近可判定事件
  - E-02 词汇表规则落地：末尾 `event_msg.task_complete` → idle（evidence='last_event=task_complete'）；`response_item.function_call` 无配对 `function_call_output` → working（evidence 引用未配对的 call 名）；`token_count` 高频心跳 → working（evidence='token_count heartbeat'，刷新活性但不是状态转移证据的主体）
  - 明确不实现 blocked 分支：本机 codex 无 approval 场景（E-02 实证定论），blocked 供给只走第一方 PERMISSION_REQUEST 汇聚（task-06 / D-012），日志侧绝不以"没动静"推断（R-01）
  - liveness/registry.ts 注册行加 `['codex-rollout-jsonl', deriveCodexRollout]`——key 与 CLI 上报落库 format 串逐字一致（sillyspec 仓 src/agent-session-log.js:270 'codex-rollout-jsonl'）
  - 新建 tests/agent-log/liveness/derive-codex.test.ts——fixture 覆盖：task_complete→idle / function_call 未配对→working / function_call+output 已配对再无新事件→idle / token_count 心跳尾→working / 尾部全坏行或空→unknown（不抛异常） / getDeriver 注册与未注册串行为
acceptance:
  - getDeriver('codex-rollout-jsonl') 返回 codex deriver；未注册 format 仍返回 null（L0 兜底路径不受影响）
  - fixture：末尾 task_complete → state=idle 且 evidence 含 task_complete
  - fixture：末尾 function_call 无配对 function_call_output → state=working
  - fixture：token_count 心跳为尾部最新事件 → state=working
  - 全部 fixture 输出中不出现 blocked（E-02 定论回归项）
  - 坏行/空尾部输入不抛异常，返回可判定状态或 unknown（deriver 内自兜底，配合 tailer 的 R-02 fail-open）
verify:
  - cd sillyhub-daemon && pnpm test tests/agent-log/liveness/derive-codex.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 纯函数边界：不 import fs/网络/时钟（now 一律入参注入），不触碰 tailer/discovery（task-03/04/05 范围）
  - 不实现 blocked 分支（E-02：本机无场景；第一方权限事件是 codex blocked 的唯一供给，task-06）
  - evidence 摘要控制在 200 字符内（对齐 backend state_evidence String(200) 列宽）
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
