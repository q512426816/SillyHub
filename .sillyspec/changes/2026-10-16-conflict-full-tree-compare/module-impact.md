# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend | `backend/app/modules/daemon/sillyspec_compare.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/modules/daemon/router/machines.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/modules/daemon/tests/test_sillyspec_compare.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/openapi.json` | <!--TODO--> | <!--TODO--> |
| components-changes | `frontend/src/components/changes/conflict-compare-modal.tsx` | <!--TODO--> | <!--TODO--> |
| components-changes | `frontend/src/components/changes/platform-sync-section.tsx` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/src/components/changes/__tests__/platform-sync-section.test.tsx` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/src/components/prototype/conflict-sync-states-view.tsx` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/scripts/prototype-build.mjs` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/prototype-dist/conflict-sync-states.html` | <!--TODO--> | <!--TODO--> |
| lib-api | `frontend/src/lib/api-types.ts` | <!--TODO--> | <!--TODO--> |
| lib-spec-workspaces | `frontend/src/lib/spec-workspaces.ts` | <!--TODO--> | <!--TODO--> |
| sillyhub-daemon | `sillyhub-daemon/src/api-types.ts` | <!--TODO--> | <!--TODO--> |

## 未匹配文件

无（全部变更文件已归属到模块）。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 更新backend模块卡（本次变更涉及） | pending |
| `modules/components-changes.md` | 更新components-changes模块卡（本次变更涉及） | pending |
| `modules/frontend.md` | 更新frontend模块卡（本次变更涉及） | pending |
| `modules/lib-api.md` | 更新lib-api模块卡（本次变更涉及） | pending |
| `modules/lib-spec-workspaces.md` | 更新lib-spec-workspaces模块卡（本次变更涉及） | pending |
| `modules/sillyhub-daemon.md` | 更新sillyhub-daemon模块卡（本次变更涉及） | pending |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
