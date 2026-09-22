# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| sillyhub-daemon | sillyhub-daemon/src/sillyspec-manager.ts | 接口变更（conflictSnapshot/runResolve 尾参）+ 逻辑变更（workspace_root_unknown 两态） | 否（156 用例锚定） |
| sillyhub-daemon | sillyhub-daemon/src/daemon.ts | 逻辑变更（透传接线）+ 逻辑变更（防投毒提前 return） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/*.test.ts ×5 | 测试（新增断言+修存量债） | 否 |
| daemon | backend/app/modules/daemon/sillyspec_compare.py | 接口变更（RPC params+方法公开）+ 配置变更（文案分叉表） | 否（72 用例锚定） |
| daemon | backend/app/modules/daemon/ws_hub.py | 接口变更（payload 三键） | 否 |
| daemon | backend/app/modules/daemon/router/machines.py | 接口变更（请求体必填）+ 逻辑变更（成员校验） | 否 |
| daemon | backend/app/modules/daemon/tests/*.py ×2 | 测试（新增断言） | 否 |
| frontend | frontend/src/components/changes/conflict-compare-modal.tsx | 调用关系变更（body 下传） | 否 |
| frontend | frontend/src/lib/api-types.ts + backend/openapi.json | 数据结构变更（gen:types 产物） | 否 |

## 未匹配文件

无（14 个文件均已归入上方矩阵——首版 CLI 前缀匹配未命中的 sillyhub-daemon src/tests 与 backend daemon 模块文件，语义归位）。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 无需增改——未匹配为 CLI 前缀匹配粒度问题（文件实际均在已注册模块路径下），非模块索引过期 | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
