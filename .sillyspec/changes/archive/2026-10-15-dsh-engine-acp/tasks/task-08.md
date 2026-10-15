---
id: task-08
title: '端到端冒烟——本机装 dsh ≥0.2.1 实测：创建 dsh 单聊/一轮对话落库渲染/打断/审批代答/LlmProvider 路由生效；CI 无 dsh 时该面走 skip 策略留痕（成功标准收口）'
title_zh: '端到端冒烟——本机装 dsh ≥0.2.1 实测：创建 dsh 单聊/一轮对话落库渲染/打断/审批代答/LlmProvider 路由生效；CI 无 dsh 时该面走 skip 策略留痕（成功标准收口）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 12:45:27
priority: P0
depends_on: ['task-05', 'task-06', 'task-07']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths:
  - sillyhub-daemon/tests/interactive/dsh-acp-smoke.test.ts
target_files:
  - NEW:sillyhub-daemon/tests/interactive/dsh-acp-smoke.test.ts
goal: >
  端到端冒烟收口：实机 dsh ≥0.2.1 上验证单聊全链路（创建/对话落库/打断/审批代答/模型路由）；无 dsh 环境显式 skip 留痕。
implementation:
  - 新建 sillyhub-daemon/tests/interactive/dsh-acp-smoke.test.ts：describe.skipIf(本机探测不到 dsh 或版本 <0.2.1)；用真实 spawn `dsh --profile acp` 跑通 initialize → session/new → prompt 一轮（事件落 AgentEvent 序列断言）→ cancel；权限代答用 mock resolver 三态；模型路由用注入 env + patch 断言 set_config_option 收到 platform model
  - skip 分支输出留痕文案（含探测结果与版本），CI 日志可辨"未装 dsh 故跳过"而非静默绿
  - 本机（Windows，装有 dsh 时）实跑记录输出摘要到变更目录 smoke-notes.md（NEW，非必须文件——有实跑才写）
acceptance:
  - 有 dsh 环境：冒烟全绿（一轮对话事件序列完整、打断生效、代答三态正确、路由 model 设置成功）
  - 无 dsh 环境：显式 skip + 留痕（不假绿）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/dsh-acp-smoke.test.ts
constraints:
  - 冒烟不进 CI 必绿集（skipIf 守护）；不做群聊面（阶段 2）；依赖 task-01~07 全部完成
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
