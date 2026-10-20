---
author: flow-machine-draft
created_at: 2026-10-20T00:36:02.870Z
---
# 提案书（Proposal）— 2026-10-20-sillyspec-gotchas-session

## 动机

任务原话转写：记录sillyspec工具负面问题四条入知识库

动机与背景：2026-10-20 两连轻量变更（backfill-dryrun-log-scrub、root-ruff-config）全程使用 sillyspec CLI，收口汇报中积累的工具体验负面问题需按用户指令「负面问题记录下」沉淀到知识库 sillyspec-gotchas.md（含 INDEX 索引同步），供后续会话与工具改进参考。四条：①route-hindsight 改写率阈值对小任务偏紧且拦截成本错位到下一变更；②flow done dirty 缺口三选一缺「并行会话文件」处置选项；③归档提交 pathspec 打印→执行窗口的共享暂存区竞态（归档提交不自动执行是根源之一）；④design 四问「题面逐字钉死」规则只在报错时才学到。（选道声明：用户显式指令记录，需求已含决策）

成功标准：
- sillyspec-gotchas.md 新增 4 条目（格式对齐既有条目：## 标题+机理+规避/做法+来源标注时点与 CLI 版本）
- INDEX.md SillySpec 坑段同步 4 行关键词索引（锚点与条目标题一致）
- sillyspec knowledge validate 0 错 0 警

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. sillyspec-gotchas.md 新增 4 条目（格式对齐既有条目：## 标题+机理+规避/做法+来源标注时点与 CLI 版本）
2. INDEX.md SillySpec 坑段同步 4 行关键词索引（锚点与条目标题一致）
3. sillyspec knowledge validate 0 错 0 警

## 成功标准（可验证）

1. sillyspec-gotchas.md 新增 4 条目（格式对齐既有条目：## 标题+机理+规避/做法+来源标注时点与 CLI 版本）
2. INDEX.md SillySpec 坑段同步 4 行关键词索引（锚点与条目标题一致）
3. sillyspec knowledge validate 0 错 0 警
