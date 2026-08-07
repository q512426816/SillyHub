---
author: qinyi
created_at: 2026-08-06 09:07:53
---

# 任务清单（Tasks）— scan 文档 drift 检测门

> 只列任务名，细节在 plan 阶段展开。

- task-01: 刷新 scan 文档（重跑 sillyspec scan，source_commit 推到当前 HEAD，顺带修失效文件路径引用）— FR-05, D-003
- task-02: `scripts/scan-drift-check.py` 检测脚本（双信号：source_commit 时效 + 文件路径存在性；warn 注解 + 人类可读输出）+ 单元测试 — FR-01, FR-02, FR-04, FR-07, D-001
- task-03: `.github/workflows/scan-drift.yml` CI workflow（warn-only + `::warning` 注解 + 去重 PR 评论汇总）— FR-03, D-002
- task-04: `.sillyspec/local.yaml` 加 `scan:check` 命令别名 + 收尾自测（刷新后脚本在 scan 文档集 0 漂移）— FR-06
