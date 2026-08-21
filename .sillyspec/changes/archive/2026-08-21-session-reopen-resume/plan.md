---
author: qinyi
created_at: 2026-08-21 11:45:12
plan_level: full
change: 2026-08-21-session-reopen-resume
---

# 实现计划（Plan）— 打通会话重新开启（reopen）链路

> 版本：v3（2026-08-21 计划审查 pass 后编号连续化：弃用占位 task-06 删除，原 07→06 / 08→07 / 09→08 / 10→09，task id 01-09 连续满足 postcheck；其余内容与审查通过的 v2 一致）

## Spike 前置验证

无新增 Spike。三个关键技术不确定性均已由前置双子代理行级验证 + 独立设计审查闭环确认：daemon 从零重建链路可用（`daemon.ts:2944-3008` 不依赖内存/本地文件）、resume key 已流入 `AgentRun.session_id`（`run_sync/service.py:746-749`）、hub-client 封装前置条件（F1）与超时基准选列（F2）已在 design v2 落对策。

## 同文件约束（Wave 排布依据）

`backend/app/modules/daemon/session/service.py` 被 task-03、task-04 触碰（confirm/mark-failed 校验 vs reopen 前置校验）→ 强制分属不同 Wave。sweeper **定案独立文件** `backend/app/modules/daemon/sweep.py`（design 留有的"并入 session service 层"选项废弃，避免与 task-03/04 同文件），仅 main.py 挂载一行由 task-05 顺带。`RECONNECTING_RETRY_WINDOW_SEC = 180` 常量**唯一落点** = session/service.py（task-03 Wave 定义或 task-04 定义，先落 Wave 者为准，后者 import）。

## Wave 1（并行，backend 数据层与契约，无依赖，文件互不相交）

- task-01
- task-02
- task-03

## Wave 2（依赖 Wave 1；task-04 与 task-06 文件不相交可并行）

- task-04
- task-06

## Wave 3（依赖 Wave 2；task-05/07/08 文件互不相交）

- task-05
- task-07
- task-08

## Wave 4（收尾，依赖全部）

- task-09

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/NFR | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 增量回填 agent_session_id | W1 | P0 | — | FR-01 | run_sync/service.py submit_messages 内最新值覆盖；batch FK 空跳过；同事务 |
| task-02 | 存量迁移回填 | W1 | P0 | — | FR-02, NFR-04 | 取最后一轮 run 值；provider 限定；downgrade no-op；SQLite 兼容 |
| task-03 | confirm/mark-failed 可选 lease_id | W1 | P0 | — | FR-05, FR-04(语义), NFR-01 | router.py SessionRuntimeRequest（:1246 定义处）加可选字段；service 两函数（:2060/:2130 区域）不匹配幂等跳过；**保留 active→failed 既有翻转**；顺带定义 RECONNECTING_RETRY_WINDOW_SEC 常量；OpenAPI dump；测试：幂等、lease 不匹配、无 lease_id 兼容、既有 recover 链路不变 |
| task-04 | reopen 前置校验扩展（超时窗口 + cwd 排除） | W2 | P0 | task-03 | FR-06, FR-08 | 同函数两处前置校验：①reconnecting 且 last_active_at>180s 放行（旧 lease 置 cancelled 新建重发；last_active_at=now 已写，service.py:2414 复核）②cwd 空 409 专用错误+中文文案（原独立 task-05 并入，DS-7）；测试：窗口两分支 + cwd 空 409 |
| task-05 | 巡检协程自动收敛 | W3 | P0 | task-04 | FR-07, NFR-04 | **独立文件 sweep.py** + main.py lifespan 挂载（仿 mission_patrol_loop）；60s 周期 import task-03/04 的常量；lease 终态 cancelled；条件更新幂等；测试：收敛、幂等、不误伤窗口内 |
| task-06 | daemon 双向确认 | W2 | P0 | task-03 | FR-03, FR-04 | daemon.ts + hub-client.ts：runtimeId 从 SESSION_RESUME payload 显式供给（映射写入或参数透传二选一，任务卡定案）；成功调 confirmReconnected（携 lease_id）；SessionAlreadyExists（try 前）纳入失败分支调 markRecoveryFailed；best-effort；修正 daemon.ts:2932 注释；签名统一记录于任务卡（design.md 不回改，保持已过审 hash 稳定） |
| task-07 | daemon 测试 | W3 | P0 | task-06 | NFR-02 | confirm 真发出断言（runtimeId 供给，防 F1 回归）、失败分支、best-effort；**补 daemon-session-resume-route.test.ts createMockClient（:41-56）缺失的 confirmReconnected/markRecoveryFailed mock**（审查实证） |
| task-08 | 前端重开入口 | W3 | P1 | task-03 | FR-09, NFR-01 | sessions/page.tsx reconnecting 本地计时>240s 显示入口（复用 handleReopen）；409 文案中文化；OpenAPI 变更则 pnpm gen:types 提交 api-types.ts + openapi.json |
| task-09 | 收尾 | W4 | P2 | all | NFR-03 | 部署顺序说明（先 backend 后 daemon）；模块文档同步（backend.md/daemon.md 契约层）；全量回归；**更新 test_session_reopen.py TestReopenConfirmLinkage 过时 docstring（:638-640 "no lease/token check"）**（若 task-03 未顺带） |

