# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| lib-api | `frontend/src/lib/api-types.ts` | <!--TODO--> | <!--TODO--> |
| lib-knowledge | `frontend/src/lib/knowledge.ts` | <!--TODO--> | <!--TODO--> |
| lib-react-query | `frontend/src/lib/query-keys.ts` | <!--TODO--> | <!--TODO--> |
| runtime-handler | `sillyhub-daemon/src/runtime-handler.ts` | <!--TODO--> | <!--TODO--> |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `backend/app/modules/knowledge/graph.py` <!--TODO: 归属判定-->
- `backend/app/modules/knowledge/router.py` <!--TODO: 归属判定-->
- `backend/app/modules/knowledge/schema.py` <!--TODO: 归属判定-->
- `backend/app/modules/knowledge/tests/test_graph.py` <!--TODO: 归属判定-->
- `sillyhub-daemon/tests/knowledge-governance-handler.test.ts` <!--TODO: 归属判定-->
- `backend/openapi.json` <!--TODO: 归属判定-->
- `frontend/src/components/knowledge/graph-canvas.tsx` <!--TODO: 归属判定-->
- `frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/knowledge/__tests__` <!--TODO: 归属判定-->

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/lib-api.md` | 追加 2026-10-09 增量段（dump 端点生成物） | done |
| `modules/lib-knowledge.md` | 追加 2026-10-09 增量段（dump 函数+类型+消费方） | done |
| `modules/lib-react-query.md` | 追加 2026-10-09 增量段（dump key+失效入口） | done |
| `modules/runtime-handler.md` | skipped：无独立文档卡（map notes 直挂）；dump 白名单行为由 knowledge-governance-handler.test.ts 钉死，daemon.md 增量段注记接线 | done |
| `_module-map.yaml` | skipped：未匹配文件均落既有模块粒度（六卡已增量），索引无需增改 | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
