---
author: qinyi
created_at: 2026-06-24T01:47:08
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
---

# Agent 批量任务执行流程（AgentRun）

## 目标
把 SillySpec 阶段派发 / 扫描派发 / init 派发 / 独立任务（quick-chat 等）编排成 AgentRun，落到在线 daemon 上安全执行，实时流式回传日志与消息，并经统一 kill 通道终止。

## 参与模块
- agent：编排中枢——`start_stage_dispatch` / `start_scan_dispatch` / `start_init_dispatch` / `start_run` 四类派发入口，ExecutionCoordinatorService 幂等与断点续跑（指纹/checkpoint/resume），AgentProfile 档案解析与 `_apply_profile_to_lease` 透传，mission 多 worker 团队，placement 选在线 daemon
- daemon：backend 侧 lease 生命周期（claim/heartbeat/cancel）+ `lease/context` 组装 claim payload（供应商四级解析 + profile 注入 + mission 预算）+ run_sync 消息落库与完成回调；Node 侧 TaskRunner 执行、credential-injector 凭证注入、ResilienceService 韧性上报
- worktree：需写盘的派发先 `acquire` WorktreeLease 隔离执行目录
- llm_provider：claim payload 供应商解析（openai_chat 类经 LiteLLM 网关，下发 `litellm_proxy` 标记不发明文 key）
- workflow：AuditLog 审计底座（run 相关操作留痕）
- frontend_app：Next.js BFF 中继 `app/api/workspaces/[id]/agent/runs/[runId]/stream`（SSE）
- frontend_components：agent-run-panel 等运行面板与日志视图

## 流程摘要

```text
(前端/变更中心)  显式触发派发（形态A：无自动连轴）
     │  POST /workspaces/{ws}/agent/runs（独立任务）
     │  或 advance_stage / scan / init 等派发入口
(backend agent)  AgentService.start_*_dispatch
     │  ├─ _resolve_dispatch_profile（run 显式 → workspace 默认 → 系统默认档案兜底）
     │  ├─ 需写盘 → worktree.acquire（WorktreeLease）
     │  ├─ 幂等：check_idempotency(key) + AgentSpecBundle 指纹 compute/validate
     │  └─ placement 选在线 daemon → 建 daemon_task_lease(pending)
     ▼
(backend daemon) DaemonWsHub.notify_task_available 唤醒
     │  lease/context.build_claim_payload：
     │  ├─ 供应商四级解析：run 绑定 profile 的 llm_provider_id（归属校验）
     │  │    → 平台默认供应商 → 本机不注入
     │  │    openai_chat 类 → litellm_proxy 标记 + hub 代理地址（master key 不出 hub）
     │  └─ profile 的 mcp/skills/凭证/allowed_roots 写进 lease.metadata
     ▼
(daemon Node)    claim(claim_token) → TaskRunner 执行
     │  ├─ init lease 特例：不 spawn agent，写 .sillyspec-platform.json
     │  │    + pull 文档 + spawn `sillyspec init` + writeLocalYaml
     │  ├─ credential-injector 注入凭证（CLAUDE_CONFIG_DIR 隔离）
     │  └─ 消息/结果 async 串行上报（message 先于 result 落库）：
     │      resilience.submitWithRetry（退避重试→用尽入 FileOutbox→心跳健康后 drainOutbox）
     ▼
(backend daemon) run_sync.submit_messages
     │  ├─ segmentId 跨调用去重（partial/complete）+ 撤回已提交半截
     │  ├─ pending→running 原子条件 UPDATE（防迟到 submit 覆盖终态）
     │  └─ SSE /agent/runs/{id}/stream 转发前端
     ▼
(daemon)         完成 → lease complete
(backend)        _trigger_stage_completion_callback 驱动 change stage 收口
                 / _advance_team_stage（execute 团队全 worker 收敛后推阶段）
```

kill 通道（统一入口 `cancel_lease`）：

```text
(前端)  POST /agent/runs/{id}/kill（quick-chat 同款 kill 端点）
(backend daemon.lease_service) cancel_lease：
  ├─ 写 terminating_at（等 daemon 回传终态的标记）
  ├─ interactive 会话 → SESSION_END 下发
  ├─ batch lease → LEASE_CANCEL WS 即时推送（best-effort，加速感知；
  │    心跳周期检测 cancelled 兜底，两通道幂等）
  └─ daemon 回传终态后清空标记；sweeper 收敛无回执行的行
```

## 失败回滚

| 失败点 | 处理 |
|--------|------|
| 无在线 daemon | NoOnlineDaemonError，run 标记失败，前端提示 |
| profile 查不到 | worker 标 profile_not_found failed，不崩 mission |
| spec 内容变更（指纹变） | 旧 resume token 失效，须重新派发 |
| daemon 崩溃/失联 | runtime 心跳超时标 offline；expire_overdue_leases 回收 lease；run 由 reconcile/cleanup_stale_runs 定时收敛 |
| 网络抖动消息丢失 | ResilienceService FileOutbox 暂存，心跳恢复后补发（补发前校验 lease 有效，claim_token 失效丢弃） |
| 消息重复上行 | submit_messages 按 segmentId 去重 |
| 任务需人工 kill | kill → cancel_lease 两路下发（见上）；WS 推送不达时心跳周期兜底 |
| run 卡死 | cleanup_stale_runs / reconcile_stale_runs 定时收敛（只清理不推进阶段） |
