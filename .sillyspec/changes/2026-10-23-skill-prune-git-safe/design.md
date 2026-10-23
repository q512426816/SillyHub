---
author: flow-machine-draft
created_at: 2026-10-23T06:01:11.085Z
---
# 设计记录（Design Record）— 2026-10-23-skill-prune-git-safe

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：daemon 技能裁剪 `pruneSkillsToSubset`（skill-manager.ts）现行为是「删 `<workDir>/.claude/skills/` 下不在本会话 skillRefs 清单里的所有目录」——workDir 是 git 仓库工作区时，删的是 git 跟踪的项目正式文件（2026-10-23 实证：会话 0c9c4e67 创建时被删 250 个跟踪文件）。修法把删除条件从单一「不在清单」收敛为**三重与**：`不在 skillRefs ∧ 目录名 ∈ daemon 技能库清单（skillsDir() 的一级目录名集合）∧ 非 git 跟踪`——daemon 只裁剪「自己 link 进来的副本」，项目自带的正式技能（git 跟踪）与用户自建目录（不在 daemon 库）一律不碰；裁剪功能对非 git 工作目录（生产任务场景）保持有效。改动收敛在 skill-manager.ts 单函数 + 一条 `git ls-files` 查询，两个调用方（task-runner.ts:499 batch / daemon.ts:9789 interactive）零改动自动受益。

选「git ls-files 判定」而非「link 时打标记」的原因：标记要兼容历史已 link 的存量目录（老会话/老任务残留无标记），而 git 跟踪状态是即时事实、无状态同步问题；代价是 prune 路径多一条 git 子进程（启动路径一次性，非每轮，可接受）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：
- 修改 `pruneSkillsToSubset(workDir, skillRefs, leaseId)`（sillyhub-daemon/src/skill-manager.ts）：**函数签名不变**，行为收紧——删除条件变为三重与（见做法概述）；新增内部步骤：①readdir `skillsDir()` 取 daemon 技能库名集合（读失败 → 空集，此时三重与恒不成立 → 全保留，宁可不裁不误删）；②在 workDir 跑一次 `git -C <workDir> ls-files -z .claude/skills`（15s 超时、execFile 非 shell、失败/非仓/超时 → null 视为「无跟踪信息」），从输出路径提取 `.claude/skills/<一级目录名>` 集合；③被保护跳过的目录打 `prune_skill_kept` info 日志（含原因 tracked/unmanaged），审计可见。
- 无端点、无 DTO、无 schema 变化；task-runner.ts / daemon.ts 调用点零改动（参数与返回类型不变，返回值仍为 void）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。prune 是启动路径上的单次同步调用（spawn 前步骤 2.7 / interactive skills 步骤），无事件流；git ls-files 读的是当时 index 的即时事实。若并行会话 A 正 prune、B 在改 skills 目录——与现状同一窗口（readdir 与 rm 之间本就存在 TOCTOU），rm 对不存在的路径 force=true 幂等，不新增风险面。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：与现状同构。多会话共享同一 workDir 时 prune 各自独立执行；三重与只收窄删除集（新逻辑删除的目录是旧逻辑删除集的**子集**），不引入新写冲突。git ls-files 是只读子进程（不写 index），与用户 git 操作并发安全。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。prune 无跨调用状态（既有签名无缓存）；单目录 rm 失败仅 warn 不中断（既有语义保留）；git 子进程超时走同一 try/catch 收口为 null（按无跟踪信息处理 → managed 条件仍兜底，不会把删除面放大到旧逻辑之上）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。git ls-files 以 `cwd=workDir` 执行（daemon 兼容 linked worktree/子模块——ls-files 在 worktree 内语义正确）；skillsDir() 是 daemon 单例目录（全机共享的技能库清单，本就该全局判定）；多 daemon 实例各自进程内计算，无共享态。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是「裁剪失效感」——git 仓库里的技能目录不再被删，会话 agent 能看到（读到）全部仓库自带技能，超出会话勾选的技能面。定性：技能只是说明书文档，读取面放宽不改变工具权限面；且平台技能下线本就走「仓库提交」通道（2026-10-23 实证 b6f3114d9），daemon prune 对 git 仓的删除本就属于越权行为。缓解：`prune_skill_kept` 日志保留可观测。次风险：`git ls-files` 在超大仓的耗时——限定 pathspec `.claude/skills` 后输出量级为技能文件数（几十到几百行），15s 超时兜底，启动路径一次性可接受。

试过放弃的方案：①link 时打 marker 文件/命名约定——存量已 link 目录无 marker，需迁移清理，且 marker 本身又落在工作区（新污染），放弃；②workDir 是 git 仓则整体跳过 prune——判定太粗，daemon link 副本在 git 仓里（.gitignore 了 .claude/skills 的部署形态）也无法清理，放弃；③删除改移动到 daemon 回收站——仍改工作区，只解决可恢复不解决「不该动」，放弃；④把 `.claude/skills` 整体加 gitignore——动仓库契约、影响技能作为正式文件分发的既有形态，放弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/skill-manager.ts | pruneSkillsToSubset 三重与删除条件 + git ls-files 跟踪判定 + prune_skill_kept 日志 |
| 修改 | sillyhub-daemon/tests/skill-manager.test.ts | 三重与用例：git 跟踪保留 / daemon 副本裁剪 / 用户自建保留 / git 失败降级 / 空 daemon 库全保留 |
