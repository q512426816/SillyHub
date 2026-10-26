---
author: flow-machine-draft
created_at: 2026-10-26T03:34:20.498Z
---
# 需求规格（Requirements）— 2026-10-26-push-skill-docs

## 功能需求

### FR-01: .claude/skills/sillyspec-push/SKILL.md 存在，含 frontmatter、用法、流程（预检/确认/执行/汇报）、模式与守卫、绝对规则节，命令与 sillyspec push --help 一致

- `.claude/skills/sillyspec-push/SKILL.md` 必须存在且包含 frontmatter（name/description/argument-hint）、用法、流程（预检/用户确认/执行/汇报）、模式与守卫、绝对规则五节；文中出现的 `sillyspec push` 命令行与 flag 必须与 `sillyspec push --help` 实际输出一致。

#### 场景：主路径

- Given Claude Code 会话收到「推送/整理中间提交」类请求，When 读取该 skill，Then 能按预检→dry-run→确认→执行的顺序驱动 `sillyspec push`，且不出现 --help 中不存在的 flag。

### FR-02: .claude/skills/sillyspec-config/SKILL.md 新增「知识注入作用域」节：scope: always/repo/module 标记语法与 sillyspec knowledge scope 自查入口

- `.claude/skills/sillyspec-config/SKILL.md` 必须包含「知识注入作用域」一节，说明知识文件 heading 下 `<!-- scope: always|repo|module:<域> -->` 标记语法与三档语义，并给出 `sillyspec knowledge scope` 自查入口。

#### 场景：主路径

- Given 用户要求某条知识每次变更恒注入，When 会话按该节指引操作，Then 能在正确位置写入标记行并通过 `sillyspec knowledge scope` 核验生效。

### FR-03: 两文件以显式 pathspec 提交入库

- 两文件必须以显式 pathspec 提交入库（禁止目录级 add / 裸 commit 卷入共享暂存区），提交信息含变更名归属。

#### 场景：主路径

- Given 多会话共享仓，When 提交本变更产物，Then `git log` 中存在仅含这两个文件的单笔提交（8411fc090 已达成）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：纯 skill 指引文档，无运行时行为可断言；验收靠与 `sillyspec push --help` 输出比对与人工复核（AGENTS.md 规则 3 文档面豁免）
FR-02: 不适用：纯配置指引文档，标记语法正确性由 `sillyspec knowledge scope` 命令自校验；验收靠人工复核（AGENTS.md 规则 3 文档面豁免）
FR-03: 不适用：git 提交动作本身，由 `git log --stat 8411fc090` 直接核验单笔提交文件面（AGENTS.md 规则 3 文档面豁免）
