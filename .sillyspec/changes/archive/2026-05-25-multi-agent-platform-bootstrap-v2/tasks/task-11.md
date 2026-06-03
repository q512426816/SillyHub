---
id: task-11
title: 实现 Git Tool Gateway
phase: V2/V3
priority: P0
status: draft
owner: qinyi
estimated_hours: 20
affected_components:
  - platform-api
  - agent-runtime
allowed_paths:
  - backend/app/modules/git_gateway/
  - backend/app/modules/audit/
depends_on:
  - task-10
blocks:
  - task-12
  - task-14
  - task-15
---

## 1. 目标

封装所有 Git 操作为受控 API，拦截危险命令，记录全量 `git_operation_logs`。Agent 与平台代码都必须通过 Gateway，不能直接调 `git` 子进程。

## 2. 输入

- `requirements.md` FR-009
- `references/04-git-identity-and-worktree-isolation.md` §8
- `references/07-tool-gateway-design.md`
- `references/17-db-schema.md` §2.5 `git_operation_logs`

## 3. 产出清单

### 3.1 允许的操作

| 操作 | 风险 | 控制 |
|---|---|---|
| status | 低 | 记录 |
| diff | 低 | 记录 |
| log | 低 | 记录 |
| branch list | 低 | 记录 |
| create branch | 低 | 分支名前缀必须 `users/...` 或 `agents/...` |
| add | 低 | 路径限制（仅 lease.path 内） |
| commit | 中 | 强制 author = identity.name/email |
| push branch | 中 | 仅 push 任务分支；禁止 push default branch |
| fetch | 中 | 仅 fetch 当前 component |
| pull --ff-only | 中 | 不允许 merge |
| create PR | 中 | 调用 provider API |
| ls-remote | 中 | 用于 check-access |

### 3.2 禁止 / 审批操作

| 操作 | 处理 |
|---|---|
| push origin main/master/default | 拒绝（事件 `GIT_BLOCKED_PUSH_DEFAULT`） |
| push --force / --force-with-lease | 默认拒绝，可申请审批 |
| reset --hard | 拒绝；走 release lease 重新创建 |
| clean -fd / -fdx | 仅 release 时由 manager 内部使用，Gateway 拒绝 |
| merge | 拒绝（合并必须走 PR） |
| tag | 默认拒绝，可申请审批 |
| branch -D | 拒绝 |
| config --global | 拒绝（必须用 lease 的 GIT_CONFIG_GLOBAL） |
| remote set-url | 拒绝 |
| filter-branch / rebase -i | 拒绝 |
| 任意未在白名单 | 拒绝 |

### 3.3 后端模块

```text
backend/app/modules/git_gateway/
├─ __init__.py
├─ router.py
├─ gateway.py             # 主入口
├─ commands/
│  ├─ status.py
│  ├─ diff.py
│  ├─ commit.py
│  ├─ push.py
│  ├─ pr.py
│  └─ ...
├─ policies.py            # 白名单 + 拦截规则
├─ providers/
│  ├─ github.py           # create PR / get repo info
│  ├─ gitlab.py
│  └─ gitea.py
├─ schema.py
└─ tests/
   ├─ test_policies.py
   ├─ test_commands.py
   └─ test_dangerous.py    # 红队测试 — 尝试越权
```

### 3.4 API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/git/exec` | 统一入口，body 含 `lease_id + operation + params` |
| POST | `/api/git/pr` | 创建 PR |
| GET | `/api/git/operations` | 查询 git_operation_logs（管理用） |

请求示例：

```json
{
  "lease_id": "...",
  "operation": "commit",
  "params": {
    "message": "feat: ...",
    "files": ["frontend/src/app/page.tsx"]
  }
}
```

### 3.5 实现要点

```python
class GitGateway:
    async def execute(self, ctx: GitContext, op: str, params: dict) -> GitResult:
        # 1. 校验 lease 活跃
        lease = await self._load_lease(ctx.lease_id)
        if lease.status != "locked": raise ConflictError("lease_not_active")

        # 2. 校验 op 白名单
        cmd = self.commands.get(op)
        if not cmd: raise BlockedOperation(op)

        # 3. 校验 params 与 policy
        cmd.validate(params, lease)

        # 4. 构造 env（用 task-10 的 exec_env）
        env = build_exec_env(lease, ctx.git_identity)

        # 5. 子进程执行（list 参数、超时、限制 stdout 大小）
        result = await run_git(cmd.argv(params), cwd=lease.path, env=env, timeout=cmd.timeout)

        # 6. 写 git_operation_logs + audit_events
        await self._log(ctx, op, params, result)

        # 7. 失败按 references/18 重试或转人工
        return result
```

### 3.6 安全要点

- 所有命令必须用 **list 形式** 传入 subprocess，禁止 `shell=True`
- params 中字符串过滤 `;`、`&&`、`|`、反引号等元字符
- 子进程 stdout 限制 ≤ 5MB，超出截断 + warning
- 超时默认 60s，可单独配置
- `git commit` 必须传 `--author="Name <email>"`，强制覆盖
- `git push` 必须解析 refspec，目标分支不允许是 default_branch
- audit 必须先于命令执行写入"尝试"事件，命令完成后再写"结果"事件（防止崩溃丢日志）

## 4. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | exec status | 成功，记录 log |
| AC-02 | exec commit 后 author 与 identity 一致 | git log 验证 |
| AC-03 | push 到 default branch | 拒绝 `GIT_BLOCKED_PUSH_DEFAULT` |
| AC-04 | push --force | 拒绝 |
| AC-05 | reset --hard | 拒绝 |
| AC-06 | config --global | 拒绝 |
| AC-07 | 任意未白名单子命令 | 拒绝 |
| AC-08 | params 含 `;` 注入 | 拒绝或转义 |
| AC-09 | stdout 超 5MB | 截断 + warning |
| AC-10 | 超时被 kill | 进程被回收，记录 timeout |
| AC-11 | 红队测试：模拟 Agent 试图越权 | 全部被拦截 |
| AC-12 | git_operation_logs 全量入库 | 每次都有记录 |
| AC-13 | 失败按 retry_policy 重试 | 见 references/18 |
| AC-14 | 单测覆盖率 | ≥ 90%（gateway 是安全核心） |
| AC-15 | 集成测试用真实 GitHub PAT 跑一遍 push + PR | PR 能创建 |

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Agent 绕过 Gateway 直接调 git | 越权 | 沙箱里禁用裸 `git` 命令，仅暴露 Gateway HTTP；V4 再用容器强化 |
| 命令注入 | 任意代码执行 | list 传参 + 元字符过滤 + 不用 shell |
| stdout 含敏感信息 | 日志泄漏 | 输出脱敏（token 模式匹配） |
| provider API rate limit | PR 创建失败 | 退避重试 |
| 子进程被 SIGSTOP 卡死 | 资源占用 | 超时强 kill；GC daemon 兜底 |

## 6. 完成定义

- [ ] 15 个 AC 通过
- [ ] 红队测试报告
- [ ] 单测 + 集成
- [ ] `verification.md` 追加 task-11 记录
- [ ] PR 合并
