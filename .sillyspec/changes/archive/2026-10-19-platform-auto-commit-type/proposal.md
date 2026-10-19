---
author: flow-machine-draft
created_at: 2026-10-19T03:07:50.552Z
---
# 提案书（Proposal）— 2026-10-19-platform-auto-commit-type

## 动机

任务原话转写：平台侧自动写入变更类型闭环

动机：变更类型已上线显示与筛选，但类型落库目前依赖人工回填脚本 + 人工点重扫描。不动 sillyspec CLI 的前提下，用平台已有数据闭环自动分类：轻量出身变更归档时 CLI 生成 timeline.md（含提交哈希+标题，「任务面」行锚定本变更自己的交付提交哈希——哈希交集天然排除并行变更噪音，标题截断只伤尾部不伤开头类型前缀）；平台 reparse 从中提取 conventional 主类型作权威类型。配合 spec-sync 收到 flow-state.yaml/timeline.md 写入时自动触发 scoped reparse，归档后类型秒级自动落库显示，全程无人操作。

成功标准：
- C 件 parser：reparse 对含 timeline.md 的变更，从「任务面」锚定哈希 × 🔀 行标题提取白名单内主类型（优先级 feat/fix > perf/refactor/test > docs/style > build/chore/revert），作权威类型（允许覆盖；flow-state.yaml 显式 commit_type 字段仍最优先，目录推断兜底不变）；无 timeline/无锚定哈希/无命中类型 → 回落不写
- B 件同步重扫：spec-sync 落盘 ops 后，路径命中 flow-state.yaml 或 timeline.md 的变更键集合非空时，以后台任务对该集合跑 scoped reparse（独立 session、失败仅告警不阻断同步响应）
- 聚焦测试：timeline 提取用例（含并行噪音排除/截断标题/无锚回退）+ 键集合提取纯函数用例 + 既有 parser/reparse 测试零回归；ruff/mypy 干净
- 部署 dogfood：生产部署后对既有两工作区重扫描，timeline 可提取的变更类型分布扩大（此前 no_match 部分被补上），后续新归档变更无需任何人工操作自动带类型

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. C 件 parser：reparse 对含 timeline.md 的变更，从「任务面」锚定哈希 × 🔀 行标题提取白名单内主类型（优先级 feat/fix > perf/refactor/test > docs/style > build/chore/revert），作权威类型（允许覆盖；flow-state.yaml 显式 commit_type 字段仍最优先，目录推断兜底不变）；无 timeline/无锚定哈希/无命中类型 → 回落不写
2. B 件同步重扫：spec-sync 落盘 ops 后，路径命中 flow-state.yaml 或 timeline.md 的变更键集合非空时，以后台任务对该集合跑 scoped reparse（独立 session、失败仅告警不阻断同步响应）
3. 聚焦测试：timeline 提取用例（含并行噪音排除/截断标题/无锚回退）+ 键集合提取纯函数用例 + 既有 parser/reparse 测试零回归；ruff/mypy 干净
4. 部署 dogfood：生产部署后对既有两工作区重扫描，timeline 可提取的变更类型分布扩大（此前 no_match 部分被补上），后续新归档变更无需任何人工操作自动带类型

## 成功标准（可验证）

1. C 件 parser：reparse 对含 timeline.md 的变更，从「任务面」锚定哈希 × 🔀 行标题提取白名单内主类型（优先级 feat/fix > perf/refactor/test > docs/style > build/chore/revert），作权威类型（允许覆盖；flow-state.yaml 显式 commit_type 字段仍最优先，目录推断兜底不变）；无 timeline/无锚定哈希/无命中类型 → 回落不写
2. B 件同步重扫：spec-sync 落盘 ops 后，路径命中 flow-state.yaml 或 timeline.md 的变更键集合非空时，以后台任务对该集合跑 scoped reparse（独立 session、失败仅告警不阻断同步响应）
3. 聚焦测试：timeline 提取用例（含并行噪音排除/截断标题/无锚回退）+ 键集合提取纯函数用例 + 既有 parser/reparse 测试零回归；ruff/mypy 干净
4. 部署 dogfood：生产部署后对既有两工作区重扫描，timeline 可提取的变更类型分布扩大（此前 no_match 部分被补上），后续新归档变更无需任何人工操作自动带类型
