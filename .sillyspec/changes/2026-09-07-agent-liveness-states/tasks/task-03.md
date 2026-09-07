---
id: task-03
title: 'tailer 循环——offset 差量读/reset/ended 回收/watch≤16/4MB 预算/R-02 fail-open'
title_zh: 'tailer 循环——offset 差量读/reset/ended 回收/watch≤16/4MB 预算/R-02 fail-open'
author: 'qinyi'
created_at: 2026-09-07 13:43:27
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/agent-log/liveness/tailer.ts
  - sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts
target_files:
  - NEW:sillyhub-daemon/src/agent-log/liveness/tailer.ts
  - NEW:sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts
goal: >
  实现 daemon 侧周期日志尾部跟踪器：对 watch list 内每路径 offset 差量续读、轮转 reset、ended 回收，受 watch≤16 与单轮 4MB 预算约束，异常全程 fail-open 不影响既有链路。
implementation:
  - 新建 tailer.ts：watch list 记录每路径 offset/prev 状态/lastSeenAt/subagent 从属标记，tick 默认 10s 可注入；每轮 stat size 与上次 offset 差量续读新字节作 DeriverInput.tail。
  - 轮转与消失（E-03 实证常态）：size 变小或文件消失 → offset 重置 + evidence 标记 reset；消失超 15min 窗 → 产出 ended 并移出 watch list（对应 design §7.5 watch end，rotation 经重扫后重新 join）；subagent_agent_ 前缀文件记从属不建独立主会话。
  - 推导分派经 task-01 的 getDeriver：命中走 L1 事件级，null 走 L0 mtime 兜底（≤120s working / ≤15min idle / 更久或不存在 ended）。
  - 并发预算：watch 上限 16，满员按 lastSeenAt 最旧淘汰；单轮读取字节预算 4MB，超预算差量留待下轮。
  - R-02 fail-open：单路径读失败或 deriver 抛错 → 本轮该路径记 unknown/跳过并 warn，循环继续，绝不向上抛。
  - 新建 tests/agent-log/liveness/tailer.test.ts：tmp 目录 fixture 手动驱动 tick——追加写入差量读、轮转（重写更小文件）reset、超窗消失 ended 回收、满 16 淘汰最旧、超 4MB 截断、deriver 抛错后循环存活。
acceptance:
  - tailer 异常（读失败/deriver 抛错）不影响 read_agent_log_messages 既有测试（tests/agent-log/read-agent-log-messages.test.ts 保持全绿，本模块零改动该链路）。
  - 轮转场景（size 变小）offset 重置且证据带 reset 标记，恢复跟踪不串台。
  - watch 超 16 条淘汰 lastSeenAt 最旧条目；单轮读取不超 4MB 预算。
verify:
  - cd sillyhub-daemon && pnpm test -- tests/agent-log/liveness/tailer.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - R-02 fail-open：任何异常只降级本轮，不得影响登记链路与 host-fs-handler.ts（不修改该文件）。
  - 时钟/间隔/预算常量可注入，测试零真实等待、tick 手动驱动。
  - 不修改既有 agent-log/registry.ts 与 parse-zcode-model-io.ts；L1 分派只经 liveness/registry.ts。
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
