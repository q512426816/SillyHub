---
id: task-02
title: '双 spike 定档——pi fork 截断语义实测 + claude resumeSessionAt×forkSession 真机组合验证，结论落 D-008 与 spike-pi-fork.md'
title_zh: '双 spike 定档——pi fork 截断语义实测 + claude resumeSessionAt×forkSession 真机组合验证，结论落 D-008 与 spike-pi-fork.md'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-22 20:33:49
priority: P0
task_type: verification
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-004@v1, D-007@v1]
allowed_paths:
  - .sillyspec/changes/2026-09-22-session-fork-continuation/spike-pi-fork.md
  - .sillyspec/changes/2026-09-22-session-fork-continuation/decisions.md
target_files: []  # 纯验证任务零代码（spike 产物在主仓 spec 区，不进 worktree diff）
goal: >
  前置门（R-01/R-02 消化）：真机实测 pi RPC fork 截断语义与 claude resumeSessionAt×forkSession 组合行为，为 task-03 caps 定档与 task-06 driver 实现锁定事实。
implementation:
  - pi spike：起 pi --mode rpc 会话，多轮对话后按 rpc.md fork/switch_session 命令序列探测——断言「能否截断到指定消息」（fork 后新会话是否知道截断点之后内容）
  - claude spike：用 sillyhub-daemon/node_modules/@anthropic-ai/claude-agent-sdk（sdk.d.ts:1886-1930 resumeSessionAt/resumeDropsTurn、:1548-1551 forkSession）走 Agent SDK query 车道实测 resume+resumeSessionAt+forkSession 组合：断言 B 不知分叉点后内容；记录 resumeDropsTurn 守卫开关状态、确定性拒绝时的错误浮出形态、锚点应取轮末哪条消息
  - 结论写入 spike-pi-fork.md（两节：pi 定档判定 + claude 组合行为；实测原文零臆造）
  - decisions.md 追加 D-008@v1（pi 定档 native/seed + claude 锚点消息类型结论，source: code）
acceptance:
  - pi 定档结论落盘（native 或 seed，判据=截断断言结果）
  - claude spike 三要素齐：不知情断言/守卫行为/锚点消息类型
  - D-008@v1 九字段齐全入 decisions.md
verify:
  - grep -c "D-008" .sillyspec/changes/2026-09-22-session-fork-continuation/decisions.md（≥1）
  - spike-pi-fork.md 含「pi 定档」与「claude 组合」两节
constraints:
  - spike 探测脚本不入仓（临时目录跑，结论入 md）
  - 不改任何源码（本卡纯证据产出）
  - SillySpec CLI 一律主仓根跑
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
