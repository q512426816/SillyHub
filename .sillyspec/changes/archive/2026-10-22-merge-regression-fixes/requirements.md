---
author: flow-machine-draft
created_at: 2026-10-22T08:42:05.081Z
---
# 需求规格（Requirements）— 2026-10-22-merge-regression-fixes

## 功能需求

### FR-01: app/modules/daemon/grants/tests/ 62 passed 零 errors（原 48 passed + 14 errors）

- grants 测试的 selected-metadata 必须覆盖所选表的完整 FK 闭包（含 users.default_agent_profile_id → agent_profiles → workspaces/llm_providers/tool_policies），禁止在 fixture setup 抛 NoReferencedTableError。

#### 场景：主路径

Given grants 目录测试 / When 隔离或全量运行 / Then 62 用例全绿且零 errors（fixture 建表成功）。

### FR-02: test_init_claim_tokens.py 两降级用例在任意渲染流下稳定通过（13 passed），全量套件复跑零 failed 零 errors

- 降级警告断言必须对 stdout 与 stderr 双流合并判定（断言事件名与原因枚举在场），禁止依赖单一渲染流。

#### 场景：主路径

Given structlog 渲染流随全局配置时机在 out/err 间变化 / When 跑两降级用例 / Then 断言两流合并后稳定通过；全量复跑零 failed 零 errors。

### FR-03: 仅测试面改动（conftest + 断言载体），零生产源码变更，无需重新部署

- 本变更必须只改测试夹具与断言载体，禁止改动生产源码（app/modules 下非 tests 文件）。

#### 场景：主路径

Given diff 面 = grants conftest + lease 测试文件 / When 逐 hunk 核对 / Then 无生产文件变更。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/daemon/grants/tests/「隔离复跑 62 passed（含 test_model/test_migration 14 个原 error 用例）」
FR-02: backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py「TestInitClaimDefensiveDegrade::test_no_token_issued_when_actor_user_id_missing」
FR-02: backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py「TestInitClaimDefensiveDegrade::test_no_token_issued_when_workspace_id_missing」
FR-03: 不适用：纯 diff 面核对类约束（无独立可执行测试；由收口评审对 change.patch 逐 hunk 核验）