## 关键路径

task-03 → task-06 → task-07 → task-09（lease_id 契约 → daemon 确认 → daemon 测试 → 收尾，4 Wave）。次关键：task-03 → task-04 → task-05（常量与基准链）；task-03 → task-08。

## 全局验收标准

- [ ] backend pytest：daemon 模块（run_sync/session/reopen/sweeper/迁移）全绿
- [ ] daemon vitest 全绿（含 F1 防回归断言）
- [ ] frontend vitest 全绿；gen:types 无漂移（若 schema 变更，`git diff --exit-code` api-types.ts + openapi.json）
- [ ] 全链路联动验收：测试桩模拟 daemon 走通 reopen → SESSION_RESUME → confirm-reconnected(lease_id) → active → inject
- [ ] 兜底场景：模拟 SESSION_RESUME 丢失 → 180s 后 sweeper 收敛 failed 且可再次 reopen；窗口内二次 reopen 仍 409
- [ ] 陈旧确认：过期 lease_id 的 confirm/mark-failed 幂等跳过不翻转
- [ ] scan 会话（cwd 空）reopen 得中文 409，不放行到 daemon
- [ ] 既有 recover 链路（daemon 重启恢复）行为不变（向后兼容分支测试）

## 覆盖矩阵（requirements.md）

| FR/NFR | 覆盖任务 | 验收证据 |
|---|---|---|
| FR-01 | task-01 | 回填/fork 覆盖/batch 跳过测试 |
| FR-02 | task-02 | 迁移 up 测试断言回填行数与取值 |
| FR-03 | task-06, task-07 | confirm 真发出断言 + 翻 active 集成 |
| FR-04 | task-06, task-03 | SessionAlreadyExists 分支 + active→failed 语义保留测试 |
| FR-05 | task-03 | lease_id 不匹配幂等跳过测试 |
| FR-06 | task-04 | 窗口内外两分支测试 |
| FR-07 | task-05 | sweeper 收敛/幂等/不误伤测试 |
| FR-08 | task-04 | cwd 空 409 测试（原独立 DS-7 任务并入） |
| FR-09 | task-08 | 240s 入口 + 文案测试 |
| NFR-01~04 | task-02/03/08/09 | 无新端点/表；gen:types 漂移检查；部署说明；跨平台惯例 |

## 连带测试债清单（审查实证，execute 必须承接）

| 既有测试 | 影响 | 承接任务 |
|---|---|---|
| `backend/app/modules/daemon/tests/test_session_reopen.py` TestReopenConfirmLinkage（:638-640 docstring "no lease/token check"） | task-03 加 lease_id 校验后 docstring 过时 | task-03 顺带或 task-09 兜底 |
| `sillyhub-daemon/tests/daemon-session-resume-route.test.ts` createMockClient（:41-56） | 无 confirmReconnected/markRecoveryFailed mock，task-06 后需补 | task-06/07 |
| `backend/.../test_session_reopen.py` fixture cwd 默认非空（:73）、既有用例 status=ended/active | task-04 改动不破坏存量（审查判定低风险） | task-04 回归确认 |

## 风险与回退

- 每 Wave 独立可验证：W1 纯数据层（出问题仅回填值错误，可重跑迁移修正）；W2/W3 行为变更（git revert 单 commit 粒度）；发版顺序先 backend（兜底先行）后 daemon，过渡期由 task-05/04 兜底覆盖。
- design.md 风险登记 8 项全部映射到任务与验收标准；design.md 定稿后不再回改（hash 稳定），execute 中的签名/落点定案记录于任务卡。
