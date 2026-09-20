---
author: qinyi
created_at: 2026-09-20T20:05:24
---
# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| sillyhub-daemon（sillyspec RPC 投影） | sillyhub-daemon/src/sillyspec-manager.ts | 接口变更（RPC result 增量字段 cross_repo/repos[]，additive）+ 数据结构变更（TS 接口三新类） | 否（additive，契约 v2 权威源已定） |
| sillyhub-daemon（测试） | sillyhub-daemon/tests/sillyspec-file-diff.test.ts | 新增（v2 投影用例组） | 否 |
| backend:change（契约层） | backend/app/modules/change/schema.py | 数据结构变更（ScopeAuditRow.cross_repo + ScopeAuditRepo 族 + Response.repos） | 否 |
| backend:change（服务层） | backend/app/modules/change/scope_audit.py | 逻辑变更（get_scope_audit 透传投影，防御构造） | 否 |
| backend:change（测试） | backend/app/modules/change/tests/test_scope_file_diff.py | 新增（repos 透传/回退用例） | 否 |
| backend（OpenAPI 生成物） | backend/openapi.json | 数据结构变更（gen:types 生成物，随 schema 同步） | 否 |
| frontend:changes（对账卡） | frontend/src/components/changes/scope-audit-command-card.tsx | 逻辑变更（分组渲染双分支）+ 接口变更消费（api-types 新字段） | 否（原型已确认） |
| frontend:changes（测试） | frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx | 新增（分组/回退/分桶用例） | 否 |
| frontend:mobile（回归） | frontend/src/components/mobile/mobile-change-detail.test.tsx | 逻辑变更（仅当卡片桩需调整；默认只跑不改） | 否 |
| frontend:changes（回归） | frontend/src/components/changes/__tests__/quicklog-drawer.test.tsx | 逻辑变更（仅当卡片桩需调整；默认只跑不改） | 否 |
| frontend:lib（生成物） | frontend/src/lib/api-types.ts | 数据结构变更（gen:types 生成物，随 OpenAPI 同步） | 否 |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

（裁决：全部为**模块索引覆盖面不足**，非游离文件——_module-map.yaml 是 multi-agent-platform 根项目视角的索引（scan 基线 ba87eec 已落后源码 2553 commit），子项目内部模块（sillyhub-daemon 的 sillyspec-manager、backend change 模块细分、frontend changes 组件域）未被 paths 前缀收录。归属判定见上矩阵「模块」列，按子项目 scan 文档（.sillyspec/docs/{sillyhub-daemon,backend,frontend}/scan/）口径标注。）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 模块索引覆盖面不足（子项目内部模块未收录，非本变更引入）；是否 rebuild 属全局治理决策，不在本变更内动 | skipped（原因：索引过期为存量债，本变更按子项目 scan 文档口径判定归属；rebuild 建议在归档时另行评估） |
