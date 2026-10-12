---
author: flow-machine-draft
created_at: 2026-10-12T01:32:12.955Z
---
# 提案书（Proposal）— 2026-10-12-borrow-ctx-truncate-rest

## 动机

任务原话转写：动机：24h 风险审查 P3（408bc0889 收口不全）——借用沙箱 AGENTS.md 注入面截断只覆盖 description/tech_stack/repo_url 三字段，同文件的 name/slug/display_alias（工作区行）与 root_path（真实代码目录行，backend 上限 4096 且不删换行/反引号）仍原样进 agent 自动加载正文，防线不一致；lender 登记含超长/markdown 的字段即可向 borrower 会话注入多行指令文本，与 R-02 威胁模型同族。
成功标准：
- 工作区行的 name/slug/display_alias 与真实代码目录行的 root_path 均套既有 truncateText（500 阈值+省略标注），行为与既有三字段逐字一致；type/default_branch 等 backend 受约束短字段不在本变更面
- 新增用例先红后绿：name>500/root_path>500/三者并存超 500/边界 500 恰好不截（对齐既有用例形态）；既有用例全绿
- 生产代码零新增防御原语（复用 truncateText），模块头注安全语义段同步
- 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/borrow-sandbox-context.test.ts 全文件

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 工作区行的 name/slug/display_alias 与真实代码目录行的 root_path 均套既有 truncateText（500 阈值+省略标注），行为与既有三字段逐字一致；type/default_branch 等 backend 受约束短字段不在本变更面
2. 新增用例先红后绿：name>500/root_path>500/三者并存超 500/边界 500 恰好不截（对齐既有用例形态）；既有用例全绿
3. 生产代码零新增防御原语（复用 truncateText），模块头注安全语义段同步
4. 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/borrow-sandbox-context.test.ts 全文件

## 成功标准（可验证）

1. 工作区行的 name/slug/display_alias 与真实代码目录行的 root_path 均套既有 truncateText（500 阈值+省略标注），行为与既有三字段逐字一致；type/default_branch 等 backend 受约束短字段不在本变更面
2. 新增用例先红后绿：name>500/root_path>500/三者并存超 500/边界 500 恰好不截（对齐既有用例形态）；既有用例全绿
3. 生产代码零新增防御原语（复用 truncateText），模块头注安全语义段同步
4. 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/borrow-sandbox-context.test.ts 全文件
