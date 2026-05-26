---
id: task-09
title: 实现 Git Identity Manager
phase: V1/V2
priority: P0
status: draft
owner: qinyi
estimated_hours: 24
affected_components:
  - platform-api
  - platform-web
allowed_paths:
  - backend/app/modules/git_identity/
  - backend/app/core/crypto.py
  - backend/migrations/versions/
  - frontend/src/app/(dashboard)/settings/git-identities/
depends_on:
  - task-01
  - task-02
blocks:
  - task-10
  - task-11
  - task-12
---

## 1. 目标

实现 Git Identity 的绑定、加密保存、撤销、过期、权限验证全流程。**这是平台多人 Git 隔离的基础。**

**不在范围**：

- Worktree 隔离（task-10）
- Git Tool Gateway 命令拦截（task-11）

## 2. 输入

- `requirements.md` FR-007
- `references/04-git-identity-and-worktree-isolation.md`
- `references/15-authentication.md` §7
- `references/17-db-schema.md` §2.5 `git_identities`

## 3. 产出清单

### 3.1 凭据加密设计

```text
主密钥（KEK）：32 字节随机，从环境变量 SILLYSPEC_MASTER_KEY 注入
             启动时校验长度；缺失则后端拒绝启动
             支持 key_id 版本（v1, v2 ...），存到每条 git_identity 记录
DEK：每条凭据独立 32 字节随机数据加密密钥（信封加密，可选）
算法：libsodium secretbox (xchacha20-poly1305)，PyNaCl 实现
解密：仅在 Git 操作即时调用，不缓存解密结果
```

实现：

```python
# backend/app/core/crypto.py
from nacl import secret, utils

class CredentialCipher:
    def __init__(self, master_key: bytes, key_id: str):
        assert len(master_key) == 32
        self.box = secret.SecretBox(master_key)
        self.key_id = key_id

    def encrypt(self, plain: str) -> tuple[bytes, str]:
        nonce = utils.random(secret.SecretBox.NONCE_SIZE)
        ct = self.box.encrypt(plain.encode(), nonce)
        return ct, self.key_id

    def decrypt(self, ct: bytes, key_id: str) -> str:
        if key_id != self.key_id:
            raise CipherKeyMismatch(key_id)
        return self.box.decrypt(ct).decode()
```

主密钥轮换：保留旧 key_id 的 cipher 实例，新增凭据用新 key_id，老凭据访问时按 key_id 路由 cipher。

### 3.2 数据表

按 17-db-schema.md §2.5 `git_identities`。

### 3.3 后端模块

```text
backend/app/modules/git_identity/
├─ __init__.py
├─ router.py
├─ service.py
├─ providers/
│  ├─ base.py
│  ├─ github.py
│  ├─ gitlab.py
│  ├─ gitea.py
│  └─ generic.py
├─ schema.py
├─ model.py
└─ tests/
   ├─ test_crypto.py
   ├─ test_service.py
   └─ test_providers.py
```

### 3.4 API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/git/identities` | 自己的或 `platform:admin` | 列出当前用户的 identity |
| POST | `/api/git/identities` | 登录即可 | 创建（PAT / SSH key / OAuth callback） |
| GET | `/api/git/identities/{id}` | owner / admin | 详情（不返回明文凭据） |
| DELETE | `/api/git/identities/{id}` | owner / admin | 撤销 |
| POST | `/api/git/check-access` | 登录 | 给定 repo_url + identity_id，验证是否能访问 |

创建请求体：

```json
{
  "provider": "github",
  "credential_type": "pat",
  "git_username": "qinyi",
  "git_email": "qinyi@example.com",
  "credential": "ghp_xxx",                  // 明文，仅入参，立即加密
  "allowed_repositories": ["org/repo-a", "org/repo-b"],
  "expires_at": "2026-12-31T00:00:00Z"
}
```

返回不含 `credential` 明文，仅返回 metadata。

### 3.5 OAuth 流程（GitHub / GitLab）

```text
1. 前端按钮 → GET /api/git/identities/oauth/{provider}/start
2. 后端生成 state 写入 redis，重定向到 provider
3. provider 回调 → /api/git/identities/oauth/{provider}/callback
4. 后端验证 state、用 code 换 access_token、加密入库
5. 重定向回前端 settings 页
```

V1 可只实现 PAT，OAuth 留 V2。

### 3.6 check-access 实现

```python
async def check_access(identity: GitIdentity, repo_url: str) -> AccessResult:
    """非破坏性检测：ls-remote --heads <repo_url>"""
    ...
```

执行 `git ls-remote --heads <repo>` 必须在临时 HOME 下执行（详见 task-10），但本 task 可先用 subprocess + env 注入实现简化版。

### 3.7 前端页面

`frontend/src/app/(dashboard)/settings/git-identities/page.tsx`：

- 表格列：provider / username / email / 类型 / allowed_repos / 状态 / 过期时间 / 操作
- "添加 Identity" 按钮 → 表单 / OAuth 跳转
- 测试访问按钮 → 输入 repo_url → 调 `/check-access`
- 状态：active / revoked / expired
- 删除按钮 → 二次确认

## 4. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 主密钥缺失时启动 | 后端拒绝启动，日志清晰提示 |
| AC-02 | 创建 PAT identity | DB 存的是密文，明文不出现在日志 |
| AC-03 | 解密后能正确还原 PAT | 单元测试 |
| AC-04 | key_id 不匹配 | 抛 CipherKeyMismatch |
| AC-05 | 列表 API 不返回明文凭据 | 任何 endpoint 都不暴露 |
| AC-06 | 用户 A 不能看到用户 B 的 identity | 权限隔离 |
| AC-07 | check-access GitHub PAT 正确 | 返回 `accessible=true` |
| AC-08 | check-access 错误 PAT | 返回 `accessible=false` + `reason='auth_failed'` |
| AC-09 | 过期 identity 自动标 expired | daemon 或查询时检查 |
| AC-10 | 撤销后再用该 identity 调用 | 拒绝（即便 token 本身还有效） |
| AC-11 | 主密钥轮换：保留 key v1，添加 v2 | 老凭据仍能解密 |
| AC-12 | 单测覆盖率 | ≥ 85% |
| AC-13 | 删除 user 时 identity 级联软删除 | DB 状态正确 |
| AC-14 | 全程审计事件 | AUTH_* + git_identity 相关事件 |
| AC-15 | 前端不展示明文 token | 编辑表单也不回填 token |

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 主密钥泄露 | 所有凭据被破解 | 主密钥仅环境变量；docker secret；不入备份 |
| token 日志泄露 | 凭据外泄 | logging filter 检测疑似 token（`ghp_xxxxx`、`glpat-xxxx`），自动 `[REDACTED]` |
| 用户绑定他人 token | 越权 | check-access 校验 username 与 token 实际用户一致 |
| OAuth state 重放 | CSRF | state 用 redis TTL=5min，单次使用 |
| PAT 写入 .git/config | 凭据泄漏 | 强制走 GIT_ASKPASS，禁止 URL 内含 token |
| Windows 子进程环境继承 | 凭据串用 | 强制 `env={...}`，不继承父进程 |

## 6. 完成定义

- [ ] 15 个 AC 通过
- [ ] 单测 + 集成测试（用真实 GitHub PAT 跑一遍）
- [ ] `verification.md` 追加 task-09 记录
- [ ] **关联完成 spike 01（Git 凭据隔离）**
- [ ] PR 合并
