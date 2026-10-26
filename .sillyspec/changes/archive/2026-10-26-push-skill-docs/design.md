---
author: flow-machine-draft
created_at: 2026-10-26T03:34:20.498Z
---
# 设计记录（Design Record）— 2026-10-26-push-skill-docs

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

纯文档倒推收尾：`.claude/skills/sillyspec-push/SKILL.md` 为全新技能文件（推送前压扁+快进推送的交互规范），`.claude/skills/sillyspec-config/SKILL.md` 在配置节后追加「知识注入作用域」一节。两者都是对 sillyspec CLI 既有能力（`sillyspec push`、`sillyspec knowledge scope`）的使用指引，不改任何代码——选文档面是因为能力本体已随 npm 包交付，缺的只是 agent 会话可读的操作规范。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无运行时接口变化。唯一「对外可见」面是两个 markdown 文件本身：push 技能约定 `sillyspec push [--mode ...] [--dry-run] [--no-push] [--undo]` 交互序（dry-run 计划→用户确认→真实推送），config 技能约定知识文件 heading 下 `<!-- scope: always|repo|module:<域> -->` 注释行语法——两者均与 CLI 3.33.x 实际行为逐字对齐。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：不适用——纯静态文档，无事件/输入流。
2. 并发写：多会话同时编辑同一 SKILL.md 可能互相覆盖，但本变更为单会话一次性补写且已提交（8411fc090），后续编辑走正常变更流程即可。
3. 切换/生命周期：不适用——文档无状态；会话中断后重读文件即为最新态。
4. 作用域：skill 只放 `.claude/skills/`（Claude Code 面）；`.zcode/skills/` 无对应文件是现状（sillyspec 系技能历来只维护 .claude 侧），不跨仓串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：文档描述与 CLI 实际行为漂移（CLI 升级改 flag 后文档滞后）——缓解：FR-01 要求命令与 `--help` 逐字一致，且 push 技能内含「禁止直接 git push」等绝对规则防误用。无放弃过的方案（纯新增文档，无方案分叉）。
