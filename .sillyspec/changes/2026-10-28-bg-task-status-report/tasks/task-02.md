---
id: task-02
title: 'daemon 解析 task-notification 产 bg_task_final 段（纯函数+fixture 单测）（FR-01）'
title_zh: 'daemon 解析 task-notification 产 bg_task_final 段（纯函数+fixture 单测）（FR-01）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-27 13:02:37
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts
  - sillyhub-daemon/src/agent-event-schema.ts
  - sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts
target_files:
  - sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts
  - sillyhub-daemon/src/agent-event-schema.ts
goal: >
  daemon 解析 rollout user 消息内嵌 task-notification 文本块（四字段提取）产 bg_task_final 段——纯函数+本会话实录 fixture 单测；格式漂移返回 null 静默降级。
implementation:
  - 解析函数：user content 文本中 task-notification 前缀匹配+XML 字段提取（task-id/tool-use-id/status/output-file），容错（混排文本不吞正文、失配 null）
  - 段类型 bg_task_final 注册（agent-event-schema/解析器段模型）
  - 单测：实录 fixture（本会话 rollout 含 50 处 task-notification）+混排/失配/重复边界
acceptance:
  - 四字段提取正确（fixture 断言）
  - 失配静默 null 不产段
  - 既有解析测试零回归
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/agent-log/parse-claude-code-jsonl.test.ts
constraints:
  - 纯函数无 IO；不改既有段类型语义
  - 文本混排时只提取不修改原文本段产出
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
