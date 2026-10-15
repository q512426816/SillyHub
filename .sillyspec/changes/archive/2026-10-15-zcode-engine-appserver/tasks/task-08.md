---
id: task-08
title: '端到端冒烟——本机装 ZCode Desktop（引擎 ≥0.16.9）实测：创建 zcode 单聊/一轮对话落库渲染（token 流式+thought）/打断/审批代答/LlmProvider 路由生效（注入 Provider 跑模型轮）/stdin EOF 退出行为记录（R-05）；CI 无引擎时该面走 skip 策略留痕 （成功标准收口）'
title_zh: '端到端冒烟——本机装 ZCode Desktop（引擎 ≥0.16.9）实测：创建 zcode 单聊/一轮对话落库渲染（token 流式+thought）/打断/审批代答/LlmProvider 路由生效（注入 Provider 跑模型轮）/stdin EOF 退出行为记录（R-05）；CI 无引擎时该面走 skip 策略留痕 （成功标准收口）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 13:50:04
priority: P0
depends_on: ['task-01', 'task-04', 'task-05', 'task-06', 'task-07']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-004@v1, D-005@v1, D-007@v1, D-008@v1]
allowed_paths:
  - sillyhub-daemon/tests/interactive/zcode-e2e.smoke.test.ts
target_files:
  - NEW:sillyhub-daemon/tests/interactive/zcode-e2e.smoke.test.ts
expects_from:
  - task-01/04/05/06/07 全部交付
goal: >
  端到端冒烟收口：本机装 ZCode Desktop（引擎 ≥0.16.9）实测全链路；
  CI 无引擎时 skip 留痕（成功标准最后一公里）。
implementation:
  - 冒烟脚本/测试：探测命中（fallbackPaths 实路径）→ 创建 provider='zcode' 单聊（绑定 LlmProvider 指向测试 provider_config 注入）→ 一轮对话（text/thought token 流式 + 工具事件落 AgentRunLog 渲染）→ 打断 → 审批代答三态 → 路由生效断言（模型轮跑在注入 Provider 上——对齐 2026-10-15 手工实测先例）
  - stdin EOF 退出行为实测记录（R-05）：driver close 后观察子进程退出方式与耗时，记入 verify-result
  - 引擎不可用时 it.skip + 留痕说明（CI 面）
acceptance:
  - 本机全链路冒烟 PASS；未装引擎机器测试 skip 且留痕
  - R-05 stdin EOF 行为有实测记录（优雅退出或清理阶梯兜底，二选一记录事实）
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/interactive/zcode-e2e.smoke.test.ts
constraints:
  - 冒烟测试不硬依赖外网模型（绑定本地可路由 provider 或 skip）；不清理机器 zcode 会话库（D-02 共享语义）
  - 仅聚焦本变更相关测试，全量回归留 CI
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
