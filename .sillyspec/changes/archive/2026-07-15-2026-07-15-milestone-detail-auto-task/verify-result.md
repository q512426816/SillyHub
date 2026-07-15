---
author: WhaleFall
created_at: 2026-07-15T21:55:30
---

# 验证报告 — 里程碑明细提交自动创建任务计划

## 结论
**PASS WITH NOTES**

核心联动功能（明细 done → 自动建任务 + 导入多责任人拆分 + 超管删除任务）全部实现、全部测试通过、真实 pg 冒烟通过。3 点 NOTES 为 design 后的 quick 增强、既有债务修正、push 待网络，均不影响功能正确性。

## 任务完成度
| 任务 | 状态 | 证据 |
|---|---|---|
| task-01 联动 helper 方法集（6 个） | ✅ | service.py:1256-1391 |
| task-02 create_detail 重构 + done 触发 | ✅ | service.py:388-400 |
| task-03 _transition(DONE) 接入 | ✅ | service.py:607-609 |
| task-04 import_commit 批量建任务 | ✅ | service.py:1068-1074 |
| task-05 update 同步 + delete 解关联 | ✅ | service.py:402-420 |
| task-06 change_process 任务迁移 | ✅ | service.py:698 |
| task-07 联动单测 | ✅ | test_detail_task_link.py 10 用例（FR-01~07） |
| task-08 前端 toast | ✅ | milestone-details/page.tsx 2 处 |
| task-09 实测部署 | ✅ | Docker healthy + 真实 pg 冒烟 |
| ql-014 导入多责任人拆分 | ✅ | _to_preview_rows + test_router 测试 |
| ql-015 超管删除任务 | ✅ | task-plans/page.tsx canDelete |

plan.md task-01~09 全勾选；tasks.md ql-014 勾选。9 个 task review.json verdict=pass。

## 设计一致性
与 design.md 一致：6 helper / 5 触发点 / 字段映射 / 强一致（helper 调用均在统一 commit 前）/ 生命周期契约表 / 非目标（不改状态机、不改表结构、不补历史）全部实现。

3 处合理偏差（已记录）：
1. `_sync_task_fields` 执行人空保护（审查追加健壮性，避免违反 `PlanTask.user_id` 非空约束）
2. 导入多责任人拆分（ql-014，design 后扩展，独立 quick 验收）
3. 超管删除任务（ql-015，design 后扩展，独立 quick 验收）

`_lookup_user_name` 口径 `PpmProjectMember.user_name`（Design Grill 已修正 design）。

## 决策覆盖（decisions.md）
| 决策 | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 明细-任务一对一（版本链） | task-06 | FR-04 单测：变更后任务 ps_plan_node_detail_id 迁到新版本，不产生第二条 |
| D-002@v1 字段映射 | task-01 | FR-01a 单测全字段断言（user_id/content/start/end/work_load/ps_plan_node_detail_id/module/project/status） |
| D-003@v1 执行人空跳过 | task-02 | FR-01c 单测：execute_user_id 空 → 不建任务 |
| D-004@v1 删除解关联 | task-05 | FR-05 单测：删明细后任务 ps_plan_node_detail_id=null、任务保留 |
| D-005@v1 导入批量建 | task-04 | FR-02 单测：done 明细批量建任务、draft 不建、失败整批回滚 |
| D-006@v1 历史不补建 | task-07 | FR-07 负向单测：ORM 直建 done 明细不回填 |
| D-007@v1 编辑同步 | task-05 | FR-03 单测：编辑后任务字段同步、status 不变 |

## 探针结果
**真实 pg 冒烟**（docker exec backend python）：用浦镇 2025 项目 + 成员「王鹏」，`create_detail(status=done)` → 自动建 `PlanTask`，`user_name=王鹏`、`content=联动冒烟`、`project_name=浦镇2025年EHS深化应用` 全部正确，验证 `_resolve_project_context` 项目回溯 + `_lookup_user_name` 姓名反查在真实 postgres 工作；已 CLEANED 不污染数据。

## 测试结果
- backend pytest（ppm.plan + ppm.task）：**95 passed**
- ruff check：All checks passed
- ruff format --check：69 files already formatted
- mypy（service.py）：Success, no issues
- frontend tsc --noEmit：EXIT 0
- 既有 test_router::test_import_commit status 断言债务已修正（git stash 验证 HEAD 对话前就失败，适配 status=DONE-if-required_filled 逻辑变更，非本次回归）

## 变更风险等级
**medium** — 业务逻辑联动（明细状态机触发建任务），单库同事务强一致，非 daemon/session/lease 分布式生命周期。无 schema/表结构变更，回退路径明确（移除 5 触发点 helper 调用即解耦，无数据依赖）。

## Runtime Evidence
真实环境（Docker backend + postgres）验证通过：
- backend Docker 重建 healthy（含最新联动 + 导入拆分代码）
- `create_detail(done)` → `PlanTask` 自动建（姓名反查 + 项目回溯正确）
- `import_commit` 多责任人拆分（test_router 端到端：全匹配拆 N 条 / 部分未匹配整行标红 / work_load 各原值）
- 任务计划列表超管删除（前端部署生效，用户已手工测试通过）

## NOTES（不影响 PASS）
1. ql-014（导入拆分）+ ql-015（超管删除）为 design 后的 quick 增强，已独立验收（测试 + 部署 + 用户手工验证），design.md 未含但功能完整、可追溯（quicklog + ppm.md 变更索引）。
2. 既有 test_router::test_import_commit status 断言修正（对话前 status 逻辑变更遗留，stash 验证非本次回归）。
3. `git push` 未成功（github 网络连不上，端口 443 超时，已知间歇问题）；本地已 commit（4527d9f1 / ab6250ae / 3ca8013b / 66b7d1b1 / e6fe81c9 / ce7ea276），网络恢复后可重试 `git push origin sillyspec/2026-07-15-milestone-detail-auto-task`。
4. execute 为 in-place 模式（worktree Windows 长路径失败降级），踩坑记录见 `docs/sillyspec/execute-in-place-windows-pitfalls.md`。
