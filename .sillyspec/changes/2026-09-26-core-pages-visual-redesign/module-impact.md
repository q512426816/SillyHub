# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `frontend/src/styles/themes.ts` <!--TODO: 归属判定-->
- `frontend/src/components/primer/index.ts` <!--TODO: 归属判定-->
- `frontend/src/components/primer/state-label.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/primer/counter.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/primer/underline-nav.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/primer/issue-row.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/primer/timeline.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/primer/meta-panel.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/primer/page-head.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/primer/stat-grid.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/primer/empty-state.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/primer/state-icon.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/primer/primer.test.tsx` <!--TODO: 归属判定-->
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx` <!--TODO: 归属判定-->
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/changes/detail/change-stage-header.tsx` <!--TODO: 归属判定-->
- `frontend/src/app/(dashboard)/workspaces/page.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/workspace-card.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/workspace-drag-grid.tsx` <!--TODO: 归属判定-->
- `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/sessions/sessions-portal.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/sessions/session-list-panel.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/daemon/session-panel/session-panel-page.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/top-bar.tsx` <!--TODO: 归属判定-->

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 全部变更文件均落在 frontend 模块既有 paths 前缀（frontend/**）内，primer/ 为组件子目录无需新模块——索引无需增改 | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
