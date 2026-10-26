# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend | `backend/app/modules/change/schema.py` | 接口变更（DTO additive 三 optional 字段） | ✅（S2 acceptance 已审） |
| backend | `backend/app/modules/change/service.py` | 逻辑变更（进度投影 additive） | ✅（S2 acceptance 已审） |
| backend | `backend/app/modules/daemon/router/heartbeat.py` | 逻辑变更（进度投影 additive） | ✅（S2 acceptance 已审） |
| backend | `backend/openapi.json` | 接口变更（生成物，随 schema 同步） | ✅（S2 acceptance 已审） |
| backend | `backend/app/modules/change/tests/test_progress_projection_ext.py` | 新增（聚焦测试） | ✅（S2 acceptance 已审） |
| backend | `backend/app/modules/daemon/tests/test_heartbeat_thin_flows.py` | 新增（聚焦测试） | ✅（S2 acceptance 已审） |
| components-daemon | `frontend/src/components/daemon/change-progress-row.tsx` | 新增（UI 组件） | ✅（S2 acceptance 已审） |
| components-daemon | `frontend/src/components/daemon/change-total-progress-ring.tsx` | 新增（UI 组件） | ✅（S2 acceptance 已审） |
| components-daemon | `frontend/src/components/daemon/session-change-files-hover.tsx` | 逻辑变更（进度投影 additive） | ✅（S2 acceptance 已审） |
| lib-api | `frontend/src/lib/api-types.ts` | 配置变更（gen:types 生成物） | ✅（S2 acceptance 已审） |
| sillyhub-daemon | `sillyhub-daemon/src/sillyspec-manager.ts` | 逻辑变更（新增采集执行器+三态） | ✅（S2 acceptance 已审） |
| sillyhub-daemon | `sillyhub-daemon/src/hub-client.ts` | 接口变更（心跳载荷 thin_flows 键 additive） | ✅（S2 acceptance 已审） |
| sillyhub-daemon | `sillyhub-daemon/src/api-types.ts` | 配置变更（gen:types 生成物） | ✅（S2 acceptance 已审） |
| sillyhub-daemon | `sillyhub-daemon/tests/sillyspec-flow-status-collector.test.ts（实际落位，vitest include 工程现实） | 新增（聚焦测试） | ✅（S2 acceptance 已审） |
| test-utils | `frontend/src/components/daemon/__tests__/change-progress-row.test.tsx` | 新增（聚焦测试） | ✅（S2 acceptance 已审） |
| test-utils | `frontend/src/components/daemon/__tests__/change-total-progress-ring.test.tsx` | 逻辑变更（进度投影 additive） | ✅（S2 acceptance 已审） |
| test-utils | `frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx` | 逻辑变更（进度投影 additive） | ✅（S2 acceptance 已审） |

## 未匹配文件

无（全部变更文件已归属到模块）。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 更新backend模块卡（本次变更涉及） | deferred→archive（归档阶段模块影响蒸馏统一登记，sillyspec-archive 标准步骤） |
| `modules/components-daemon.md` | 更新components-daemon模块卡（本次变更涉及） | deferred→archive（同上） |
| `modules/lib-api.md` | 更新lib-api模块卡（本次变更涉及） | deferred→archive（同上） |
| `modules/sillyhub-daemon.md` | 更新sillyhub-daemon模块卡（本次变更涉及） | deferred→archive（同上） |
| `modules/test-utils.md` | 更新test-utils模块卡（本次变更涉及） | deferred→archive（同上） |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

## 三重核对裁决（archive Step 2，2026-10-26）

- diff 有而未列的 32 个 `.sillyspec/docs/**/modules/*.changelog.md`：CLI decision-distill/FR 入库时自动生成的 changelog 产物，非本变更代码面——裁决「不参与核对」（CLI 注释同口径）。
- module-impact 列而 diff 无的 6 项（5 张模块卡 + 注记）：五张模块卡已于本步骤登记（modules/backend.md / components-daemon.md / lib-api.md / sillyhub-daemon.md / test-utils.md 各追加 change 条目），diff 随登记产生，闭环。
