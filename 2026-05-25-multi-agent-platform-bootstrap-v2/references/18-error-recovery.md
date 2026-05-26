# 18 — 错误恢复与故障处理

## 1. 设计原则

```text
1. 失败必须可观察、可恢复、可审计
2. 文件系统是事实源，DB 索引允许 stale
3. Worktree / 凭据 / Token 都必须有 TTL，超时强制清理
4. 状态不允许卡在 in_progress，必须有守恒检查 daemon
5. 高危失败要降级人工，不要自动循环
```

## 2. 失败分类

| 类别 | 例子 | 默认策略 |
|---|---|---|
| 平台 bug | API 500、未捕获异常 | 立即告警，中断当前事务，回滚 |
| Git 网络失败 | push 被拒、超时、5xx | 指数退避重试 3 次后转人工 |
| Git 鉴权失败 | PAT 过期、SSH key 无权限 | 不重试，立即失效该 GitIdentity 并通知用户 |
| Agent 失败 | 超时、API 限流、推理错 | 指数退避重试 3 次，达到上限转人工 |
| Tool 调用失败 | 命令非 0、参数非法 | 默认不重试（避免副作用），交由 Agent 决定 |
| 审批被拒 | Reviewer 封驳 | 标记 task = changes_requested，回执行阶段 |
| 凭据失效 | PAT 过期、撤销 | 立即标记 git_identity 失效，弹窗提示重绑 |
| Worktree 残留 | Lease 到期未释放 | GC daemon 5 分钟扫一次，强制 release + clean |
| 主密钥丢失 | 加密 key 损坏 / 版本错 | 所有 git_identity 失效，必须用户重新绑定 |

## 3. Agent Run 失败回滚

```text
Run 失败
  ↓
1. 标记 agent_runs.status = failed，写 error_message
2. 不自动 push（即便已有本地 commit）
3. 释放 worktree_lease.status = released，但保留 path 24h
4. 在 UI 给出两个动作：
     [重新执行]：用同一 lease，新建 run_id
     [丢弃此 run]：git reset --hard origin/<base>; git clean -fdx; 删 lease 目录
5. 24h 后 daemon 自动按"丢弃"清理
```

## 4. 重试策略

```yaml
retry_policy:
  agent_run:
    max_attempts: 3
    backoff: exponential
    initial_delay: 30s
    max_delay: 10min
    jitter: 0.2
    retry_on: [timeout, rate_limit, network_5xx]
    no_retry_on: [permission_denied, invalid_input, quota_exceeded]

  git_operation:
    max_attempts: 3
    backoff: linear
    initial_delay: 5s
    retry_on: [network, server_5xx]
    no_retry_on: [auth_failed, conflict, ref_locked]

  tool_call:
    max_attempts: 1
    retry_on: []
    note: 副作用工具一律不重试，重试由 Agent 主动决定

  outbox:
    max_attempts: 20
    backoff: exponential
    initial_delay: 10s
    max_delay: 1h
```

## 5. 状态守恒

```text
潜在死锁状态：tasks.status = in_progress 但无对应 active agent_run
              changes.status = reviewing 但无 pending approval
              worktree_leases.status = locked 但无关联活跃 run
```

`state-reaper` daemon 每 5 分钟扫描：

```sql
-- 卡在 in_progress 超过 30 分钟且无心跳的 task
UPDATE tasks SET status = 'ready', updated_at = NOW()
 WHERE status = 'in_progress'
   AND updated_at < NOW() - INTERVAL '30 minutes'
   AND id NOT IN (SELECT task_id FROM agent_runs WHERE status = 'running')
RETURNING id;
-- 写审计事件 STATE_RECOVERED

-- 过期 worktree lease
UPDATE worktree_leases SET status = 'expired', released_at = NOW()
 WHERE status = 'locked' AND expires_at < NOW();
-- 触发文件清理任务
```

## 6. 数据一致性 — Outbox 模式

平台写入 SillySpec 文件 + Git 提交是关键链路，必须用 Outbox：

```text
HTTP 请求
  ↓
1. 主事务（同一 DB 事务）：
     - 写业务表（changes / change_documents / tasks）
     - 写 outbox 表（pending）
  ↓ commit
2. 后台 worker 消费 outbox：
     - 写 SillySpec 文件
     - git add / commit / push
     - 成功 → outbox.status = completed
     - 失败 → 指数退避，attempts++
3. 失败超过 max_attempts：
     - status = dead_letter
     - 触发告警
     - UI 显示该 change "Git 同步失败"，提供"重试"按钮
```

不允许直接在 HTTP 请求里同步调用 git push。

## 7. 故障演练（每月强制执行）

| 演练 | 频次 | 通过标准 |
|---|---|---|
| 关 Postgres | 月 | 前端友好降级；恢复后无数据丢失 |
| 关 Redis | 月 | task lock 拿不到时拒绝执行而非死锁；通知发送降级 |
| 模拟 Git push 失败 | 每次 release | 自动转人工；状态正确；不重复推送 |
| 模拟 Agent 超时 | 每次 release | worktree 不残留；凭据被清；run 标记 timeout |
| 模拟 Agent 写越权路径 | 季 | Tool Gateway 拦截；事件入审计 |
| 模拟主密钥丢失 | 季 | 所有 git_identity 自动失效；用户引导重绑 |
| Worktree 磁盘满 | 季 | 新 lease 拒绝；旧 lease 不影响；GC 工作 |
| Outbox 阻塞 | 月 | 告警触发；不影响新写入 |

## 8. 监控告警阈值

| 指标 | 警告 | 紧急 |
|---|---|---|
| API p95 延迟 | > 1s 持续 5min | > 3s 持续 5min |
| API 错误率 | > 1% 持续 5min | > 5% 持续 5min |
| Agent Run 失败率 | > 30% 持续 1h | > 60% 持续 30min |
| Worktree 残留数 | > 100 | > 500 |
| Outbox dead_letter 数 | > 0 | > 10 |
| Git 鉴权失败 | > 5/小时 | > 50/小时 |
| 审计写入失败 | > 0 | > 0（审计写入失败必须紧急） |
| 主密钥解密失败 | > 0 | > 0 |
| DB 连接池满 | > 80% | > 95% |

## 9. 用户侧错误提示规范

```text
1. 永远不要把堆栈 / SQL / 内部 token 显示给前端
2. 错误码：HTTP_<code>_<MODULE>_<REASON>，如 HTTP_403_AUTH_MISSING_PERMISSION
3. 错误体：{ "code": "...", "message": "...", "trace_id": "..." }
4. trace_id 必须能在后端日志中索引到完整堆栈
5. 用户能看到的修复建议：例如"Git 凭据已过期，请到设置 → Git 身份 重新绑定"
```

## 10. 灾难恢复（DR）— V3+

- RTO：4 小时
- RPO：1 小时
- 备份位置：异地 S3 兼容存储
- 每季度演练一次 restore：从备份恢复一份只读副本，验证数据完整性
- 凭据加密主密钥：HSM / KMS 双备份，绝对不入备份归档

## 11. V1 必须实现的最小恢复能力

- [ ] API 全局异常拦截器，永远返回结构化错误
- [ ] state-reaper daemon（哪怕只跑 tasks 一张表）
- [ ] worktree GC daemon
- [ ] 失败的 Git 操作必须有 `git_operation_logs.error_message`
- [ ] 失败的 audit_event 必须有重试 + dead letter
- [ ] 前端展示"上次扫描时间"，提示数据可能 stale
