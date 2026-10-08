# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| components-shared | `frontend/src/components/workspace-tabs.tsx` | 调用关系变更（TABS 加项） | no |
| daemon | `sillyhub-daemon/src/daemon.ts` | 接口变更（新 RPC 注册） | no |
| lib-api | `frontend/src/lib/api-types.ts` | 数据结构变更（生成物） | no |
| lib-knowledge | `frontend/src/lib/knowledge.ts` | 新增（图函数+类型） | no |
| lib-react-query | `frontend/src/lib/query-keys.ts` | 新增（三 key 工厂） | no |
| runtime-handler | `sillyhub-daemon/src/runtime-handler.ts` | 接口变更（graph 方法） | no |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `backend/app/modules/knowledge/graph.py` → backend 子项目 knowledge 模块（backend/modules/knowledge.md 已增量）
- `backend/app/modules/knowledge/schema.py` → 同上（knowledge 模块）
- `backend/app/modules/knowledge/router.py` → 同上（knowledge 模块）
- `backend/app/modules/knowledge/tests/test_graph.py` → 同上（knowledge 模块）
- `sillyhub-daemon/tests/knowledge-governance-handler.test.ts` → sillyhub-daemon knowledge 治理测试面（runtime-handler 无独立卡，行为由本测试钉死）
- `frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx` → frontend app-pages 模块（知识域新子路由页）
- `frontend/src/components/knowledge/graph-canvas.tsx` → frontend lib-knowledge/components 知识域（消费面注记已入 lib-knowledge.md 增量段）
- `frontend/src/components/knowledge/__tests__/graph-canvas.test.ts` → 同上
- `frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx` → 同上
- `frontend/src/components/knowledge/ops-dashboard.tsx` → frontend 知识域组件（图维度卡增量已入 lib-knowledge.md 注记）
- `frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx` → 同上
- `backend/openapi.json` → lib-api 生成物（增量已入 frontend/modules/lib-api.md）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/components-shared.md` | 追加 2026-10-08 增量段（TABS 页签+权限复用） | done |
| `modules/daemon.md` | 追加 2026-10-08 增量段（knowledge.graph 注册+root 双收） | done |
| `modules/lib-api.md` | 追加 2026-10-08 增量段（gen:types 生成物规模） | done |
| `modules/lib-knowledge.md` | 追加 2026-10-08 增量段（三函数+类型导出+消费方） | done |
| `modules/lib-react-query.md` | 追加 2026-10-08 增量段（三 key 工厂+组失效） | done |
| `modules/runtime-handler.md` | skipped：该模块无独立文档卡（sillyhub-daemon map 中 runtime-handler 条目 notes 直挂）；graph 方法行为由 knowledge-governance-handler.test.ts 11 用例钉死，daemon.md 增量段已注记转发关系 | done |
| `_module-map.yaml` | skipped：12 个"未匹配文件"实为子项目 map 粒度覆盖（backend/app/modules/knowledge/** 归 backend knowledge 卡、前端新页面/组件归 frontend 各卡——均已更新增量段）；模块索引无需增改，graph.py 等落既有模块 paths 内 | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

## 归档三重核对裁决（CLI 报告 2 类不一致）

1. **diff 有而 module-impact 矩阵未列（8 项）**：均已在「未匹配文件」节逐项判定归属（上节）——子项目 map 粒度覆盖（backend knowledge / frontend 知识域 / lib-api 生成物），矩阵不重复列行。
2. **module-impact 列而 diff 无（7 项=模块卡与 map 文档）**：模块卡（modules/*.md）在**主仓** .sillyspec/docs 下更新（verify 阶段文档同步义务落主仓），不在 worktree 代码 diff 面——口径差异非缺失，主仓在场可验。
