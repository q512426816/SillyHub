---
author: qinyi
created_at: 2026-08-15T15:45:00+08:00
---

# 坑 6：plan-postcheck 隐性格式契约连环坑（issue 待报）

**状态**：活跃（2026-08-15 实测，sillyspec 安装版 @nvm/v24.15.0，node_modules/sillyspec）

**现象**：plan 阶段 `--done` 的 planPostcheck 报错一轮只露一个，同一批卡片迭代 7 次 `--done` 才全部通过，每次修完又冒新错。报错顺序：缺 allowed_paths → 缺 acceptance → 缺 goal/implementation/constraints/id/title_zh → design 缺文件清单章节 → plan 未引用 FR → 缺 module-impact → checkbox 不在 Wave 段。

**根因清单**（6 个具体问题）：

1. **`parseAllowedPaths` 块列表正则缺陷**（`src/stages/plan-postcheck.js:73-77`）：
   `allowed_paths:\s*\n((?:\s+-\s+.+\n?)+)` 中 `\s*` 贪婪匹配会吃掉换行符与列表项的前导空白，导致 YAML 标准块列表格式（`allowed_paths:\n- a\n- b`）**永远匹配失败**，只有 inline 数组 `allowed_paths: [a, b]` 能过。这是正则 bug 非文档约定——标准 YAML 写法被静默判「缺少 allowed_paths」。
2. **CRLF 行尾全失配**：所有 frontmatter/章节正则用 `^---\n` 锚点，Windows 编辑器默认 CRLF 的卡片全部静默失配（fmMatch 都不成立），报错误导为「缺字段」。Windows agent 写卡片必须显式 `newline="\n"`。
3. **报错不聚合**：blueprint consistency / feasibility / design coverage / FR 引用 / module-impact / checkbox 收容是 6 个独立检查，失败一个抛一个，其余不输出。修 1 个错重跑才知道下一个。
4. **required 字段集无模板**：卡片需要完整 frontmatter（id/title/title_zh/status/goal/implementation/acceptance/verify/constraints/allowed_paths）+ body「## 验收标准」（字面，不认「## 验收」）+「## 验证」章节，这些只藏在 postcheck 源码里，CLI prompt 未给模板。
5. **checkbox 收容规则隐式**：`- [ ] task-NN:` 必须紧跟 `## Wave N` 段内（独立「## 任务清单」段不收），诊断信息虽有但报错文案与解法不对应。
6. **design 文件清单格式**：只认 `## 文件变更清单`（或同义）标题 + 表格/bullet 特定形态；`.sillyspec/` 路径默认跳过（keepSillyspecDocs=false）。

**workaround**（已验证）：
- 卡片 allowed_paths 一律 inline 数组；Python 写文件 `newline="\n"`；
- frontmatter 字段集照抄本仓 `.sillyspec/changes/archive/2026-08-15-error-message-l10n/tasks/task-01.md`；
- design 用表格 `| 操作 | 文件路径 | 说明 |`；plan.md checkbox 放 Wave 段内 + 引用 FR-XX；
- 期望上游修复：块列表正则改 `(?:[ \t]*-[ \t]+...)`（去掉 `\s*\n` 的 `\s` 贪婪）、postcheck 一次性输出全部失败项、prompt 注入卡片模板。

**关联**：`2026-08-15-error-message-l10n` change 全流程实录（记忆 error-message-l10n-change）。
