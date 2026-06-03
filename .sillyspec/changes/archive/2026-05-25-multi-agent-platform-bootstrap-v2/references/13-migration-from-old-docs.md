# 13 — 从旧文档包迁移到 SillySpec Native 结构

## 1. 旧问题

之前生成的文档包使用了理想化结构：

```text
requirements/
architecture/
plans/
risks/
tasks/
```

这不符合 SillySpec 真实变更包结构。

## 2. 新结构

应迁移为：

```text
.sillyspec/changes/change/2026-05-25-multi-agent-platform-bootstrap-v2/
  MASTER.md
  proposal.md
  requirements.md
  design.md
  plan.md
  tasks.md
  verification.md
  tasks/
  references/
```

## 3. 迁移策略

- 需求类内容合并到 `requirements.md`。
- 架构类内容进入 `design.md` 或 `references/`。
- 风险类内容进入 `references/05-permission-and-risk.md` 和 `references/14-risk-register.md`。
- 任务类内容进入 `tasks.md` 和 `tasks/task-xx.md`。
- 技术选型进入 `design.md`。
