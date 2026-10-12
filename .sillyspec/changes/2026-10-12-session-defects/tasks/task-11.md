---
id: task-11
title: 'Record sillyspec CLI defects — NEW docs/sillyspec/cli-cwd-coupling.md + NEW docs/sillyspec/deps-gate-offline-fragile.md'
title_zh: '记档——NEW docs/sillyspec/cli-cwd-coupling.md + NEW docs/sillyspec/deps-gate-offline-fragile.md'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-12 21:01:59
priority: P2
depends_on: []
blocks: []
requirement_ids: [FR-08]
decision_ids: [D-008@v1]
allowed_paths:
  - NEW:docs/sillyspec/cli-cwd-coupling.md
  - NEW:docs/sillyspec/deps-gate-offline-fragile.md
target_files:
  - NEW:docs/sillyspec/cli-cwd-coupling.md
  - NEW:docs/sillyspec/deps-gate-offline-fragile.md
goal: >
  按 CLAUDE.md 规则 15 把 sillyspec CLI 两项生产实证缺陷（cwd 耦合、deps 门控离线脆弱）记档到 docs/sillyspec/ 活跃坑，待工具修复。
implementation:
  - '先 ls docs/sillyspec/ 并读一份既有记档样例（如 docs/sillyspec/verify-gate-worktree-crossrepo-three-defects.md）对齐结构：引言（记录时间/来源变更/状态）+ 现象/根因/影响/绕过分节'
  - 'NEW:docs/sillyspec/cli-cwd-coupling.md：现象=worktree 内跑 sillyspec CLI 把 cwd 当独立 spec root，进度库/artifact/QUICKLOG 与主仓分裂；生产实证=会话 47e2ff1a 中 8 条「CLI 错误目录」日志；影响=进度与产物分裂、QUICKLOG 写丢；绕过=一律在主仓根跑（CLAUDE.md 规则 22，worktree 读码用绝对路径或 git -C）；修复建议=CLI 从 SILLYSPEC_SESSION_ID/env 定位主仓根'
  - 'NEW:docs/sillyspec/deps-gate-offline-fragile.md：现象=跨仓 worktree deps 门控 npm ci 离线必败、lockfile hash 不一致使链接快路径失效；影响=离线环境 worktree 准备阻断、每次回退全量 ci 慢；绕过=手工改 meta.json 为 linked（高风险，须留痕）；修复建议=离线探测（npm ping/缓存命中判断）+ 链接回退自动化'
acceptance:
  - docs/sillyspec/cli-cwd-coupling.md 与 docs/sillyspec/deps-gate-offline-fragile.md 两文件在场
  - 两文件各含现象/根因/影响/绕过四要素，格式与 docs/sillyspec/ 既有记档一致（引言含记录时间/状态）
verify:
  - ls docs/sillyspec/cli-cwd-coupling.md docs/sillyspec/deps-gate-offline-fragile.md
constraints:
  - 只记档不修 sillyspec CLI 代码（D-008 / design 非目标边界）
  - 纯新增两文件，不动 docs/sillyspec/ 既有记档与 finished/；不写代码与测试
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
