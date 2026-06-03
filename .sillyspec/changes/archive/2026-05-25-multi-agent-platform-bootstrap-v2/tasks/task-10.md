---
id: task-10
title: 实现 Worktree Manager
phase: V1/V2
priority: P0
status: draft
owner: qinyi
estimated_hours: 24
affected_components:
  - platform-api
  - agent-runtime
allowed_paths:
  - backend/app/modules/worktree/
  - backend/app/core/exec_env.py
  - backend/migrations/versions/
depends_on:
  - task-09
blocks:
  - task-11
  - task-12
  - task-14
---

## 1. 目标

实现 `WorktreeLease` 全生命周期：申请 → 创建独立工作目录 + 临时 HOME → 注入凭据 → 释放 → GC。**这是多人单机部署下的隔离核心。**

**不在范围**：

- Git Tool Gateway 命令拦截（task-11）
- Agent 执行（task-14）

## 2. 输入

- `requirements.md` FR-008
- `references/04-git-identity-and-worktree-isolation.md` §5-6
- `references/11-deployment-single-server.md`
- `references/17-db-schema.md` §2.5 `worktree_leases`

## 3. 产出清单

### 3.1 目录约定

```text
/data/sillyspec-workspaces/
  {workspace_id}/
    components/
      {component_id}/
        .repo-bare/                    # 共享 bare 仓库（节省磁盘）
        worktrees/
          {user_id}/
            {change_id}/
              {task_id}/
                {run_id}/
                  repo/                # git worktree
                  home/                # 临时 HOME
                  gitconfig
                  askpass.sh
                  ssh-agent.sock      # 仅 SSH 模式
```

Windows 下用 `C:/data/sillyspec-workspaces/...`，路径全用 pathlib 处理。

### 3.2 数据表

按 17-db-schema.md §2.5 `worktree_leases`。

### 3.3 后端模块

```text
backend/app/modules/worktree/
├─ __init__.py
├─ manager.py             # 申请 / 释放 / GC
├─ git_runner.py          # subprocess 包装（与 task-11 共用）
├─ exec_env.py            # 构造隔离环境
├─ router.py
├─ schema.py
├─ model.py
└─ tests/
   ├─ test_manager.py
   └─ test_exec_env.py
```

### 3.4 exec_env 实现关键点

```python
def build_exec_env(lease: WorktreeLease, identity: GitIdentity) -> dict[str, str]:
    return {
        "HOME": str(lease.path.parent / "home"),
        "GIT_CONFIG_GLOBAL": str(lease.path.parent / "gitconfig"),
        "GIT_CONFIG_SYSTEM": "/dev/null",
        "GIT_ASKPASS": str(lease.path.parent / "askpass.sh"),
        "GIT_TERMINAL_PROMPT": "0",
        "PATH": os.environ["PATH"],
        # 不继承任何其他 env
    }
```

`askpass.sh`（Linux）/ `askpass.cmd`（Windows）由 manager 在申请 lease 时生成，文件权限 0o700，run 结束立即删。

凭据流：

```text
1. GitIdentity 从 DB 取出 ct + key_id
2. crypto.decrypt(ct, key_id) → 明文 PAT
3. 写入 askpass.sh 文件（短生命周期）
4. git 命令执行
5. 执行结束（成功/失败/取消）→ shred + unlink askpass.sh
```

绝不允许：

- 写 PAT 到命令行参数
- 写 PAT 到 `.git/config`
- 写 PAT 到日志
- 共用服务器 `~/.ssh` / `~/.gitconfig`

### 3.5 API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/worktrees/acquire` | `task:run_agent` | 申请 lease |
| POST | `/api/worktrees/{lease_id}/release` | owner / admin | 释放 |
| GET | `/api/worktrees/{lease_id}` | owner / admin | 详情 |
| GET | `/api/worktrees` | admin | 列出全部（管理用） |
| POST | `/api/worktrees/{lease_id}/extend` | owner | 延长 TTL |

acquire 请求：

```json
{
  "workspace_id": "...",
  "component_id": "...",
  "change_id": "...",
  "task_id": "...",
  "git_identity_id": "...",
  "ttl_seconds": 3600
}
```

acquire 响应：

```json
{
  "lease_id": "...",
  "path": "/data/.../repo",
  "branch_name": "users/qinyi/changes/2026-05-25-xxx/tasks/task-01",
  "expires_at": "2026-05-25T15:00:00Z"
}
```

### 3.6 GC daemon

`backend/app/core/daemons/worktree_gc.py`：

- 每 5 分钟扫描 `worktree_leases WHERE status='locked' AND expires_at < NOW()`
- 标记 expired → `git worktree remove --force <path>` → 删整个目录树（含 home）
- 写审计事件 `WORKTREE_GC`
- 失败重试 3 次，仍失败则告警

### 3.7 共享 bare 仓库

为节省磁盘：每个 component 在 `.repo-bare/` 维护一个 `--bare` clone，所有 worktree 通过 `git worktree add` 共享对象库。首次创建：

```bash
git clone --bare <repo_url> .repo-bare
git worktree add -b <branch_name> ./worktrees/.../repo
```

## 4. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 同一 task 两个 run 申请 lease | 路径不同（含 run_id） |
| AC-02 | 用户 A 不能 release 用户 B 的 lease | 403 |
| AC-03 | 申请时 git_identity 已撤销 | 拒绝 |
| AC-04 | repo bare 仓库首次拉取 | 成功，第二次复用 |
| AC-05 | git config user.name/email 写入 lease 的 gitconfig | 不写全局 |
| AC-06 | askpass.sh 权限 0o700 | Linux 验证；Windows ACL 验证 |
| AC-07 | release 后 askpass / home 被销毁 | 文件不存在 |
| AC-08 | TTL 到期未释放 → GC 清理 | 目录被删，DB status=expired |
| AC-09 | 并发 10 个 acquire 同一 task | 不同 run_id，无冲突 |
| AC-10 | 磁盘满时新 acquire | 返回 503，明确错误 |
| AC-11 | 单测 + 集成测试覆盖率 | ≥ 85% |
| AC-12 | 日志中不出现明文 token | grep 验证 |
| AC-13 | 全程审计事件入库 | WORKTREE_ACQUIRED / RELEASED / GC / FAILED |
| AC-14 | Windows 与 Linux 都通过 | CI 矩阵 |
| AC-15 | spike 01 全部 PASS | 前置依赖 |

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Windows 子进程环境继承 | 凭据串用 | `subprocess.Popen(env={...}, ...)` 显式传完整 env |
| 路径含空格 / 中文 | 命令失败 | 全程引号 + 用 list 传参，禁止 shell=True |
| 子进程僵尸 | 资源泄漏 | 用 `subprocess.Popen` + `wait(timeout)` + kill |
| askpass.sh 被读 | 凭据泄漏 | 写完立刻 chmod 0o700；run 结束 shred |
| GC 误删活跃目录 | 数据丢失 | 双重检查：DB status + 文件 lock file（`.lease.lock`） |
| 多进程同时 GC | 重复删除 | redis SETNX gc lock |
| 主密钥不可用时已注入的 askpass 残留 | 后续可被解密重放 | release 时 shred + 主密钥失效后立即吊销所有 lease |

## 6. 完成定义

- [ ] 15 个 AC 通过
- [ ] spike 01 必须先 PASS
- [ ] 单测 + Linux/Windows 集成测试
- [ ] GC daemon 健康监控接入
- [ ] `verification.md` 追加 task-10 记录
- [ ] PR 合并
