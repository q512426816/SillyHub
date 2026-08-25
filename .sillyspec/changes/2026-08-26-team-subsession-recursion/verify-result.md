---
author: qinyi
created_at: 2026-08-26 04:50:00
---

# 验证报告（Verify Result）— 团队分身递归开闸 P2

## 结论

**PASS WITH NOTES**

9/9 任务完成并合并主干（d6b1426b）；三端全量全绿；独立 QA acceptance review
pass（FR-01~08 逐项 file:line 核验）；运行时证据齐备。NOTES 为三条非阻断
观察项 + 部署提醒。

## 单元测试结论

| 端 | 结果 | 备注 |
|---|---|---|
| backend | **4694 passed, 5 skipped** | 合并主干态；含 test_subsession_recursion_* 族与 8 个 test_worker_subsession_* 更新 |
| frontend | **200 文件全过（2268 用例）** | tsc 零错 |
| sillyhub-daemon | **164 文件全过（2855 用例, 9 skipped）** | typecheck 零错；含 worker-tiered-toolset 20 例 |
| lint | ruff/mypy 730 files/tsc | 全零错 |

## Runtime Evidence（真实启动 + 集成）

### 1. daemon 入口真实启动（cli.ts 本变更触及）

```
$ pnpm build && node dist/cli.js --help   → exit 0
```

### 2. backend 合并代码真实启动（uvicorn）

```
GET /api/health → 200 {"status":"ok","db":"ok","redis":"ok","commit_sha":"d3b20cc0c9cb"}
/api/openapi.json → sub_workers_count 命中（task-08 折叠计数注册）
启动日志 → budget_force_ended 命中（task-07 patrol 职责⑥计数键上线）
POST /api/missions/converge 无鉴权 → 401（鉴权门正常，层0守卫在其后）
```

### 3. 端到端 integration test（真实 DB 非 mock）

`test_subsession_recursion_dispatch.py`（13 用例）：分身派孙（parent/depth/
lease worker_depth 落库）→ 孙 dispatch 400 零写入 → 分身只读不 404 →
converge 四通道（分身 403/主控过/Bearer 豁免/apiKey 裸调 403）→ 孙
worker_done 全树可用。`test_worker_subsession_patrol_budget.py`：预算触顶
强收 → 标记 → 可收敛 degraded 全链。

## 逐项验收（design §2 ↔ 证据）

1. 递归派发到孙 ✅（13 用例 + CTE 全树八用例）
2. 深度双保险 ✅（backend 400 + daemon 叶档单工具，双侧=2 有锁漂移断言）
3. converge 权不下放 ✅（四通道守卫）
4. 预算闭环 ✅（派发门拦增量 P1 已有 + patrol 强收运行中 + 可收敛映射）
5. daemon 会话闸 ✅（默认 20/超限拒/restore 豁免/失败即收口四闸防误杀）

## NOTES（不阻断）

1. 三条 QA 观察项（详见 execute-review-2026-08-26-034500）：converge 三
   header 皆无放行依赖路由鉴权先 401（新增免鉴权路由需重估）；patrol
   constraints dict 覆盖写（单实例顺序执行低险）；run_sync 直探 readiness
   私有成员（只读有先例注释）。
2. 部署提醒：Docker 实例（8001）为 P1 部署，P2 能力需再重建镜像。
3. 行为变化显式确认：存量 depth=1 分身自动获得派工能力（FR-08 预期）。
