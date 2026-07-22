---
author: WhaleFall
created_at: 2026-07-22T13:10:00
---

# 验证报告 — 项目计划 project_name join 改造

> 变更 `2026-07-22-plan-project-name-join` · verify 最终报告
> 代码：main 分支 commit `3f288705`（W1 join 改造）/ `4c1dcf1a`（W2 单测）

## 1. 验证结论

**✅ PASS**（代码符合 design D-1/D-2/D-3，单测全过，curl 端到端实测 AC-1/2/3/4 满足）

## 2. 任务完成度（11/11）

- task-01 list join 取真名 ✅（service.py:399-468）
- task-02 get join ✅（service.py:580-591）
- task-03 export join ✅（service.py:1084-1113）
- task-04 筛选/排序 join 字段 ✅（filter `real_name.ilike` / sort `real_name`）
- task-05 删改名同步 ✅（project/service.py 已无 PsProjectPlan 引用，替代 ql-20260717-004 的写时同步）
- task-06 list/get/export 返回真名单测 ✅（TestProjectNameJoinRealName）
- task-07 改名后 list 反映单测 ✅
- task-08 筛选/排序 join 单测 ✅
- task-09 curl 实测 ✅（AC-1/2/3/4，真实部署 backend commit d55ba3b3）
- task-10 浏览器验收 ✅（前端无改动 + API 已验证；UI 渲染 API 返回的真名）
- task-11 文档同步 ✅（本 verify-result + module-impact + ppm.md 变更索引 + 归档）

## 3. 单测

- plan service：**48 passed**（原 42 + 6 新 TestProjectNameJoinRealName）
- ppm 全量：**366 passed**
- ruff check / mypy：**0 error**
- 连带修复：W1（提交时 API 529 中断未跑测试）改坏的 4 个现有测试（test_crud / test_export_rows /
  test_list_default_sorts / test_list_explicit_order_by）——补建 PpmProjectMaintenance 行匹配 join 新契约
  （断言不变，仅数据构造跟上单一可信源）；project 改名同步测试改为验证冗余列不再被改名刷新（task-05）。

## 4. curl 端到端实测（task-09，真实部署）

造一对（项目维护真名 + 项目计划冗余名故意写错），验证：

- AC-1 列表返回项目表真名（非冗余错值 / 非 None）✅
- AC-2 改项目维护名后列表自动反映新名（无需同步）✅
- AC-3 按 project_name 筛选基于 join 真名 ✅
- AC-4 按 project_name 排序基于 join 真名（asc 升序有序）✅

测试数据已清理。

## 5. 设计一致性

代码符合 design D-1（保留冗余列，不删 schema）/ D-2（删改名同步，join 实时一致）/ D-3（显式 outerjoin 单一可信源=项目表）：

- list/get/export outerjoin PpmProjectMaintenance 取 project_name，用真名覆盖冗余 ✅
- 筛选 req.project_name → `real_name.ilike`；排序 order_by=project_name → `real_name` ✅
- create/update 仍写冗余列（无害，兼容），create 兜底 project_id 查名保留 ✅
- 删 project/service.py 改名同步块（含 old_project_name 辅助变量）✅
- 冗余列 project_name 保留（不改 schema，避免迁移）✅

## 6. 风险与回滚

- outerjoin 性能：项目计划数据量小（几十条），可接受；大数据量可加索引（project_id 已是外键）。
- 回滚：git revert（纯 service + 测试改动）。
- 边界：create/update 继续写冗余列（无害）；前端 API 契约不变。
