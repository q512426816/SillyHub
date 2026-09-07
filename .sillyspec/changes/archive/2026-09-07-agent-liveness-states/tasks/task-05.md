---
id: task-05
title: '自发现窄扫——codex（uuid）/zcode（共享 rollout 目录）标记匹配 + cwd 防串台'
title_zh: '自发现窄扫——codex（uuid）/zcode（共享 rollout 目录）标记匹配 + cwd 防串台'
author: 'qinyi'
created_at: 2026-09-07 13:43:27
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/agent-log/liveness/discovery.ts
  - sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts
target_files:
  - NEW:sillyhub-daemon/src/agent-log/liveness/discovery.ts
  - NEW:sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts
goal: >
  补齐自发现定位档二：codex（uuid 文件名）与 zcode（全局共享 rollout 目录）无法由 cwd 直算，改用目录窄扫 + 首行/workdir 标记匹配 + cwd 归属判定防串台。
implementation:
  - 修改 discovery.ts 增窄扫路径：codex 在其布局目录内按 mtime 窗窄扫 uuid 文件名候选；zcode 在全局共享的 ~/.zcode/cli/rollout/ 目录窄扫 model-io 文件。
  - 标记匹配：预算内读候选文件首行/头部，比对 workdir/cwd 归属标记；session_id 变化视为新会话（与 tailer 的 R-02 轮转语义一致）。
  - cwd 防串台：候选文件 workdir 与 spawn/恢复记录 cwd 不一致则不挂接（R-06 宁漏勿误）；subagent_agent_ 前缀文件记从属，不为主会话另建 watch。
  - 新建 tests/agent-log/liveness/discovery.test.ts：tmp 目录树 fixture——claude/pi 直算回归、codex uuid 文件名标记命中、zcode 共享目录多会话按 workdir 筛选、cwd 不匹配候选被拒。
acceptance:
  - 共享 rollout 目录含多会话文件时仅 cwd 匹配者进 watch list（防串台回归项）。
  - codex uuid 文件名会话经首行/workdir 标记被发现；归属不确定的候选被跳过而非误挂。
  - task-04 直算路径行为不变（同 fixture 对 claude/pi 双断言）。
verify:
  - cd sillyhub-daemon && pnpm test -- tests/agent-log/liveness/discovery.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 窄扫头部读取受字节预算约束（标记判定即可，不整卷读）。
  - R-06 防串台：不确定归属宁可漏挂不可误挂，且不改写 cwd 归属字段。
  - 不修改 sillyspec 仓与本仓 interactive/ 既有文件（布局规则以本仓 TS 实现为准）。
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
