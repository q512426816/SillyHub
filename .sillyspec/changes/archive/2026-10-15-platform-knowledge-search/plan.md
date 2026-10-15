---
plan_level: full
execution_mode: main  # 单会话直写（任务全链顺序依赖、无真并行簇；R7/R8 对撞实证直写优于派发税）
---

# 实现计划（Plan）— 2026-10-15-platform-knowledge-search

## Wave 1（无依赖）
- task-01

## Wave 2（依赖 Wave 1）
- task-02

## Wave 3（依赖 Wave 2；task-03 与 task-04 文件正交，可并行——但单会话直写按序执行）
- task-03
- task-04

## Wave 4（依赖 Wave 2 的 schema 定稿；收口）
- task-05

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端检索服务 search.py（语料扫描+三档切块+kind 派生+懒索引+词面/向量融合+snippet）+ 纯函数单测 | W1 | P0 | — | FR-01, FR-02, FR-06 / D-002@v1, D-003@v1, D-004@v1, D-007@v1 | 语料 = spec_root/{knowledge,docs}/**/*.md 排 INDEX.md；切块 1500/1000/150；融合 0.6/0.4 + 保底 0.9；独立索引 + 全语料指纹 |
| task-02 | 端点 POST /knowledge/search + schema + 端点测试 | W2 | P0 | task-01 | FR-01, FR-03, FR-04 / D-001@v1, D-005@v1 | 声明序在通配路由前；KNOWLEDGE_READ 门控；docs 结果按 SCAN_DOCS_READ 过滤（3×limit 候选）；run_in_threadpool |
| task-03 | 前端知识库页搜索 UI（lib + 页 + 测试） | W3 | P0 | task-02 | FR-02, FR-03, FR-05 / D-006@v1 | 搜索框 debounce 300ms + 结果列表替换树 + 双落点跳转 + 降级提示条 + 同 key 重选边界 |
| task-04 | scan-docs 页 ?path= 深链（页 + 测试） | W3 | P0 | — | FR-05 / D-006@v1 | useSearchParams + requestDoc 链路 + 命中后置位消费 + 查无静默 |
| task-05 | gen:types 双端 + 收口验证 | W4 | P0 | task-02 | （规则 21 双端义务） | pnpm gen:types + pnpm -C sillyhub-daemon gen:types；提交 openapi.json + 两端 api-types.ts；相关测试全绿；实测回填 R-01/R-03 |

## 关键路径
task-01 → task-02 → task-03 → task-05（前端 UI 依赖端点契约；收口依赖 schema 定稿）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）
- **端点声明序**：`POST /workspaces/{workspace_id}/knowledge/search` 注册在 `GET /knowledge/{filename:path}`（backend/app/modules/knowledge/router.py:454）之前。
- **embedder 单一源**：一律 `get_embedder(settings.knowledge_embedding_model)`（backend/app/modules/knowledge/vector_search.py:137-154）；不得传其他模型名（单例单槽位互顶）。
- **索引独立性**：新索引与 vector_search.py 的 `_indexes` 完全独立；构建顺序 = 先算指纹 → 持锁构建（single-flight）→ 构建后复算指纹，变化即重建。
- **权限判定入口**：docs 过滤 = `has_permission(session, user=user, permission=Permission.SCAN_DOCS_READ, workspace_id=workspace_id)`（backend/app/modules/auth/rbac.py:109-149）；禁止读 `user.permissions` 快照。
- **docs 过滤顺序**：先取 3×limit 候选再过滤截断（不是 403）。
- **前端跳转**：knowledge 结果经 `router.push('?file=<去 knowledge/ 前缀相对路径>&anchor=<anchor>')` URL 深链；URL 与目标已等值时直调 `selectEntry`；docs 结果 `router.push('/workspaces/{id}/scan-docs?path=...')`。
- **语料边界**：knowledge/ + docs/ 全域（排 INDEX.md），不含 changes/（D-002@v1，MUST NOT 越界）。
- **规则 21 双端义务**：后端 schema 改动 → `pnpm gen:types`（frontend）+ `pnpm -C sillyhub-daemon gen:types` 同一变更内跑并提交 openapi.json + 两端 api-types.ts。
- **规则 0**：禁跑全量测试，只跑修改相关的测试（backend knowledge 模块 + 前端两页测试）。
- **规则 13**：兼容 Windows/Linux/macOS（路径统一 POSIX 形态）。
- **规则 12**：UI 与文档中文；**D-009/D-010 防复潮**：不改 CLI 端点（vector_router.py/vector_search.py 对外契约零改动）、不建 DB 表/不引入同步链路。

## 全局验收标准
1. 后端：`uv run pytest app/modules/knowledge/tests -q` 全绿（含新 search 单测 + 端点测试）；`uv run ruff check .` + `uv run mypy app` 通过。
2. 前端：知识库页与 scan-docs 页测试全绿（含搜索交互/跳转/降级/深链场景）；`pnpm lint` + typecheck 通过。
3. gen:types 双端产物与 backend/openapi.json 同步（零漂移；ci-fast-gate 漂移闸门可过）。
4. 行为兼容（brownfield）：知识库页未使用搜索时仍是文件树视图零副作用；scan-docs 无 `?path=` 时行为不变；CLI 端点与既有知识库接口零改动（回归测试不红）。
5. 实测回填：首查索引构建耗时（R-01）与融合排序抽验（R-03）结论写回 design.md 风险登记或 verify-result。

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02 | 端点存在且 CLI 端点零改动（回归） |
| D-002@v1 | task-01 | 扫描面断言（knowledge/ + docs/，无 changes/） |
| D-003@v1 | task-01 | 切块单测（三档 + 阈值 1500/1000/150） |
| D-004@v1 | task-01, task-02, task-03 | 融合单测 + 降级端点测试 + 前端降级提示测试 |
| D-005@v1 | task-02 | 权限过滤端点测试（403/404/无 docs 项） |
| D-006@v1 | task-03, task-04 | 前端跳转/深链测试 |
| D-007@v1 | task-01 | 指纹失效单测（增改后重建） |
| D-008@v1 | task-01~05 | 方案 A 总纲（本计划即其编排） |
| D-009@v1 | task-02（反证） | CLI 端点回归不红（vector 测试全绿） |
| D-010@v1 | task-01（反证） | 无 DB/迁移文件（文件清单核验） |
