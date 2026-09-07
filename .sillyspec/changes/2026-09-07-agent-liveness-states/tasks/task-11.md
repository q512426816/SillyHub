---
id: task-11
title: 'E-01 实证（spike-02）→ claude deriver（证伪则只留 working/idle 并回写结论）'
title_zh: 'E-01 实证（spike-02）→ claude deriver（证伪则只留 working/idle 并回写结论）'
author: 'qinyi'
created_at: 2026-09-07 13:43:27
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-002@v1, D-003@v1]
expects_from:
  task-01:
    - contract: liveness_deriver
      needs: [LivenessState, DeriverInput, DeriverOutput, getDeriver]
allowed_paths:
  - sillyhub-daemon/src/agent-log/liveness/derive-claude-code.ts
  - sillyhub-daemon/src/agent-log/liveness/registry.ts
  - sillyhub-daemon/tests/agent-log/liveness/derive-claude.test.ts
  - .sillyspec/changes/2026-09-07-agent-liveness-states/design.md
target_files:
  - NEW:sillyhub-daemon/src/agent-log/liveness/derive-claude-code.ts
  - NEW:sillyhub-daemon/tests/agent-log/liveness/derive-claude.test.ts
  - NEW:sillyhub-daemon/src/agent-log/liveness/registry.ts
  - .sillyspec/changes/2026-09-07-agent-liveness-states/design.md
goal: >
  实现 claude-code-jsonl deriver 的 working/idle 规则。E-01 已实证证伪（2026-09-07
  spike-02：160 个最近 transcript 扫描，顶层记录类型无"等待审批"事件——permission-mode
  仅模式切换、零审批结果/拒绝记录、关键词命中均为对话内容），blocked 分支按 D-002@v1
  定稿关闭：deriver 只产 working/idle，日志推导侧 blocked 全线不承诺（仅存第一方
  PERMISSION_REQUEST 源，D-012）。
implementation:
  - spike-02 已完成（结论：证伪，详见 plan.md Spike 表）——无需再做实证，直接按证伪路径实现
  - 新建 sillyhub-daemon/src/agent-log/liveness/derive-claude-code.ts 纯函数 deriver：assistant 消息含 `tool_use` 无配对 `tool_result` → working；assistant 纯文本（无未配对 tool_use）→ idle
  - E-01 已证伪（spike-02 结论）→ 不实现 blocked 分支；design.md §5.5 已回注定稿注记（本卡同步记录）——日志推导侧 blocked 就此关闭，仅存第一方 PERMISSION_REQUEST 源（D-012，托管会话不受影响）
  - liveness/registry.ts 注册行加 `['claude-code-jsonl', deriveClaudeCode]`——key 与 CLI 上报落库 format 串逐字一致（sillyspec 仓 src/agent-session-log.js:224 'claude-code-jsonl'）
  - 新建 tests/agent-log/liveness/derive-claude.test.ts——fixture 覆盖：tool_use 未配对→working / tool_use+tool_result 配对且尾部纯文本→idle / 全套 fixture 断言无 blocked 输出（证伪定稿回归）/ 坏行跳过与空尾部→unknown
acceptance:
  - spike-02 结论已落字（通过或证伪二选一），证伪时 design.md 有 E-01 结论注记（日志推导 blocked 关闭的定稿记录）
  - getDeriver('claude-code-jsonl') 非 null；未注册 format 行为不变
  - fixture：末尾 tool_use 无 tool_result → state=working；纯文本结尾 → state=idle
  - E-01 通过：等待事件 fixture → state=blocked；证伪：所有 fixture 均不产出 blocked（R-01 回归）
verify:
  - cd sillyhub-daemon && pnpm test tests/agent-log/liveness/derive-claude.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - R-01 铁律：blocked 必须正向证据，证伪路径宁可少一个状态也不以"没动静"推断
  - 实证必须用真实本机 claude CLI 裸跑制造等待，不得用 mock transcript 臆测 schema（E-01 的目的即是不臆测）
  - 纯函数边界同 task-10（不 import fs/时钟，不碰 tailer/discovery）；evidence ≤200 字符
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
