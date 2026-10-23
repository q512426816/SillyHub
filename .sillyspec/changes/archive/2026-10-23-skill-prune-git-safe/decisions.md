---
author: flow-machine-draft
created_at: 2026-10-23T06:16:30.324Z
---
# 决策记录（Decisions）— 2026-10-23-skill-prune-git-safe

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是「裁剪失效感」——git 仓库里的技能目录不再被删，会话 agent 能看到（读到）全部仓库自带技能，超出会话勾选的技能面。定性：技能只是说明书文档，读取面放宽不改变工具权限面；且平台技能下线本就走「仓库提交」通道（2026-10-23 实证 b6f3114d9），daemon prune 对 git 仓的删除本就属于越权行为。缓解：`prune_skill_kept` 日志保留可观测。次风险：`git ls-files` 在超大仓的耗时——限定 pathspec `.claude/skills` 后输出量级为技能文件数（几十到几百行），15s 超时兜底，启动路径一次性可接受。 试过放弃的方案：①link 时打 marker 文件/命名约定——存量已 link 目录无 marker，需迁移清理，且 marker 本身又落在工作区（新污染），放弃；②workDir 是 git 仓则整体跳过 prune——判定太粗，daemon link 副本在 git 仓里（.gitignore 了 .claude/skills 的部署形态）也无法清理，放弃；③删除改移动到 daemon 回收站——仍改工作区，只解决可恢复不解决「不该动」，放弃；④把 `.claude/skills` 整体加 gitignore——动仓库契约、影响技能作为正式文件分发的既有形态，放弃。
