---
id: task-15
title: 实现 Tool Gateway 通用能力
phase: V4
priority: P1
status: draft
owner: qinyi
estimated_hours: 24
affected_components:
  - platform-api
  - agent-runtime
allowed_paths:
  - backend/app/modules/tool_gateway/
  - agent-runtime/tool_proxy/
depends_on:
  - task-11
  - task-14
blocks:
  - task-16
---

## 1. 目标

把 task-11 的 Git Tool Gateway 扩展为通用 Tool Gateway，统一管理 file / shell / test / git / network / db / secret 等工具调用。所有 Agent 的工具调用必须经过 Gateway。

## 2. 输入

- `references/07-tool-gateway-design.md`
- `references/16-rbac.md` §4
- `references/17-db-schema.md` §5 `tool_calls`

## 3. 产出清单

### 3.1 工具清单与风险分级

| Tool | Risk | 控制 |
|---|---|---|
| file_read | low | allowed_paths 内 |
| file_write | medium | allowed_paths 内，size ≤ 10MB |
| file_delete | high | 仅允许 `.tmp` / 测试目录 |
| shell_exec | high | 命令白名单 + 参数限制 + 超时 |
| run_tests | medium | 仅运行 component.test_command |
| git_* | (见 task-11) | (见 task-11) |
| pr_create / pr_update | medium | provider API |
| network_fetch | medium | URL 白名单 + 不允许私网 |
| db_execute | critical | 默认禁止；审批 |
| deploy_* | critical | 见 task-16 |
| secret_read | critical | 默认禁止 |

### 3.2 命令白名单

shell_exec 默认允许：

```text
ls / cat / grep / find / head / tail / wc
node / pnpm / npm / pytest / uv / python / make
git (转发到 Git Gateway)
```

危险关键字触发拒绝：

```text
rm -rf / mkfs / dd / curl <ip> / wget / sudo / chmod 777
> /dev/sd* / shutdown / reboot / kill -9 1
```

### 3.3 后端模块

```text
backend/app/modules/tool_gateway/
├─ __init__.py
├─ router.py
├─ gateway.py
├─ tools/
│  ├─ file.py
│  ├─ shell.py
│  ├─ tests.py
│  ├─ network.py
│  └─ ...
├─ policies.py
├─ schema.py
└─ tests/
```

### 3.4 API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/tools/call` | `task:run_agent` | 通用入口 |
| GET | `/api/tools/calls/{call_id}` | owner / admin | 详情 |
| GET | `/api/tools/calls?run_id=...` | owner / admin | 列出某 run 的工具调用 |
| POST | `/api/tools/approve/{call_id}` | reviewer | 高危调用审批 |

请求：

```json
{
  "run_id": "...",
  "tool": "shell_exec",
  "params": {
    "argv": ["pnpm", "test"],
    "cwd": "frontend",
    "timeout_seconds": 120
  }
}
```

### 3.5 执行流程

```text
1. 校验 run 活跃 + run 的 token / 权限
2. 工具白名单匹配
3. 参数校验（allowed_paths / 命令白名单 / size 限制）
4. 风险分级查表
5. high / critical → 创建 approval 阻塞等待（task-13）
6. 执行（subprocess + 隔离 env + 超时）
7. stdout/stderr 脱敏
8. 写 tool_calls + audit_events
9. 返回结果或转 artifact
```

### 3.6 限额

```yaml
per_run_limits:
  shell_exec_calls: 100
  file_write_bytes: 50 MB
  network_requests: 50
  duration_total: 30 min
```

## 4. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | file_read 越界路径 | 拒绝 |
| AC-02 | file_write > 10MB | 拒绝 |
| AC-03 | shell_exec `rm -rf /` | 拒绝 + 红色审计 |
| AC-04 | shell_exec `pnpm test` | 通过，stdout 捕获 |
| AC-05 | network_fetch 私网 IP | 拒绝 |
| AC-06 | db_execute 默认拒绝 | 401/403 |
| AC-07 | secret_read 默认拒绝 | 401/403 |
| AC-08 | 高危需审批，审批前阻塞 | 验证 |
| AC-09 | 审批拒绝后调用方收到失败 | 错误码正确 |
| AC-10 | 限额超过自动取消 | run cancel |
| AC-11 | 全量 tool_calls 入库 | 验证 |
| AC-12 | 红队：尝试 cmd injection | 全部被拦截 |
| AC-13 | 单测覆盖率 | ≥ 90%（安全核心） |

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 命令白名单不全 | 默认拒绝 + 允许列表，宁可误杀 |
| 子进程逃逸 | exec_env 强制；V5 上容器 |
| 高危审批长时间无人响应 | approval 超时 → 自动拒绝 |

## 6. 完成定义

- [ ] 13 个 AC 通过
- [ ] 红队测试报告
- [ ] `verification.md` 追加 task-15 记录
- [ ] PR 合并
