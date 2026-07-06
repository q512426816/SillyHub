---
author: WhaleFall
created_at: 2026-07-03T13:45:00
change: 2026-07-02-daemon-filesystem-policy
purpose: e2e-regression-steps
---

# E2E 真机回归步骤（design §13 全 14 条 + 兼容）

> 用户手动跑。跑完后把结果（deny 文案 / 审计页记录 / daemon log POLICY_UPDATE）补到 `verify-result.md` Runtime Evidence，重判 PASS → archive。

## 前置：修 admin 凭证（当前 login 401，DB 密码不匹配 env `admin123`）

容器内重置 admin 密码为 `admin123`：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend python -c "
from app.core.security import pwd_context
from sqlalchemy import text
from app.core.db import engine
h = pwd_context.hash('admin123')
with engine.begin() as c:
    r = c.execute(text(\"UPDATE users SET password_hash=:h, is_active=true WHERE email='admin@sillyhub.local'\"), {'h': h})
    print('reset rows:', r.rowcount)
"
```

> 若 `pwd_context` import 失败，改用 `from passlib.context import CryptContext; pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')`（backend `app/core/security.py:53-62` 用同 scheme）。

## 步骤 1：启动 daemon（新代码，含 PolicyEngine）

```bash
node sillyhub-daemon/build/bundle/sillyhub-daemon.js start
sleep 5
node sillyhub-daemon/build/bundle/sillyhub-daemon.js status   # State: running
tail -10 ~/.sillyhub/daemon/daemon.log                         # 看 registered + ws_client_created + allowed_roots_synced
```

## 步骤 2：登录 + 配 claude runtime allowed_roots（触发 WS POLICY_UPDATE）

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend python -c "
import httpx
t = httpx.post('http://localhost:8000/api/auth/login', json={'account':'admin@sillyhub.local','password':'admin123'}).json()['access_token']
h = {'Authorization': f'Bearer {t}'}
rt = httpx.get('http://localhost:8000/api/daemon/runtimes', headers=h).json()
items = rt if isinstance(rt, list) else rt.get('items', [])
claude = [x for x in items if x.get('provider') == 'claude' and x.get('status') == 'online']
rid = claude[0]['id'] if claude else None
print('claude runtime:', rid)
# 只允许 F:/WorkNew/SillyHub
r = httpx.put(f'http://localhost:8000/api/daemon/runtimes/{rid}/allowed-roots', headers=h, json={'allowed_roots':['F:/WorkNew/SillyHub']})
print('PUT allowed_roots:', r.status_code, r.text[:120])
"
# 宿主看 daemon 是否收到 WS POLICY_UPDATE（sub-second）
sleep 2
tail -5 ~/.sillyhub/daemon/daemon.log | grep -iE 'policy_update|policy_cache_set'
```

**验证 §13 #2**：daemon log 出现 `[daemon.policy_cache_set]` 或 POLICY_UPDATE 处理（WS sub-second 热更新生效）。

## 步骤 3：创建 claude interactive session

前端：浏览器开 `http://127.0.0.1:3000/runtimes` → 选 claude runtime → 创建 interactive session。

或 API（需 workspace_id）：
```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend python -c "
import httpx
t = httpx.post('http://localhost:8000/api/auth/login', json={'account':'admin@sillyhub.local','password':'admin123'}).json()['access_token']
h = {'Authorization': f'Bearer {t}'}
# 取 workspace + runtime
ws = httpx.get('http://localhost:8000/api/workspaces', headers=h).json()
print('workspaces:', [(w['id'], w.get('name')) for w in (ws if isinstance(ws,list) else ws.get('items',[]))])
rt = httpx.get('http://localhost:8000/api/daemon/runtimes', headers=h).json()
items = rt if isinstance(rt,list) else rt.get('items',[])
print('runtimes:', [(x['id'], x['provider']) for x in items])
"
# 然后用 frontend session 面板创建（交互式，需 claude CLI + token）
```

## 步骤 4：session 跑写越界（验证 §13 #4 #5 #6 #7 #8）

在 claude session 里 prompt：
- **Write 越界**（#4）：`请在 E:/evil.txt 写入 "test"` → 期望 deny + 中文文案
- **Bash 重定向**（#5）：`执行 echo test > E:/a.txt` → 期望 deny
- **PowerShell**（#6）：`用 PowerShell Set-Content 写 E:/a.txt` → 期望 deny
- **CMD**（#7）：`用 cmd 执行 mkdir E:/evil_dir` → 期望 deny
- **Copy/Move**（#8）：`把 F:/WorkNew/SillyHub/x 复制到 E:/` → 期望 deny

**期望 deny 文案**（task-05 PolicyEngine 统一）：
```
Runtime Policy 拒绝本次写入。
Agent：claude
目标路径：e:\evil.txt
原因：目标目录未配置为可写目录。
```

**验证白名单内 allow**：`请在 F:/WorkNew/SillyHub/test.txt 写入 "ok"` → 期望成功（allow + 记 audit ALLOW）。

## 步骤 5：查审计页（验证 §13 #12）

前端：`http://127.0.0.1:3000/runtimes/{rid}/audit?wid={wid}`（从 runtimes 页点「审计日志」入口）。

或 API：
```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend python -c "
import httpx
t = httpx.post('http://localhost:8000/api/auth/login', json={'account':'admin@sillyhub.local','password':'admin123'}).json()['access_token']
h = {'Authorization': f'Bearer {t}'}
# 替换 WID/RID
r = httpx.get('http://localhost:8000/api/daemon/workspaces/WID/runtimes/RID/policy-audit', headers=h, params={'limit':20})
print(r.status_code, r.text[:500])
"
```

**验证**：看到 DENY 记录（E:/evil.txt / E:/a.txt，reason 中文，provider=claude，tool=Write/Bash/PowerShell/CMD）+ ALLOW 记录（F:/WorkNew/SillyHub/test.txt）。支持筛选 decision/provider/tool/path + 分页。

## 步骤 6：路径规范化（验证 §13 #11）

session prompt：
- `..` 穿越：`写 F:/WorkNew/SillyHub/../../evil.txt` → 期望 deny（路径折叠后被 realpath 解析到越界）
- UNC：`写 \\server\share\evil.txt` → 期望 deny（UNC 拒）
- symlink（Windows mklink）：创建 symlink 指向 E:/，写 symlink → 期望 deny（realpath 解析）

## 步骤 7：Codex batch 带内审批（验证 §13 #9，可选）

配 codex runtime allowed_roots，跑 codex batch 任务写越界，期望 decline + 中文理由（task-17 _handleApprovalDecision）。

## 步骤 8：兼容互连（验证 §13 #14 #15，可选）

- **#14 旧 daemon 新 backend**：用旧 daemon bundle（git stash/f0d58ea6 版本）连当前 backend → 心跳同步 allowed_roots 生效（task-12 兼容）。
- **#15 新 daemon 旧 backend**：新 daemon 连无 POLICY_UPDATE 的旧 backend → 心跳 15s 兜底 reloadAll。

## 步骤 9：list_dir 读自由（验证 §13 #13）

前端 runtimes 页浏览目录（list_dir RPC）→ 任意目录可读（canRead 全 allow，不 audit，行为不变）。

---

## 跑完后

把每步结果（deny 文案截图/日志 + 审计页记录 + daemon log POLICY_UPDATE）补到 `verify-result.md` 的 Runtime Evidence（将 ⏳ 项改为 ✅ + 证据）。全部 ✅ 后，verify 结论改 PASS，运行 `sillyspec run archive 2026-07-02-daemon-filesystem-policy` 归档。

## 已自动验证（无需重跑）

- 部署：backend/frontend healthy + commit_sha a54f9a52 + migration policy_audit_log 真实 PG + 审计页路由 200。
- daemon 侧：注册 2 runtime + ws_client_created + allowed_roots_synced 心跳同步 PolicyCache（task-12 真机）。
- 单测：daemon 1641 / backend 400 / frontend 561 passed。
