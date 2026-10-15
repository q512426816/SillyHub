---
author: flow-machine-draft
created_at: 2026-10-15T16:16:15.322Z
---
# 决策记录（Decisions）— 2026-10-16-proto-pipeline-discoverability

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- 风险1：CONVENTIONS.md 全量重扫覆盖指针节。对策：接受（重扫由人触发且低频；local.yaml 登记位与注释永不丢失，是持久底座）。 - 风险2：YAML 手写缩进错导致解析失败回落未登记态。对策：FR-03 以 readUiPrototypeForm 实测登记成功为验收；失败即修。 - 死路：考虑过把两份规约复制落档到本图 scan 面——放弃：双源必漂移（PROTOTYPE.md 是活文档）；指针优于副本。
