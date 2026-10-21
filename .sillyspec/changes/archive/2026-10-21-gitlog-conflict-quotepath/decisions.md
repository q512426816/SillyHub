---
author: flow-machine-draft
created_at: 2026-10-21T01:17:41.120Z
---
# 决策记录（Decisions）— 2026-10-21-gitlog-conflict-quotepath

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：风险①：`git diff --name-only` 输出按行切，文件名含字面换行仍会断行——但含控制字符的路径 git 恒强制 C 引号包裹（`\n` 被转义为字面 `\n` 两字符），单行假设不破，decodeGitCQuote 同款规则兜底（上变更风险③同机理，GL47 已实证）。风险②：`conflicts[].file` 语义变化对 backend converge_mission 的下游消费是修复性变化（原文路径才能 readFile），若存在依赖「转义形态」的下游断言需同步——检索 backend 侧对 conflicts 的消费为透传给 LLM 提示词，无形态依赖。死路①：不改 `_listConflictFiles` 改为 `git status --porcelain` 解析 U 态——porcelain 输出对特殊字符的引号规则随 `-z` 才关、解析面更大，弃。死路②：沿用上变更已弃的 `--numstat -z` 思路改 `-z`——name-only 的 `-z` 需改 NUL 切分且与既有行式解析不兼容，无收益，弃。
