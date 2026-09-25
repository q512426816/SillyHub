---
id: task-10
title: 'Config and documentation sync for thin rollout'
title_zh: '配置文档同步收口'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-25 07:14:58
priority: P2
depends_on: ['task-05', 'task-07', 'task-08', 'task-09']
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-002@v1]
allowed_paths:
  - .claude/CLAUDE.md
  - .zcode/skills/sillyspec-quick/SKILL.md
  - docs/sillyspec/finished/thin-flow-quick-retirement.md
  - .sillyspec/docs/multi-agent-platform/modules/backend.md
  - .sillyspec/docs/multi-agent-platform/modules/backend.changelog.md
  - .sillyspec/docs/multi-agent-platform/modules/frontend.md
  - .sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md
target_files:
  - .claude/CLAUDE.md
  - .zcode/skills/sillyspec-quick/SKILL.md
  - NEW:docs/sillyspec/finished/thin-flow-quick-retirement.md
  - .sillyspec/docs/multi-agent-platform/modules/backend.md
  - .sillyspec/docs/multi-agent-platform/modules/backend.changelog.md
  - .sillyspec/docs/multi-agent-platform/modules/frontend.md
  - .sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md
goal: >
  平台仓流程指引与文档同步轻量变更转正：CLAUDE.md 流程规则、quick 技能退役横幅、工具坑留档、模块文档/changelog 四件。
implementation:
  - .claude/CLAUDE.md 规则 4 小修复改指轻量变更（sillyspec flow start --change <名> --input "<含成功标准节的多行需求>" → flow done）；规则 19 quick/QUICKLOG 条目标注「存量通道（退役中）」
  - .zcode/skills/sillyspec-quick/SKILL.md 顶部加退役横幅（存量收尾 only，文案对齐 sillyspec src/run/stage.js:371 横幅语义）+ 追加「轻量变更」用法段（2 调用协议/过门格式/断点续）
  - 新建 docs/sillyspec/finished/thin-flow-quick-retirement.md：上游工具坑留档——flow 平台参数面四缺口（--spec-dir 崩溃/预建拒收/指针不读/PM 锚定脱钩）与变更名零校验，sillyspec 3.30.0 已代码修复（引用本会话核对结论与上游 41b3490d）
  - 模块文档四件：backend.md 补 thin 阶段语义/双守卫/binding 扩展/分流映射；backend.changelog.md、frontend.md（changes 组件族 thin 视觉/说明卡/存量标注）、frontend.changelog.md 各加条目
acceptance:
  - CLAUDE.md 规则 4 出现 flow start/flow done 用法；规则 19 带存量标注
  - skills 横幅 + 用法段在场；工具坑留档文件在场且含上游版本与修复引用
  - 四件模块文档/changelog 各含 thin/轻量变更 条目
verify:
  - grep -n "flow start" .claude/CLAUDE.md && grep -n "轻量变更" .claude/CLAUDE.md .zcode/skills/sillyspec-quick/SKILL.md
  - ls docs/sillyspec/finished/thin-flow-quick-retirement.md
constraints:
  - 文案统一「轻量变更」（D-002@v1）；坑文档归 finished/（上游已修复非活跃坑）
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
