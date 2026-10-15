# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| app-workspace-pages | `frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx` | 逻辑变更（搜索 UI：搜索框/结果列表替换树/深链跳转/降级条） | 否 |
| app-workspace-pages | `frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx` | 逻辑变更（?path= 深链选中 + 消费标记） | 否 |
| app-workspace-pages | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | 逻辑变更（测试扩展 +7 例） | 否 |
| app-workspace-pages | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx` | 逻辑变更（测试扩展 +4 例） | 否 |
| backend | `backend/app/modules/knowledge/search.py` | 新增（检索服务：语料扫描/三档切块/懒索引/词面向量融合/snippet） | 否 |
| backend | `backend/app/modules/knowledge/tests/test_knowledge_search.py` | 新增（纯函数单测 25 例） | 否 |
| backend | `backend/app/modules/knowledge/schema.py` | 接口变更（新增 KnowledgeSearchIn/KnowledgeSearchResultItem/KnowledgeSearchOut 三 DTO） | 否 |
| backend | `backend/app/modules/knowledge/router.py` | 接口变更（新增 POST /knowledge/search，声明序在 {filename:path} 通配路由前） | 否 |
| backend | `backend/app/modules/knowledge/tests/test_router.py` | 逻辑变更（测试扩展 +8 例） | 否 |
| backend | `backend/openapi.json` | 接口变更（gen:types 重 dump，纯新增：545 paths / 754 schemas） | 否 |
| lib-api | `frontend/src/lib/api-types.ts` | 接口变更（生成物再生成，纯新增三 schema + /knowledge/search 路径面） | 否 |
| lib-knowledge | `frontend/src/lib/knowledge.ts` | 接口变更（新增 searchKnowledge 函数与类型别名）+ 逻辑变更 | 否 |
| sillyhub-daemon | `sillyhub-daemon/src/api-types.ts` | 接口变更（生成物再生成，纯新增；daemon 运行时零改动） | 否 |

## 未匹配文件

无（全部变更文件已归属到模块）。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/app-workspace-pages.md` | 更新模块卡契约摘要（KnowledgePage 知识搜索 + ScanDocsPage ?path= 深链）+ app-workspace-pages.changelog.md 追加变更条目 | done |
| `modules/backend.md` | 更新模块卡契约摘要（平台知识搜索 bullet）+ backend.changelog.md 追加变更条目 | done |
| `modules/lib-api.md` | 更新模块卡（生成物再生成，api-types 纯新增）+ lib-api.changelog.md 追加变更条目 | done |
| `modules/lib-knowledge.md` | 更新模块卡契约摘要（searchKnowledge 函数行/类型别名）+ lib-knowledge.changelog.md 追加变更条目 | done |
| `modules/sillyhub-daemon.md` | 更新模块卡（生成物再生成，daemon 运行时零改动）+ sillyhub-daemon.changelog.md 追加变更条目 | done |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

## 归档终审裁决（2026-10-15）

- 「diff 有而 module-impact 未列（36）」复核结论：机械误报——36 项中除 .sillyspec 产物（指引明示不参与核对）外，其余代码/生成物文件（backend/openapi.json、knowledge 页与两份测试、scan-docs 页与测试、前端/daemon api-types.ts 等）**均已列入上方矩阵**；未匹配原因 = 矩阵路径含 `[id]` 括号段，git diff 输出对含特殊字符路径加引号，CLI 前缀匹配未剥引号。以 `git diff --cached --stat HEAD` 实测：13 个代码/生成物文件与矩阵 1:1 对应，无遗漏、无越界。
- 「module-impact 列而 diff 无（6）」：5 个模块卡与 _module-map.yaml 均为 .sillyspec/docs/ 下的模块文档同步产物（文档面，不参与代码 diff 核对，与「.sillyspec 产物不参与核对」同口径）。
- 「cannot_verify 草稿 5」（execute task review 自动草稿兜底，Task Review 通道已退役、main 直写无逐任务派发）：其兑现证据 = verify 阶段全链——verify-result.md（后端 199 / 前端 46 全绿、independent 验收审查 11/11 pass、探针 7 验收×测试矩阵全 covered）+ 主仓复验（apply 后 knowledge 199 / 前端 46 再跑全绿）。非静默放行。
