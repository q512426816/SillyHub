# 【活跃坑】execute 启动自动勾选器把 TaskCard 文件存在误判为「提交证据」勾满任务

- 发现：2026-10-14-session-turn-preview-cards（execute Step 2 加载上下文时）
- 现象：`sillyspec run execute` Step 2 --done 后 CLI 输出「✅ [自动勾选] 4 个任务有提交证据但未勾——已机器代勾（full-autopilot-parity）」，将 tasks.md 全部 4 个 task-XX 勾成 `[x]`——**当时一行生产代码都没写**（TaskCard/plan/decisions 等 `.sillyspec` 文档存在疑似被当作「提交证据」）。若不核实，进度记录与真实完成度脱节（违反「任务勾选唯一真相」原则），verify 阶段对账会踩空。
- 处置：人工 `sed` 改回 `- [ ]`，代码完成后再勾。
- 影响：自动化便利（省手动勾）与准确性冲突；静默代勾无差异清单输出，依赖 agent 主动发现。
- 期望：自动勾选的证据判据收紧为「worktree git log 中存在引用 task-XX 的 commit」而非文档文件存在；或代勾时列出证据明细供人工复核。
- 复现：2026-10-14 会话，execute Step 2 --done（sillyspec 3.32.8，Windows）。

## 处置记录（2026-10-16）

**已修**（sillyspec `2026-10-15-pitfall-batch-clearance`，a493aef1，两轮评审 PASS）：自动勾选
重构为 `autoTickTasksFromCommitSubjects`——判据 = 区间提交 **subject token × 该 task
allowed_paths 实现事实锚**（正文提及不勾、文档存在不算证据），无锚不勾。坑现场形态
（TaskCard 文档被当提交证据勾满）不可达。测试随变更 792/792 全绿。归档。
