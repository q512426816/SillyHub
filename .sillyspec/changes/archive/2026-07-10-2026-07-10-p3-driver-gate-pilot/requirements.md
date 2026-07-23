---
author: qinyi
created_at: 2026-07-10T14:25:00+08:00
---

# 需求规格（Requirements）

## 功能需求（FR）
- **FR-1**：verify stage 完成时，backend 经 HostFsDelegate `run_command` 让 daemon 跑 `sillyspec gate verify`，结果存 `AgentRun.gate_result`
- **FR-2**：`auto_dispatch_next_step` 读 `gate_result` 三态决策（exit 0 推进 / 1 打回 / 2 卡住）
- **FR-3**：gate exit 1 打回 → dispatch 同 stage + feedback errors，`gate_retry_count` +1，>=3 升级 exit 2 报警人工
- **FR-4**：gate 任务后台异步——close 快速返回 HTTP（<30s，daemon 不重试），gate 不阻塞 HTTP 链
- **FR-5**：gate 任务用独立 session（`get_session_factory()`）+ `_fire_background_task` 强引用 set 防 GC + add_done_callback 取异常
- **FR-6**：R3 cas `gate_status` pending→running 原子防 double-fire（reconcile + 原任务并存）
- **FR-7**：`reconcile_pending_gate_decisions` 挂 lifespan startup，重启扫 completed + gate_status in(pending,running) 全重置 pending + 重 enqueue
- **FR-8**：HostFsDelegate `run_command` 命令白名单（只允 sillyspec gate 模板，stage 枚举 + changeName），拒任意命令
- **FR-9**：gate 任务完成发 Redis `gate_status_changed` SSE（agent_run_id + gate_status + errors 摘要），前端订阅更新
- **FR-10**：errors 前端摘要（gate_result.errors 截断）+ 完整审计（raw_envelope）+ 跨 run 持久（change.stages `gate_last_errors`）
- **FR-11**：Z1 启动探测 sillyspec gate 子命令存在性，缺失给清晰 exit 2（诊断，非 fallback）

## 非功能需求（NFR）
- gate verify-test ~27s 不阻塞前端（异步 + 27s 落在后台推进环节，用户无感）
- 纯增量，所有改动可独立回退
- 生产 PG cas 原子可靠；SQLite 测试用 mock 或 RETURNING 验证
- 向后兼容：gate_result/gate_status 列可空，老 agent_run 无值 fallback 声明态（非 verify stage）

## 前置条件（开工前必须）
- sillyspec `npm version patch + publish`（本机已 npm link 开发版，生产部署需发版）
- `alembic heads` 确认 main 真实 head（当前 14 head 碎片化）定 migration down_revision

## 验收用例（AC）
- AC-1：verify 实测通过 → gate exit 0 → 推进 archive
- AC-2：verify 实测失败 → gate exit 1 + errors → 打回，agent 重跑
- AC-3：gate 连续 3 次 exit 1 → 升级 exit 2 报警人工
- AC-4：gate 异常（daemon 离线/超时/sillyspec 未发版）→ exit 2 → verify 阻断 fail-loud
- AC-5：close 快速返回 <30s，daemon 不重试；gate 后台跑
- AC-6：backend 重启 → reconcile 扫孤儿 gate 任务重 enqueue → stage 最终推进
- AC-7：同一 run double-fire（reconcile+原任务）→ R3 cas 只一个跑
- AC-8：命令白名单拒非 gate 命令
- AC-9：前端 gate_status 实时更新（客观核验中→已通过/失败）
