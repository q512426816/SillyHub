---
author: qinyi
created_at: 2026-10-27 10:16:21
generated_by: sillyspec-fourpiece-init
---
# 任务清单（Tasks）— 2026-10-27-archive-reparse-oom-governance

<!-- plan 阶段将按 Wave 展开细化；本清单为 brainstorm 出口的种子任务面 -->

- [ ] task-01: `_compute_reparse_scope` 收窄 archive_hit——归档路径树形 op 改 scoped+structural 三元组返回，退化情形（archive 根/无名）保留全量兜底（FR-01）
- [ ] task-02: `_trigger_change_reparse` 双通道——structural 立即调度（跳 120s 窗、保 single-flight 与尾随语义），非结构维持现状（FR-01/FR-02）
- [ ] task-03: reparse 完成处补 `reparse_converged` 统计日志（scope 数/耗时/通道）（FR-05）
- [ ] task-04: bundle gzip 同版本 single-flight 在建互斥（共享 Future 复用产物）（FR-03）
- [ ] task-05: drift_probe.py——漂移抽样核对（只读只告警）+ cgroup 水位日志（无 cgroup 静默跳过）（FR-04）
- [ ] task-06: main.py lifespan 挂载 drift_probe_loop（照 scheduled_send_sweeper 模式，cancel+gather 关停）（FR-04）
- [ ] task-07: 测试锁 test_archive_scoped_reparse.py——归档 scoped 化主路径（location/文档路径翻转）+ 并行多归档场景 + 节流窗零回归 + scope 外零动作 + 删除红线/孤儿候选四问 + bundle 并发单建 + 探针只读性（FR-01..FR-05 全覆盖）
- [ ] task-08: 模块文档同步（spec_workspace 模块卡/changelog 记归档 scoped 化与新观测面）
