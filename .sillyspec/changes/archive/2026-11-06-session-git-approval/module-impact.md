# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend | `backend/app/modules/daemon/session/service/git_diff.py` | 新增 | 否（QA 验收已审） |
| backend | `backend/app/modules/daemon/router/session_crud.py` | 接口变更（新增只读端点 git-diff） | 否（QA 验收已审） |
| backend | `backend/openapi.json` | 接口变更（git-diff schema 增量） | 否（生成物） |
| components-daemon | `frontend/src/components/daemon/git-approval-card.tsx` | 新增 | 否（QA 验收已审） |
| components-daemon | `frontend/src/components/daemon/pending-dialog-dock.tsx` | 逻辑变更（dialog_kind 分流） | 否（存量 7 用例零回归） |
| frontend | `frontend/src/components/daemon/session-panel/session-panel-page.tsx` | 无实际改动（design 声明修改，分流收敛 dock 后零 diff——QA gap 合理调整） | 否 |
| frontend | `frontend/src/components/daemon/session-panel/session-panel-dialog.tsx` | 无实际改动（同上） | 否 |
| frontend | `frontend/src/components/prototype/git-approval-view.tsx` | 新增（原型，批准冻结） | 否 |
| frontend | `frontend/scripts/prototype-build.mjs` | 配置变更（VIEWS 登记） | 否 |
| lib-api | `frontend/src/lib/api-types.ts` | 接口变更（生成物增量） | 否（生成物） |
| sillyhub-daemon | `sillyhub-daemon/src/interactive/git-command-guard.ts` | 新增 | 否（41 用例） |
| sillyhub-daemon | `sillyhub-daemon/src/interactive/git-approval-collector.ts` | 新增 | 否（15 用例） |
| sillyhub-daemon | `sillyhub-daemon/tests/interactive/git-approval-collector.test.ts` | 新增（测试） | 否 |
| sillyhub-daemon | `sillyhub-daemon/src/interactive/git-executor.ts` | 新增 | 否（7 用例） |
| sillyhub-daemon | `sillyhub-daemon/src/interactive/session-manager/permission.ts` | 逻辑变更（git 拦截分支+分发） | 否（35 用例） |
| sillyhub-daemon | `sillyhub-daemon/src/interactive/session-manager/driver-factory.ts` | 逻辑变更（git 审批接线） | 否（wiring 用例） |
| sillyhub-daemon | `sillyhub-daemon/tests/interactive/git-command-guard.test.ts` | 新增（测试） | 否 |
| sillyhub-daemon | `sillyhub-daemon/tests/interactive/git-executor.test.ts` | 新增（测试） | 否 |
| sillyhub-daemon | `sillyhub-daemon/src/api-types.ts` | 接口变更（生成物增量） | 否（生成物） |
| test-utils | `frontend/src/components/daemon/__tests__/git-approval-card.test.tsx` | 新增（测试） | 否 |

## 未匹配文件

无（全部变更文件已归属到模块）。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 更新backend模块卡（本次变更涉及） | done |
| `modules/components-daemon.md` | 更新components-daemon模块卡（本次变更涉及） | done |
| `modules/frontend.md` | 更新frontend模块卡（本次变更涉及） | done |
| `modules/lib-api.md` | 更新lib-api模块卡（本次变更涉及） | done |
| `modules/sillyhub-daemon.md` | 更新sillyhub-daemon模块卡（本次变更涉及） | done |
| `modules/test-utils.md` | 更新test-utils模块卡（本次变更涉及） | done |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
