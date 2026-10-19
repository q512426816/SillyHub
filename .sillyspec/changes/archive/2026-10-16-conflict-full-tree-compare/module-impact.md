# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend | `backend/app/modules/daemon/sillyspec_compare.py` | 逻辑变更+接口变更（full-tree 兜底+响应三可选字段+文案） | 已对账（聚焦回归 44 用例+生产复验） |
| backend | `backend/app/modules/daemon/router/machines.py` | 接口变更（响应 schema 三可选字段） | 已对账（聚焦回归 44 用例+生产复验） |
| backend | `backend/app/modules/daemon/tests/test_sillyspec_compare.py` | 新增（兜底/段边界/kind 分支用例） | 已对账（聚焦回归 44 用例+生产复验） |
| backend | `backend/openapi.json` | 接口变更（schema 同步） | 已对账（聚焦回归 44 用例+生产复验） |
| components-changes | `frontend/src/components/changes/conflict-compare-modal.tsx` | 逻辑变更（四臂失败卡+来源提示条） | 已对账（聚焦回归 44 用例+生产复验） |
| components-changes | `frontend/src/components/changes/platform-sync-section.tsx` | 新增（行级「标记已处理」入口） | 已对账（聚焦回归 44 用例+生产复验） |
| frontend | `frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx` | 新增（分支与提示用例） | 已对账（聚焦回归 44 用例+生产复验） |
| frontend | `frontend/src/components/changes/__tests__/platform-sync-section.test.tsx` | 新增（渲染/确认/消失/只读用例） | 已对账（聚焦回归 44 用例+生产复验） |
| frontend | `frontend/src/components/prototype/conflict-sync-states-view.tsx` | 逻辑变更（原型视图对账） | 已对账（聚焦回归 44 用例+生产复验） |
| frontend | `frontend/scripts/prototype-build.mjs` | 逻辑变更（重编译对账） | 已对账（聚焦回归 44 用例+生产复验） |
| frontend | `frontend/prototype-dist/conflict-sync-states.html` | 逻辑变更（产物重编译，git diff 为空） | 已对账（聚焦回归 44 用例+生产复验） |
| lib-api | `frontend/src/lib/api-types.ts` | 接口变更（gen:types 重生成） | 已对账（聚焦回归 44 用例+生产复验） |
| lib-spec-workspaces | `frontend/src/lib/spec-workspaces.ts` | 新增（resolveSpecConflict 客户端函数） | 已对账（聚焦回归 44 用例+生产复验） |
| sillyhub-daemon | `sillyhub-daemon/src/api-types.ts` | 接口变更（双端同步重生成） | 已对账（聚焦回归 44 用例+生产复验） |

## 未匹配文件

无（全部变更文件已归属到模块）。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 更新backend模块卡→changelog 变更索引条目（backend.md 契约摘要经 changelog 记录） | done |
| `modules/components-changes.md` | 更新components-changes模块卡→changelog 变更索引条目 | done |
| `modules/frontend.md` | 更新frontend模块卡→changelog 变更索引条目 | done |
| `modules/lib-api.md` | 更新lib-api模块卡→changelog 变更索引条目 | done |
| `modules/lib-spec-workspaces.md` | 更新lib-spec-workspaces模块卡→新建 changelog 变更索引条目 | done |
| `modules/sillyhub-daemon.md` | 更新sillyhub-daemon模块卡→changelog 变更索引条目 | done |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
