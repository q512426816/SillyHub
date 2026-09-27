---
author: flow-machine-draft
created_at: 2026-09-27T09:43:47.554Z
---
# 提案书（Proposal）— 2026-09-27-knowledge-governance-cards

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:0be8b836687b35c81e9d791d88e20c3d8079653a26cf86899c8eaa29bc15e3cc:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-knowledge-governance-cards 留痕重锚 -->
任务原话转写：知识资产治理三层设计出口（用户确认看平台）：CLI 侧 digest 已落（sillyspec 仓 2026-09-27-knowledge-digest），平台侧无消费面——rot 待复核/收件箱积压/伪域落库三类信号沉睡在已同步的 knowledge 树里，用户无页面可见。本件建平台侧信号卡。
成功标准：
- backend knowledge 模块新增 GET /workspaces/{ws}/knowledge/governance（KNOWLEDGE_READ）：从平台已同步 spec 内容根直接计算三类信号（rot 待复核行按域计数阈 100 / uncategorized.md 收件箱阈 20 / auto-*+unmapped 伪域条目阈 0——与 CLI digest 同构口径，绑定类信号留 CLI 侧因需仓工作树在场），返回 healthy/signals/totals
- frontend 知识 tab 顶部新增治理信号卡区：healthy 一行安语、超阈逐卡（kind/计数/明细/处置指引——CLI 命令文案）；取数走既有 api 模式（react-query）
- pytest 覆盖端点（三类信号 fixture + 阈内 healthy + 权限）+ vitest 组件测试（渲染/healthy/计数）
- 显式 pathspec 提交，不夹带并行会话 staged 面
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:87b76baf796824a437fe7341c994e6144c5c208b0ff1638d0bc0e1e6bc3548e5:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-knowledge-governance-cards 留痕重锚 -->
按成功标准机械推导，共 5 条验收面：
1. backend knowledge 模块新增 GET /workspaces/{ws}/knowledge/governance（KNOWLEDGE_READ）：从平台已同步 spec 内容根直接计算三类信号（rot 待复核行按域计数阈 100 / uncategorized.md 收件箱阈 20 / auto-*+unmapped 伪域条目阈 0——与 CLI digest 同构口径，绑定类信号留 CLI 侧因需仓工作树在场），返回 healthy/signals/totals
2. frontend 知识 tab 顶部新增治理信号卡区：healthy 一行安语、超阈逐卡（kind/计数/明细/处置指引——CLI 命令文案）
3. 取数走既有 api 模式（react-query）
4. pytest 覆盖端点（三类信号 fixture + 阈内 healthy + 权限）+ vitest 组件测试（渲染/healthy/计数）
5. 显式 pathspec 提交，不夹带并行会话 staged 面
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:24cb94a00a6b19eac6a1417ef8d917da090ee1909b6a14e8e6149f65cd3d6d66:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-knowledge-governance-cards 留痕重锚 -->
1. backend knowledge 模块新增 GET /workspaces/{ws}/knowledge/governance（KNOWLEDGE_READ）：从平台已同步 spec 内容根直接计算三类信号（rot 待复核行按域计数阈 100 / uncategorized.md 收件箱阈 20 / auto-*+unmapped 伪域条目阈 0——与 CLI digest 同构口径，绑定类信号留 CLI 侧因需仓工作树在场），返回 healthy/signals/totals
2. frontend 知识 tab 顶部新增治理信号卡区：healthy 一行安语、超阈逐卡（kind/计数/明细/处置指引——CLI 命令文案）
3. 取数走既有 api 模式（react-query）
4. pytest 覆盖端点（三类信号 fixture + 阈内 healthy + 权限）+ vitest 组件测试（渲染/healthy/计数）
5. 显式 pathspec 提交，不夹带并行会话 staged 面
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
