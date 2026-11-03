---
author: qinyi
created_at: 2026-11-03 10:49:17
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 在工作区知识页使用搜索的登录用户，要求搜索响应即时且结果语义可感知 |
| 运维/排障者 | 依赖 `index_sync`/`reason`/`state.updated_at` 判断索引新鲜度与健康态 |

## 功能需求

### FR-01: 读路径去嵌入化——同步需求不得阻塞搜索响应
Given 工作区语料指纹与 `knowledge_search_state` 一致（fresh）
When 用户发起搜索
Then 请求路径零嵌入计算（查询向量除外），立即返回存量索引结果，`index_sync="fresh"`。
Given 指纹失配（stale）
When 用户发起搜索
Then 必须调度后台同步任务并立即返回存量行检索结果（`index_sync="scheduled"`），请求路径禁止等待差量/全量嵌入。
Given 无 `state` 行（missing，server_build=True）
When 用户发起搜索
Then 必须调度后台建库并立即返回词面内存降级结果（`index_sync="building"`），请求路径禁止写库。

### FR-02: 后台同步任务生命周期（D-003/D-005）
Given 同一 workspace 已有在途后台同步任务
When 再次搜索且仍失配
Then 禁止重复调度（在途任务唯一）。
Given 后台任务执行失败
When 任务结束
Then 必须从在途注册表移除自身并记结构化日志，禁止自动定时重试；下次搜索须能重新触发。
Given 后台任务完成
When state 行落库
Then `knowledge_search_state.updated_at` 刷新（onupdate），注册表移除任务。

### FR-03: 响应契约与前端提示（D-004）
Given 任意搜索响应
When 前端消费
Then `index_sync` 为可选字段（缺省 None 旧行为不变）；`"scheduled"` 时知识页展示「知识库有新变更，已后台同步，当前为存量索引结果」，`"building"` 时展示「知识索引后台建设中，当前为关键词匹配结果」，fresh/None 不展示提示行。

### FR-04: 禁建库语义回归锁
Given `server_build=False`（KNOWLEDGE_SEARCH_SERVER_BUILD=0）
When 任意搜索（含无索引工作区）
Then 零调度零写库，无索引时词面降级 `reason="index_not_built"`，行为与本变更前逐字一致。

## 非功能需求
- 兼容性：API 仅增可选字段，旧客户端零感知；`knowledge_search_chunks/state` 表 DDL 零变更；单 uvicorn worker 前提沿用（扩容前置条件见 design R-04）。
- 可观测性：后台任务失败必须产出结构化日志事件（`knowledge_search.bg_sync_failed`）；失败即 `state.updated_at` 不动（新鲜度信号不断言丢失）。

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01、FR-02 | A1 路线总纲（含 D-backend-023/024 复潮裁决） |
| D-002@v1 | FR-01（missing 分支） | 无索引首搜后台化 |
| D-003@v1 | FR-02 | 懒触发自愈、失败不重试 |
| D-004@v1 | FR-03 | index_sync 可选字段与前端提示 |
| D-005@v1 | FR-01、FR-02 | 内联调度实现结构与注册表强引用 |

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`）

FR-01: backend/app/modules/knowledge/tests/test_knowledge_search.py「test_search_schedules_background_sync_without_blocking_read_path」
FR-02: backend/app/modules/knowledge/tests/test_knowledge_search.py「test_background_sync_dedupes_and_clears_registry_on_failure」
FR-03: 不适用：前端提示为纯展示文案（视觉/文案不写测试，AGENTS.md 规则 3），验收=typecheck/lint+源码目检；后端字段面由 FR-01/02 用例断言
FR-04: backend/app/modules/knowledge/tests/test_knowledge_search.py「test_server_build_off_schedules_nothing_regression_lock」（由既有 server_build=False 用例组扩展断言零调度）
