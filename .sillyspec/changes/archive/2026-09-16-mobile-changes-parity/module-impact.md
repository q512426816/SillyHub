# 模块影响分析（骨架由 `sillyspec module-impact --change <变更名>` 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

按 design.md 文件变更清单（本变更尚未动源码，矩阵为计划态；execute 后以 git diff 为准复核）：

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| frontend | frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx | 逻辑变更（仅加 export 关键字，三个格式化 helper 供移动卡片复用） | 否 |
| frontend | frontend/src/components/mobile/mobile-change-card.tsx | 逻辑变更（新增活动徽标/元信息行/用量行渲染分支） | 否 |
| frontend | frontend/src/app/m/workspaces/[id]/changes/page.tsx | 逻辑变更（重新扫描/排序 state/URL 参数/quicklog 筛选） | 否 |
| frontend | frontend/src/components/mobile/mobile-change-detail.tsx | 逻辑变更（三卡挂载 + StageStepper 可点联动） | 否 |
| frontend | frontend/src/app/m/workspaces/[id]/changes/[cid]/page.tsx | 逻辑变更（⋯ 菜单删除入口 + mutation） | 否 |
| frontend | frontend/src/components/mobile/mobile-change-card.test.tsx | 逻辑变更（测试补齐） | 否 |
| frontend | frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx | 逻辑变更（测试补齐） | 否 |
| frontend | frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx | 逻辑变更（测试补齐） | 否 |

无接口/数据结构/配置变更（无后端、无 schema、无 api-types 再生成）。

## 未匹配文件

以下文件为**其它并行会话的工作区残留**（本变更未触碰；CLI 已自动排除其中 2 个已声明归属的文件）——不属于本变更影响面，不做归属判定：

- `frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx`（并行会话残留，非本变更）
- `frontend/src/components/daemon/__tests__/session-usage-panel-mount.test.tsx`（并行会话残留，非本变更）
- `frontend/src/lib/__tests__/daemon-session.test.ts`（并行会话残留，非本变更）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 无需 rebuild（未匹配文件均为并行会话残留，本变更文件全部命中 frontend 模块 paths） | done |
| `.sillyspec/docs/multi-agent-platform/modules/frontend.md` | 变更归档时按 sillyspec-archive 流程同步（移动端变更中心功能清单更新） | pending（archive 时处理） |
