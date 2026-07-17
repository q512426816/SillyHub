---
author: WhaleFall
created_at: 2026-07-17T09:15:00
---

# 验证报告 — 计划节点模板模块结构改造

> 变更 `2026-07-16-plan-node-module-restructure` · verify 阶段最终报告
> 代码状态：专用分支 `sillyspec/2026-07-16-plan-node-module-restructure`，4 commit（v1 `d73ddfdf` / v2 `a0a85f37` / v3 `ee0ba1a9` / v4 `050b0500`）

## 1. 验证结论

**✅ PASS**（代码符合 design truth source，测试全过，contract + runtime 证据充分）

⚠️ 附带文档同步风险（不阻断代码验收，建议 archive 前同步，见 §8）。

## 2. 变更风险分级

- **change_risk_profile**: `contract-required`（涉及 API contract / DTO / client：schema / types / page / plan.ts）
- 触发关键词扫描：无 daemon / session / lease / lifecycle / deployment-critical 关键词（非 integration/deployment-critical）
- **门控**：contract-required 需 contract test 证据 → ✅ 满足（router 集成测试 5 例 + curl 端到端）
- **额外 Runtime Evidence**：Docker rebuild 部署 + curl 验证 v1-v4 全部行为（见 §6）

## 3. 探针报告

### 探针 1：未实现标记扫描
变更文件 grep `TODO|FIXME|HACK|XXX|尚未实现` → **无匹配** ✅

### 探针 2：设计关键词覆盖
design 关键词（has_module / module_id / 归属校验 / 明细 / 模块 / antd Form / PpmSubTable editable / Drawer）源码全覆盖 ✅

### 探针 3：验收标准测试覆盖
`backend/app/modules/ppm/plan/tests/` 存在（test_service + test_router 等），task-01~09 对应测试 ✅（93 passed）

### 探针 4：决策追踪覆盖 ⚠️
- decisions.md D-001~D-004 均 v1 accepted，**无 P0/P1 unresolved/blocking**（不 FAIL blocker）
- ⚠️ **stale**：decisions.md 的 D-001/D-002/D-004 normalized_requirement 为 v1，design §11 已演进（D-001→v3 取消不可改、D-002→v2 取消三层、D-004→v2 简化防御校验），decisions.md 未同步 superseded 标注
- requirements.md FR-002（三层结构）被 v2 取消 supersede，未同步
- task 卡片 `decision_ids: [D-001@v1, D-002@v1]` 等 v1 引用 stale

### 探针 5：API Contract Parity
前端 `plan.ts` API 路径全对应后端 `router.py` 端点，**无 ❌ missing backend endpoint** ✅
⚠️ module 端点（`/plan-node-module`、`/plan-node/{id}/modules`）前端 page.tsx v2 不再调用，但 client 函数 + 后端端点保留（milestone-details 共用），unused warning 不阻断

## 4. 设计一致性

代码符合 **design §13（truth source，v2/v3 最新需求）**：
- §5.3 统一二层明细（v2）✅
- §13 has_module 纯记录（v2）+ 编辑可改（v3）✅
- D-001 取消（v3）✅ / D-002 取消三层（v2）✅ / D-003 复用 PpmSubTable ✅ / D-004 简化防御（v2）✅

**代码非 Bug**（符合 design truth source）。文档链 stale 是文档同步遗漏（见 §8）。

## 5. 决策追踪矩阵

| 决策 | FR | task | 代码 evidence | 文档状态 |
|---|---|---|---|---|
| D-001（v1 不可改 → v3 可改） | FR-001 | 01/02/03/08 | schema PlanNodeUpdate+has_module / service 不 pop / 前端 Switch 无 disabled ✅ | ⚠️ decisions D-001@v1 stale |
| D-002（v1 三层 → v2 取消） | FR-002 | 06/07 | page 统一二层明细 ✅ | ⚠️ decisions D-002 + requirements FR-002 stale |
| D-003（复用 PpmSubTable） | — | 07 | DetailsSubTable 用 PpmSubTable editable ✅ | ✅ |
| D-004（v1 强校验 → v2 简化防御） | FR-004 | 03/05 | _validate_detail_module v2 简化（module_id 非 null 跨模板防御）✅ | ⚠️ decisions D-004 stale |

## 6. Runtime Evidence（真实部署验证）

Docker rebuild backend+frontend（commit_sha=`050b050009a0`，全 healthy）+ curl 端到端：
- **v1**：POST 缺 has_module→422 / 带 has_module→True / `details?module_id`→200 / PUT has_module 保持
- **v2**：has_module=true + module_id=null → **201**（v2 放行，v1 是 400）
- **v3**：PUT has_module false→true → **200 + has_module=True**（v3 可改生效）
- **v4**：乱序建 no=3,1,2 → list `order_by=no&order=asc` → **[1,2,3] 正序**
- **migration PG 真实执行**：`alembic_version=20260716_pn_has_module`，has_module/module_id 列 + `ix_ppm_plan_node_detail_module` 索引落地

## 7. 测试结果

- backend：ruff check All passed / mypy no issues / pytest plan **93 passed**（3 warnings 既有 `HTTP_422_UNPROCESSABLE_ENTITY` DeprecationWarning，非本次）
- frontend：tsc --noEmit 过 / vitest **931 passed**（零回归）
- test_strategy=module（仅测 plan 变更模块）

## 8. ⚠️ 文档同步风险（建议 archive 前处理）

verify 阶段禁止改文档（只读），以下 stale 需 archive 前同步：

1. **decisions.md**：D-001/D-002/D-004 的 normalized_requirement 是 v1，应更新为 v2/v3（或加 superseded 标注 + 新版本条目）
2. **requirements.md**：FR-002（三层结构）被 v2 取消，应标注 superseded 或调整为「has_module 仅记录」
3. **plan.md**：9 个 task checkbox 未勾（execute 用 review.json 替代），应勾选 `[x]`
4. **tasks/task-*.md**：`decision_ids [D-xxx@v1]` 应更新为当前版本
5. tasks.md 已有 v2/v3 章节（✅），但 v1 task 描述（task-07 三层 / task-08 ModuleFormDrawer）未标注 superseded

**这些不影响代码正确性**（代码符合 design §13），但文档内部一致性需在 archive 前修复。

## 9. 浏览器验收点（CLI 无法代劳）

- `/ppm/plan-nodes` 列表按编号正序（v4）
- 新建/编辑模板「是否有模块」开关可切换并保存（v3 可改）
- 展开任意模板只显示「模板明细」一个子表（v2 统一二层，无模块子表/三层）
- 明细行内编辑 + 保存
- milestone-details 页模块 CRUD 不回归
