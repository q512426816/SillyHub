---
plan_level: full
execution_mode: main  # 任务链式依赖无真并行簇；单会话直写（R7/R8 对撞实证先例）
---

# 实现计划（Plan）— 2026-10-15-knowledge-search-pgvector

## Wave 1（无依赖）
- task-01

## Wave 2（依赖 Wave 1）
- task-02

## Wave 3（依赖 Wave 2；task-03 与 task-04 文件正交）
- task-03
- task-04

## Wave 4（收口）
- task-05

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 数据层：依赖+两 ORM+迁移 | W1 | P0 | — | FR-01 / D-002@v1, D-008@v1 | pgvector>=0.3 + with_variant 双方言 + CREATE EXTENSION 守卫 |
| task-02 | 检索层改造（async 编排） | W2 | P0 | task-01 | FR-01~03 / D-003@v1, D-004@v1, D-006@v1, D-007@v1, D-011@v1, D-005@v2 | 懒同步差量 + 双路分叉 + 降级链 + 指纹归一化 + asyncio.Lock |
| task-03 | 路由协作（await 化） | W3 | P0 | task-02 | FR-04 / D-005@v2 | 端点直 await；run_in_threadpool 退役；测试适配 |
| task-04 | 部署：镜像 + 升级说明 | W3 | P0 | task-01 | FR-05 / D-008@v1 | compose ×2 换 pgvector/pgvector:pg16 + 迁移 fail-closed 核验 |
| task-05 | 回归收口 + 实测回填 | W4 | P0 | task-02, task-03 | FR-02, FR-04 | 199+46 回归 + 零 diff 核验 + 模块卡 + 重启耗时实测 |

## 关键路径
task-01 → task-02 → task-03 → task-05

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）
- **执行模型（D-005@v2/Grill X2 定案）**：search_sync 为 async 协程——DB await 在调用方事件循环原生执行（共享全局 async 工厂，池与 loop 同源）；CPU/IO（embed/scan/fingerprint）经 `asyncio.to_thread` 卸载；端点直接 await；**禁止任何跨事件循环会话使用**。
- **同步锁**：进程内 `asyncio.Lock`（键=workspace_key——async 协程跨 await 持有安全）；DB 侧 uq + ON CONFLICT（PG）/INSERT OR REPLACE（SQLite）幂等兜底。
- **指纹归一化**：fp_now 比较前 `list(map(list, fp))` 归一（JSON 库值天然 list）；否则快路径恒失效。
- **契约冻结**：端点签名/响应模型/api-types/前端零改动；openapi.json 零 diff；CLI 向量端点（vector_search.py/vector_router.py）零改动。
- **迁移 fail-closed**：PG 方言 extension 不可用即 raise（文案含「换 pgvector/pgvector:pg16 镜像」）；非 PG 方言直接 return（pg_trgm 先例）；downgrade 删两表不卸扩展。
- **降级链**：DB 异常 → 词面内存直查（scan_corpus + _word_score）+ reason 记降级；搜索永不 5xx。
- **规则 0**：只跑相关测试（knowledge 模块 + 前端两页回归）；**规则 12**：注释中文；**规则 13**：三平台兼容。
- **禁止**：新运行时依赖仅 pgvector 一个；不加后台任务/daemon 改动/main.py lifespan（D-010/D-012 落选）。

## 全局验收标准
1. 后端：`uv run pytest app/modules/knowledge/tests -q` 全绿（新增 DB 面用例 + 既有 199 回归）；`ruff check/format` + `mypy app` 通过。
2. 前端回归：知识库/scan-docs 两页 46 例全绿（零源码改动下的纯回归）。
3. `git diff backend/openapi.json frontend/src/lib/api-types.ts sillyhub-daemon/src/api-types.ts` 零输出（契约冻结物证）。
4. 行为兼容：未部署迁移的库上（表不存在）搜索仍可用（降级链生效不 5xx）。
5. 实测回填：重启后首查耗时（目标秒级）+ 差量同步只重嵌变更文件（embed_calls 计数）结论写入 verify/风险面。

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02 | 两表 + 重启零重建实测 |
| D-002@v1 | task-01 | with_variant 双方言建表单测 |
| D-003@v1 | task-02 | 差量四态单测 |
| D-004@v1 | task-02 | 两方言一致形态单测 |
| D-005@v2 | task-02, task-03 | async 签名 + 端点 await + 契约零 diff |
| D-006@v1 | task-02 | ILIKE 候选用例 |
| D-007@v1 | task-02 | model_version 重算计数 |
| D-008@v1 | task-01, task-04 | 迁移 fail-closed + 镜像清单 |
| D-009/D-010@v1 | 反证 | 无文件缓存/无预热代码 |
| D-011@v1 | task-02 | 内联懒同步（无后台任务） |
| D-012/D-013@v1 | 反证 | 无常驻协程/双通道 |
