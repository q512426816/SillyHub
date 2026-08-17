---
plan_level: full
author: qinyi
created_at: 2026-08-17 00:30:00
change: 2026-08-16-change-center-quick-tab
---

# 实现计划（Plan）：变更中心「快速修复」tab

## 来源

brainstorm 四件套 + Design Grill 审查通过（review pass，7 项 minor 已修订）+ 用户亲选决策 D-001~D-008（design.md §4b）。

## 范围（按仓分段）

### main 仓（backend）
- `backend/app/modules/change/quicklog_parser.py`（新增，条目解析器）
- `backend/app/modules/change/quicklog_service.py`（新增，双源合并+enrich+模块推导）
- `backend/app/modules/change/router.py`（修改，GET 列表/详情端点）
- `backend/app/modules/change/tests/test_quicklog_*.py`（新增 3 个测试文件）
- `backend/app/modules/platform_sync/model.py`（修改，quicklog_entries 表）
- `backend/app/modules/platform_sync/router.py` + `service.py`（修改，POST 推送端点）
- `backend/migrations/`（新增 migration）
- `backend/openapi.json`（gen:types 同步）

### main 仓（frontend）
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx`（第三 tab）
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`（反向区块）
- `frontend/src/components/changes/quicklog-table.tsx`（新增）
- `frontend/src/components/changes/quicklog-drawer.tsx`（新增）
- `frontend/src/components/changes/__tests__/quicklog-*.test.tsx`（新增）
- `frontend/src/lib/quicklog.ts`（新增，API client）
- `frontend/src/lib/api-types.ts`（gen:types 生成）

### sillyspec 仓（跨仓，repo: sillyspec）
- `src/quicklog.js`（修改，两触发点 best-effort 推送 + helper）
- `test/quicklog-push-platform.test.mjs`（新增，mock fetch 测试）

## Wave 结构

> 按 depends_on 拓扑分组（同 Wave 可并行，无共享文件冲突；组内串行标注以任务卡 blocks/depends 为准）。

### Wave 1（后端数据层，无依赖）
- [x] task-01: quicklog_entries 表 model + alembic migration
- [x] task-03: change 模块 quicklog_parser.py 条目解析器 + pytest

### Wave 2（后端服务/端点）
- [x] task-02: POST /api/quicklog-entries 推送端点（shpsync_ 鉴权+幂等 upsert）+ pytest
- [x] task-04: quicklog_service.py 双源合并+enrich+模块推导 + pytest

### Wave 3（查询端点 + 跨仓 CLI）
- [x] task-05: change router GET 列表/详情端点 + pytest
- [x] task-06: sillyspec quicklog.js 两触发点 best-effort 推送 + helper + mock fetch 测试（repo: sillyspec，head_commit a815d69 已落 sillyspec 主干）

---
id: task-06
repo: sillyspec
base_commit: 40571ae7c05ef22bb39290de144d627f0a1be071
head_commit: PENDING_EXECUTE
---

### Wave 4（前端类型与 client）
- [x] task-07: gen:types（api-types.ts+openapi.json）+ lib/quicklog.ts API client

### Wave 5（前端 tab 列表）
- [x] task-08: 变更中心第三 tab + quicklog-table.tsx（列/筛选/轮询/空态）+ vitest

### Wave 6（抽屉 + 反向区块）
- [x] task-09: quicklog-drawer.tsx 抽屉详情 + vitest
- [x] task-10: 变更详情页反向「关联的快速任务」区块

### Wave 7（收口）
- [x] task-11: 全量测试回归 + 模块文档变更索引同步

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | quicklog_entries 表 + migration | W1 | P0 | — | FR-03, D-003 | platform_sync/model.py + alembic，UNIQUE(workspace_id, ql_id) |
| task-02 | POST /api/quicklog-entries | W1 | P0 | task-01 | FR-02, FR-03, D-003, D-004 | shpsync_ 鉴权（workspace 由 token 派生）+ 幂等 upsert |
| task-03 | quicklog_parser.py 解析器 | W2 | P0 | — | FR-01, FR-08, D-007 | 宽松规则全套（CRLF/全半角冒号/多状态行取最后/白名单正则） |
| task-04 | quicklog_service.py 合并 | W2 | P0 | task-01, task-03 | FR-04, FR-08, D-005 | PG∪文件合并、ql_id 去重 PG 优先、stale 判定、enrich、模块推导 |
| task-05 | GET 列表/详情端点 | W2 | P0 | task-04 | FR-04, FR-06, FR-07 | 分页/search/status/author/linked_change/include_placeholder |
| task-06 | CLI 推送（sillyspec 仓） | W3 | P0 | task-02 | FR-02, D-003 | quicklog.js 两触发点 + helper + mock fetch 测试 |
| task-07 | gen:types + lib/quicklog.ts | W4 | P0 | task-02, task-05 | FR-04~FR-07 | api-types.ts + openapi.json + API client |
| task-08 | 变更中心第三 tab + table | W5 | P0 | task-07 | FR-05, FR-08 | 列/筛选/轮询/空态/徽标计数 |
| task-09 | quicklog-drawer.tsx | W6 | P0 | task-08 | FR-06 | 四段正文+文件括注+原始 md 切换 |
| task-10 | 变更详情反向区块 | W6 | P1 | task-08 | FR-07 | linked_change 筛选 + 互跳 |
| task-11 | 回归 + 文档同步 | W7 | P0 | task-01~10 | — | 全量测试 + 模块文档变更索引 |

## 关键路径

task-01 → task-02 → task-03 → task-04 → task-05 → task-07 → task-08 → task-09 → task-11（最长路径；task-06 跨仓与 W2/W4 并行，task-10 仅依赖 task-08）

## 全局验收标准

- [ ] 真实 QUICKLOG 样本（本仓 10 文件 ~500 条）解析零异常，状态/负责人/关联/文件括注正确
- [ ] 带 shpsync_ 令牌 POST 后平台列表即时出现该条目（无需等 daemon 同步）；同 ql_id 二次 POST 幂等不重复
- [ ] 快速修复 tab：4 态状态徽标、负责人、影响模块、全文搜索、空壳默认隐藏、进行中 30s 自动刷新
- [ ] 变更详情页可见关联 quick 区块且可互跳
- [ ] backend pytest 新增用例全绿 + 既有测试零回归；frontend vitest + tsc 零错；ruff/mypy 干净
- [ ] 未配置新功能（无 quicklog 目录/旧 CLI 无推送）时行为不变（空列表/仅文件源）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001 | task-08 | 快速修复 tab 为第三 tab |
| D-002 | task-03~05 | 解析器/服务/端点均在 change 模块 |
| D-003 | task-02, task-06 | 双链路并存，PG 优先 |
| D-004 | task-02 | 幂等 upsert，无 base_ts |
| D-005 | task-04 | PG 只存 payload，stale 查询时算 |
| D-006 | task-09 | 抽屉详情，无独立页 |
| D-007 | task-03 | 4 态状态判定 |
| D-008 | — | 不做 CLI↔daemon 联动（Non-Goal） |
