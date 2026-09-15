---
id: task-05
title: '后台 dialog 有界兜底——permission-resolver register 中 backgroundTask===true 时 dialog 也启用 5min fallback'
title_zh: '后台 dialog 有界兜底——permission-resolver register 中 backgroundTask===true 时 dialog 也启用 5min fallback'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 16:45:00
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/permission-resolver.ts
target_files:
  - sillyhub-daemon/src/interactive/permission-resolver.ts
goal: >
  后台 dialog 请求有界兜底（FR-02，Grill 阻断项②修正）：permission-resolver.ts register 现状对 dialog 类请求
  一律不启 5 分钟 fallback timer（对齐 backend「dialog 无限期等待」语义）；但后台锚点态的 dialog 已是降级路径，
  新 daemon+旧 backend 组合下被拒收时会无界挂起。backgroundTask===true 的 dialog 也启用 5 分钟兜底，
  保证任何组合下最坏 5 分钟有界 deny；主轮进行中的 dialog 维持现状不设超时（用户决策必须等待的语义不破坏）。
implementation:
  - permission-resolver.ts register（sillyhub-daemon/src/interactive/permission-resolver.ts:200-210）中 fallback timer 判定从 `!isDialog` 改为 `!isDialog || input.backgroundTask === true`
  - 兜底超时 message 沿用既有 'permission request timeout (5min fallback)'，settle 行为与既有非 dialog 兜底一致
  - entry.fallbackTimer.unref?.() 等对 timer 的清理/清除路径不动
acceptance:
  - backgroundTask=true 且带 dialogKind 的请求注册了 5 分钟 fallback timer（fake timers 前进 5 分钟后 settle deny，message 为既有兜底文案）
  - 主轮进行中 dialog（backgroundTask 未置位/为 false）仍不注册 fallback timer，无界等待语义不变
  - 非 dialog 请求（backgroundTask 任意值）兜底行为与现状一致
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/permission-resolver.test.ts && pnpm typecheck
constraints:
  - 主轮 dialog 不设超时的现状语义不可破坏
  - 仅改 fallback timer 启用判定，不动 resolve/settle/竞态忽略逻辑
  - 注释与实现一致（CLAUDE.md 规则18）
  - 不引入无关文件变更
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
