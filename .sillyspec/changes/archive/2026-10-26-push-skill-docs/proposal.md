---
author: flow-machine-draft
created_at: 2026-10-26T03:34:20.498Z
---
# 提案书（Proposal）— 2026-10-26-push-skill-docs

## 动机

任务原话转写：推送压扁技能与知识作用域配置文档；sillyspec push（推送前压扁+快进推送）与 knowledge scope（知识恒注入作用域）为 CLI 新能力，.claude/skills 缺对应技能与配置指引——补 sillyspec-push 技能文档与 sillyspec-config 知识注入作用域节。

成功标准：
- .claude/skills/sillyspec-push/SKILL.md 存在，含 frontmatter、用法、流程（预检/确认/执行/汇报）、模式与守卫、绝对规则节，命令与 sillyspec push --help 一致
- .claude/skills/sillyspec-config/SKILL.md 新增「知识注入作用域」节：scope: always/repo/module 标记语法与 sillyspec knowledge scope 自查入口
- 两文件以显式 pathspec 提交入库

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. .claude/skills/sillyspec-push/SKILL.md 存在，含 frontmatter、用法、流程（预检/确认/执行/汇报）、模式与守卫、绝对规则节，命令与 sillyspec push --help 一致
2. .claude/skills/sillyspec-config/SKILL.md 新增「知识注入作用域」节：scope: always/repo/module 标记语法与 sillyspec knowledge scope 自查入口
3. 两文件以显式 pathspec 提交入库

## 成功标准（可验证）

1. .claude/skills/sillyspec-push/SKILL.md 存在，含 frontmatter、用法、流程（预检/确认/执行/汇报）、模式与守卫、绝对规则节，命令与 sillyspec push --help 一致
2. .claude/skills/sillyspec-config/SKILL.md 新增「知识注入作用域」节：scope: always/repo/module 标记语法与 sillyspec knowledge scope 自查入口
3. 两文件以显式 pathspec 提交入库
