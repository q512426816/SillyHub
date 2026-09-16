---
author: qinyi
created_at: '2026-09-16 07:55:00'
plan_level: full
---

# 计划（Plan）— 2026-09-16-platform-progress-ingest-persist

## 背景与目标

修复 sillyspec 进度同步平台侧滞后：progress POST 接受后 `changes` 表行 `current_stage`/`status` 权威落库（P1），documents 推送时 title 按最深阶段文档重派生（P2a），parser 不再为缺席 MASTER.md 发占位行（P3）。详见 design.md 三 Phase 与 decisions.md D-001~D-004@v1。

## 任务总表与覆盖矩阵

| task | 目标文件 | 覆盖 design 清单项 |
|---|---|---|
| task-01 | NEW:backend/app/modules/change/title_norm.py | title_norm.py |
| task-02 | backend/app/modules/platform_sync/service.py（P1 段） | service.py P1 |
| task-03 | backend/app/modules/platform_sync/service.py（P2a 段） | service.py P2a |
| task-04 | backend/app/modules/change/parser.py（_extract_title） | parser.py 归一化 |
| task-05 | backend/app/modules/change/parser.py（MASTER 行） | parser.py P3 |
| task-06 | NEW:backend/app/modules/platform_sync/tests/test_stage_status_ingest.py | P1 测试 |
| task-07 | NEW:backend/app/modules/change/tests/test_title_normalization.py | P2a/P3 测试 |
| task-08 | backend/app/modules/platform_sync/tests/test_router.py（:831 断言随 FR-01 更新） | 连带测试债 |

design 文件变更清单 6 文件全部覆盖（含连带 test_router.py）（service.py=02+03、parser.py=04+05、title_norm=01、两新测试=06/07）；test_router.py 为审查发现的连带测试（见下）。

## 任务依赖图

```
task-01 (title_norm helper)
  ├──→ task-03 (upsert_documents title 重派生)
  └──→ task-04 (parser _extract_title 接归一化)
task-02 (P1 ingest 落库，独立)
task-05 (P3 MASTER 占位行，独立)
task-06 (P1 测试) ←─ task-02
task-07 (P2a/P3 测试) ←─ task-01/03/04/05
task-08 (连带断言更新+回归) ←─ 全部
```

## Wave 1 — 基础设施与独立修复（可并行）

- task-01
- task-02
- task-05

## Wave 2 — 接线与集成

- task-03
- task-04

## Wave 3 — 新增测试

- task-06
- task-07

## Wave 4 — 连带断言更新与全量回归

- task-08

## 关键技术要点

1. **task-02 插入点**：`upsert_progress` 分支 1（service.py:277-290）与分支 3（:303-312）的 `_ensure_change_row(...)` 之后、`_sync_change_owner(...)` 之前各插一次 stage/status 落库调用（签名与映射表见 design.md「接口定义」）；冲突/拒收分支零改动。
2. **task-03 防复活守卫**：documents 通道建占位行前过 `_change_key_deleted`（GAP-1/R-06），命中则跳过；INSERT 撞唯一约束走 `_ensure_change_row` 的 IntegrityError 静默范式。
3. **task-01 模板清单校准**：以本仓实际文档 H1 校准；**不得收录裸英文 `Proposal` 等英文标题**（parser 既有测试 fixture 用英文 H1，收录会连坐断言）。
4. **task-05**：parser 标准文档循环对 MASTER 缺席直接 continue（不发 exists=False 行），其余文档行为不变。
5. **task-08 连带断言**：test_router.py:831 `assert row.status == "draft"`（载荷 status='active'）随 FR-01 变更为映射后值——这是行为变更的预期体现，不是测试腐化。

## 验收（对照 requirements.md）

- FR-01~06 逐条由 task-06/task-07 测试覆盖；task-08 跑 platform_sync + change 两模块相关测试 + ruff check + mypy app。
- 生产验证（部署后）：ehs-back 工作区变更行 current_stage 更新（execute 后人工步骤，不阻塞本变更收口）。

## 风险与回退

- R-01~R-06 见 design.md 风险登记；回退 = revert 单提交（无迁移）。
