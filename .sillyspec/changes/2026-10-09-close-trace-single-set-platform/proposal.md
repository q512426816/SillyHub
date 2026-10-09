---
author: flow-machine-draft
created_at: 2026-10-09T07:21:15.088Z
---
# 提案书（Proposal）— 2026-10-09-close-trace-single-set-platform

## 动机

任务原话转写：CLI 侧 2026-10-09-close-trace-single-set（sillyspec 仓）把收口留痕四件套收敛为单套（只落 change.patch + change-patch.json，对账面并入 change-patch.json 的 scopeAudit 子对象）——平台侧配套三件小改：前端 structured-views 新增 change-patch.json 结构化渲染分支（清单摘要 + scopeAudit 子对象复用 ScopeAuditView；旧 scope-audit.json 分支保留兜存量归档）；后端 schema.py ChangePatchMeta 契约注释补 scopeAudit 子对象说明（纯 docstring，DTO 字段零变化，无需 gen:types）；跨仓契约文档 thin-flow-done-no-scope-audit-snapshot.md 追加单套演进注记。

成功标准：
- 前端 change-patch.json 文件预览渲染结构化清单面（变更名/patch 状态/文件数/±行数/锚点/sha/冻结时间 + 交付文件表），scopeAudit 子对象在场时叠加对账快照视图，缺席时降级说明
- 旧形态归档（四件套/heavy 双件）预览不回归：scope-audit.json 结构化分支与后端回退链原样保留
- tsc --noEmit 通过；change 模块相关测试无新增失败（预存环境错误除外）

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 前端 change-patch.json 文件预览渲染结构化清单面（变更名/patch 状态/文件数/±行数/锚点/sha/冻结时间 + 交付文件表），scopeAudit 子对象在场时叠加对账快照视图，缺席时降级说明
2. 旧形态归档（四件套/heavy 双件）预览不回归：scope-audit.json 结构化分支与后端回退链原样保留
3. tsc --noEmit 通过；change 模块相关测试无新增失败（预存环境错误除外）

## 成功标准（可验证）

1. 前端 change-patch.json 文件预览渲染结构化清单面（变更名/patch 状态/文件数/±行数/锚点/sha/冻结时间 + 交付文件表），scopeAudit 子对象在场时叠加对账快照视图，缺席时降级说明
2. 旧形态归档（四件套/heavy 双件）预览不回归：scope-audit.json 结构化分支与后端回退链原样保留
3. tsc --noEmit 通过；change 模块相关测试无新增失败（预存环境错误除外）
