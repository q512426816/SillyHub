# target_files 主仓文档路径 × worktree 对账口径结构性错配

- **发现**：2026-10-26-session-stage-progress verify 门（target_files 对账）。
- **现象**：task-05 卡 target_files 声明模块卡路径（`.sillyspec/docs/multi-agent-platform/modules/*.md`，CLI 铁律明令"模块卡一律写主仓，绝不写 worktree 副本"）→ 对账口径 `actual=worktree:diff-base..HEAD + worktree:status-porcelain` 永远判 missing（「声明未做」②类），而产物真实存在于主仓（未提交或已提交均在主仓面）。两规则打架：写 worktree=产物蒸发；写主仓=对账 missing。
- **影响**：凡 target_files 含主仓 `.sillyspec` 文档路径的任务（收尾/文档类 task 常见）verify 门必拦，只能靠"改声明 + 注释说明"绕行——声明与事实脱节，且注释口径各 agent 自由发挥。
- **建议**：对账面把主仓 `.sillyspec/` 前缀路径单独处理（如读主仓 status/diff，或该前缀行不计 missing 仅提示），或在卡 schema 增 `repo: main-docs` 类显式声明。
- **绕行**（本变更采用）：task-05 target_files 置 `[]` + 行内注释说明主仓义务与承载面（module-impact 更新结果表 + verify-result 任务完成度），constraints 原文「以 module-impact 为准更正 target_files」为授权依据。
