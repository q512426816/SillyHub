# TASKS: agent-stage-dispatch plan

## 目标
为变更 `agent-stage-dispatch` 完成 SillySpec plan 阶段。

## 背景
propose 阶段已完成，产出：
- `.sillyspec/changes/agent-stage-dispatch/proposal.md` — 动机、7 Phase 变更范围
- `.sillyspec/changes/agent-stage-dispatch/design.md` — 目标架构 + 详细设计
- `.sillyspec/changes/agent-stage-dispatch/requirements.md` — 10 个 FR
- `.sillyspec/changes/agent-stage-dispatch/tasks.md` — 22 个 Task（按 Phase 分组）

## 执行方式
使用 sillyspec CLI：
```bash
sillyspec run plan --change agent-stage-dispatch
```
按 CLI 输出的 step prompt 逐步执行。每完成一步用 `--done` 提交。

## 关键规则
- 所有文档写入 `.sillyspec/changes/agent-stage-dispatch/`
- 先读 tasks.md 理解 22 个 task，然后按 CLI step prompt 排优先级
- 每步完成立即 --done
- 只产出文档，禁止改代码
- 不要编造 CLI 子命令
- plan.md 必须包含 Wave 分组（哪些 task 哪个 Wave）
