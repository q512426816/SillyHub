# 模块影响分析（骨架由 `sillyspec module-impact --change <变更名>` 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| app-workspace-pages | `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx` | 逻辑变更（断言面适配新结构/新增用例） | 否 |
| app-workspace-pages | `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx` | 逻辑变更（断言面适配新结构/新增用例） | 否 |
| app-workspace-pages | `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-tabs.test.tsx` | 新增 | 否 |
| app-workspace-pages | `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx` | 逻辑变更（断言面适配新结构/新增用例） | 否 |
| app-workspace-pages | `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` | 逻辑变更 | 是 |
| components-changes | `frontend/src/components/changes/detail/change-assets-card.tsx` | 逻辑变更 | 是 |
| components-changes | `frontend/src/components/changes/detail/change-assets-graph.tsx` | 逻辑变更 | 是 |
| components-changes | `frontend/src/components/changes/detail/change-files-panel.tsx` | 新增 | 否 |
| components-changes | `frontend/src/components/changes/detail/change-overview-panel.tsx` | 新增 | 否 |
| components-changes | `frontend/src/components/changes/detail/change-overview-side.tsx` | 新增 | 否 |
| components-changes | `frontend/src/components/changes/detail/change-tabs.tsx` | 新增 | 否 |
| components-changes | `frontend/src/components/changes/detail/change-task-checklist.tsx` | 新增 | 否 |
| components-changes | `frontend/src/components/changes/detail/change-unified-timeline.tsx` | 新增 | 否 |
| components-changes | `frontend/src/components/changes/detail/change-usage-card.tsx` | 逻辑变更 | 是 |
| frontend | `frontend/prototype-dist/change-center.html` | 结构变更（原型编译产物重编译/新增，非手改） | 否 |
| frontend | `frontend/prototype-dist/change-detail-v2.html` | 结构变更（原型编译产物重编译/新增，非手改） | 否 |
| frontend | `frontend/prototype-dist/change-detail.html` | 结构变更（原型编译产物重编译/新增，非手改） | 否 |
| frontend | `frontend/prototype-dist/index.html` | 结构变更（原型编译产物重编译/新增，非手改） | 否 |
| frontend | `frontend/prototype-dist/session-portal.html` | 结构变更（原型编译产物重编译/新增，非手改） | 否 |
| frontend | `frontend/prototype-dist/sillyspec-flow.html` | 结构变更（原型编译产物重编译/新增，非手改） | 否 |
| frontend | `frontend/prototype-dist/workspace-list.html` | 结构变更（原型编译产物重编译/新增，非手改） | 否 |
| frontend | `frontend/prototype-dist/workspace-overview.html` | 结构变更（原型编译产物重编译/新增，非手改） | 否 |
| frontend | `frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx` | 逻辑变更（断言面适配新结构/新增用例） | 否 |
| frontend | `frontend/src/components/changes/detail/__tests__/change-assets-fallback.test.tsx` | 新增 | 否 |
| frontend | `frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx` | 逻辑变更（断言面适配新结构/新增用例） | 否 |
| frontend | `frontend/src/components/changes/detail/__tests__/change-files-panel.test.tsx` | 逻辑变更（断言面适配新结构/新增用例） | 否 |
| frontend | `frontend/src/components/changes/detail/__tests__/change-overview-panel.test.tsx` | 逻辑变更（断言面适配新结构/新增用例） | 否 |
| frontend | `frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx` | 逻辑变更（断言面适配新结构/新增用例） | 否 |
| frontend | `frontend/src/components/changes/detail/__tests__/change-tabs.test.tsx` | 逻辑变更（断言面适配新结构/新增用例） | 否 |
| frontend | `frontend/src/components/changes/detail/__tests__/change-task-checklist.test.tsx` | 逻辑变更（断言面适配新结构/新增用例） | 否 |
| frontend | `frontend/src/components/changes/detail/__tests__/change-unified-timeline.test.tsx` | 逻辑变更（断言面适配新结构/新增用例） | 否 |
| frontend | `frontend/src/components/changes/detail/__tests__/merge-change-timeline.test.ts` | 逻辑变更（断言面适配新结构/新增用例） | 否 |
| frontend | `frontend/src/components/changes/detail/merge-change-timeline.ts` | 新增 | 否 |

## 未匹配文件

无（全部变更文件已归属到模块）。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/app-workspace-pages.md` | 更新app-workspace-pages模块卡（本次变更涉及） | done（同上；变更详情页四 tab 结构） |
| `modules/components-changes.md` | 更新components-changes模块卡（本次变更涉及） | done（同上；新增 detail 组件族 7 件 + 测试 8 件） |
| `modules/frontend.md` | 更新frontend模块卡（本次变更涉及） | done（module-docs-sync 已同步 sidecar + updated_at 戳） |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
