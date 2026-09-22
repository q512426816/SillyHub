# 模块影响分析（Module Impact）— 变更事件通道（watcher 推送消费端点+面板观测区）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend | backend/app/modules/platform_sync/model.py | 数据结构变更（新增 PlatformChangeEventORM 表，零既有表改动） | 是 |
| backend | backend/migrations/versions/20260923040000_add_platform_change_events.py | 数据结构变更（新表迁移，down_revision 接 20260922194500，D-008） | 是 |
| backend | backend/app/modules/platform_sync/schema.py | 接口变更（新增 5 个 ChangeEvent* Pydantic 模型） | 是 |
| backend | backend/app/modules/platform_sync/service.py | 接口变更（append_events/list_events 两新方法，既有方法零改动） | 是 |
| backend | backend/app/modules/platform_sync/router.py | 接口变更（POST/GET /api/changes/{name}/events 两新端点） | 是 |
| backend | backend/app/modules/platform_sync/tests/conftest.py | 新增（建表清单加第四张表） | 否（测试基建） |
| backend | backend/app/modules/platform_sync/tests/test_change_events.py | 新增（15 用例五组） | 否（测试） |
| backend | backend/openapi.json | 接口变更（gen:types 再生成产物：双端点+5 schema） | 否（生成物） |
| frontend | frontend/src/lib/api-types.ts | 接口变更（gen:types 再生成产物：5 个 ChangeEvent* 类型） | 否（生成物） |
| frontend | frontend/src/lib/changes.ts | 接口变更（listChangeEvents 客户端 + 2 类型 re-export） | 是 |
| frontend | frontend/src/components/changes/detail/change-events-card.tsx | 新增（观测事件折叠卡组件） | 是 |
| frontend | frontend/src/components/changes/detail/__tests__/change-events-card.test.tsx | 新增（vitest 5 用例） | 否（测试） |
| frontend | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | 调用关系变更（aside 挂载 ChangeEventsCard，import+JSX 两处） | 是 |

## 未匹配文件

（无——CLI 预填清单经人工归属判定全部划入上表 backend/frontend 模块，backend/** 与 frontend/** 前缀定义见 _module-map.yaml。）


## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

## 更新结果

| 目标 | 状态 | 说明 |
|---|---|---|
| `_module-map.yaml: backend` | done | main_symbols 追加事件双端点行（append_events/list_events + POST/GET /changes/{name}/events，标注 2026-09-23-change-events-channel） |
| `modules/platform_sync.md`（backend 子项目卡） | done | 契约摘要追加「变更事件通道」两条端点条目 + 注意事项补 provisional 红线一条 |
| `_module-map.yaml: frontend` | done | main_symbols 追加 ChangeEventsCard 行（详情页 aside 观测事件折叠卡） |
