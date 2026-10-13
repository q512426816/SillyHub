# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| components-changes | `frontend/src/components/change-file-tree.tsx` | 逻辑变更（新增可选 autoRefreshMs prop + 定时刷新 effect；默认行为不变有回归测试锚定） | 否（prop 可选向后兼容，既有消费方零改动） |
| lib-api | `frontend/src/lib/api-types.ts` | 接口变更（gen:types 生成物追加 by-session 端点类型，不改既有类型） | 否（纯生成物） |
| lib-changes | `frontend/src/lib/changes.ts` | 新增（listSessionChanges fetch + useSessionChanges hook，不动既有导出） | 否 |
| lib-react-query | `frontend/src/lib/query-keys.ts` | 新增（sessionChanges 键工厂） | 否 |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `backend/app/modules/change/router.py` — 归属 backend 模块（顶层 map `backend/**` 命中；CLI 匹配用子项目 map 无 change 域细分，粒度选择不算索引过期）
- `backend/app/modules/change/service.py` — 同上（backend 模块）
- `backend/app/modules/change/tests/test_session_changes_endpoint.py` — 同上（backend 模块，新增测试）
- `backend/openapi.json` — backend 模块生成物（gen:types 数据源，随端点新增刷新）
- `frontend/src/components/daemon/session-change-files-hover.tsx` — frontend 模块（daemon 会话组件域，新建组件）
- `frontend/src/components/daemon/session-panel/session-panel-page.tsx` — frontend 模块（daemon 会话组件域，19 行挂载接线）
- `frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx` — frontend 模块（新增测试）

（另 `frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx` 新增测试未单列 design 清单行，属 components-changes 域，已随 task-02 提交。）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `frontend.changelog.md` | 追加本变更索引行（前端四文件 + 新组件 + 挂载 + 测试摘要），已随主仓 f2d9879bb 提交（归档 diff 核对时点已不在工作区 diff 内属预期） | done |
| `backend.changelog.md` | 追加本变更索引行（端点 + service 方法 + 测试摘要），已随主仓 f2d9879bb 提交（同上） | done |
| `_module-map.yaml` | 未匹配文件均属顶层 backend/frontend 模块既有前缀范围（CLI 匹配走了子项目 map 的粒度缺口），非索引过期，无需 rebuild；backend entrypoints 的 /api/* routers 清单已含 change 域无需逐端点增行 | skipped |

## 归档核对裁决（三重核对不一致项）

- diff 有而矩阵未列（10）逐项裁决：
  - `backend/openapi.json` — 属 backend 模块生成物（gen:types 数据源随端点刷新），本已在「未匹配文件」节登记，矩阵未单列属粒度选择，补记于此。
  - `.sillyspec/knowledge/decisions/unmapped.md`、`.sillyspec/knowledge/fr/lib-api.md` — 归档 step1 决策蒸馏/FR 索引的 CLI 自动产物，非本变更手写面，不进矩阵。
  - `.claude/skills/sillyspec-explore/SKILL.md`、`.claude/skills/sillyspec-flow/SKILL.md`、`backend/app/modules/change/tests/test_files_refresh_sync.py`、`sillyhub-daemon/tests/sillyspec-sync-change-rpc.test.ts`、`docs/sillyspec/thin-upgrade-stale-stage-window.md`、（另含并行会话工作区改动）— 均为他变更/并行会话（2026-10-13-change-files-refresh-sync 等）产物，不属本变更（verify 对账已剔除并行声明文件）。
- module-impact 列而 diff 无（3）：changelog×2 + _module-map.yaml — 三者均已随 f2d9879bb 提交进主仓历史，工作区 diff 不再含属预期，更新结果表保持 done/skipped 不变。

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
