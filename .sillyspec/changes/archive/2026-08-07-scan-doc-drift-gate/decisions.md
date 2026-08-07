---
author: qinyi
created_at: 2026-08-06 09:07:53
---

# 决策台账（Decisions）— scan 文档 drift 检测门

## D-001@v1: drift 信号 = source_commit 时效 + 文件路径存在性

- type: architecture
- status: accepted
- source: user
- question: scan drift 门用什么检测信号？（scan 是 LLM 非确定性产物，gen:types 的 regenerate + git diff --exit-code 不适用）
- answer: 双信号——(1) source_commit 落后 HEAD 超 N commit（默认 50）；(2) scan 文档 body 引用的文件路径仍存在（os.path.exists）。否决「纯时效」（漏窗口内内容漂移）和「强 file:line/符号锚点」（需改 sillyspec-scan skill 生成结构化 references + 重生成 8 文档 + 工程量大 + LLM prose 引用松散易误报，当前过度工程）。
- normalized_requirement: `scripts/scan-drift-check.py` 必须实现双信号检测；时效阈值 N=50 可配（env `SCAN_DRIFT_COMMIT_THRESHOLD`）；文件路径校验白名单限 backend/frontend/sillyhub-daemon/deploy 四端前缀 + 完整扩展名（.py/.ts/.tsx/.mjs/.js/.json/.yaml/.yml/.md）；带行号路径剥行号后校验。
- impacts: [FR-01, FR-02, task-detection-script, verify-双信号, R-02, R-05]
- evidence: 用户 2026-08-06 brainstorm step3 AskUserQuestion 选「时效 + 文件路径校验（推荐）」；scan 文档实测含 ~24 个真实文件路径引用（brainstorm step2 grep 核实 ARCHITECTURE/CONVENTIONS/CONCERNS 等）。
- priority: P0

## D-002@v1: warn-only 不阻塞 PR（方案 A）

- type: compatibility
- status: accepted
- source: user
- question: drift 门检测到漂移时，CI 行为是 block 还是 warn？
- answer: warn-only。脚本 exit 0 + GitHub `::warning` 注解 + 去重 PR 评论汇总，不 fail job、不阻塞 merge。否决 block（方案 B）——修复需人工 LLM 重跑 scan，CI 内不能自动修，block 会拖慢所有大改 PR。
- normalized_requirement: scan-drift-check.py 漂移时 exit 0（仅脚本异常才非 0）；CI workflow 不作为 required status check；PR 评论用 actions/github-script 去重（create-or-update）。
- impacts: [FR-03, task-ci-workflow, R-01]
- evidence: 用户 2026-08-06 brainstorm step4 AskUserQuestion 选「方案 A 轻量 warn（推荐）」。
- priority: P0

## D-003@v1: 加门前先刷新 scan 文档

- type: premise
- status: accepted
- source: code
- question: 当前 scan 文档 source_commit 6e78b29a 落后 HEAD 176 commit，加门后首日即全红，如何处理？
- answer: 本 change 第一个 task 是重跑 sillyspec scan 把 8 篇 scan 文档 source_commit 推到当前 HEAD a76f2a75，顺带修失效文件路径引用。门在刷新后才上线。
- normalized_requirement: execute Wave1 第一个 task = 刷新 scan 文档（sillyspec scan skill），产出 source_commit=当前 HEAD 的 8 篇文档；drift 脚本在刷新后的文档上自测通过（0 漂移）。
- impacts: [task-refresh-scan-docs, R-06]
- evidence: brainstorm step2 `git rev-list --count 6e78b29a..HEAD` = 176（实测）。
- priority: P0
