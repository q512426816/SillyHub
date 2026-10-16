---
author: flow-machine-draft
created_at: 2026-10-16T02:51:56.489Z
---
# 决策记录（Decisions）— 2026-10-16-knowledge-module-card

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：`_module-map.yaml` 头部标注 generator: sillyspec-scan——后续重跑 scan 若全量重生成可能冲掉手改条目；缓解：文件头同时注明「可手动修改」，scan 为 advisory 流程（人工确认后才落盘），且本条目 paths 是 scan 无法推导的规范资产域（scan 只扫代码路径），冲突概率低。死路：手工把 3 条 FR 剪切粘贴到新文件并自行重编号——已放弃，违反迁域不换号铁律（ID 是绑定/supersede 链寻址键），且伪域文件清理状态（清空 vs 移除）手搬无法与 CLI 的 fr-index 幂等提炼状态机对齐。
