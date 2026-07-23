---
author: qinyi
created_at: 2026-07-23 08:48:54
change: 2026-07-23-rbac-permission-cache
scale: large
---

# rbac 权限缓存 设计文档

> **Design Grill v2 修订(2026-07-23)**:闭合 P0(X1 key 碰撞)+ P1(X3 uuid 反序列化 / X4 失效失败告警)+ P2(X2 漏失效点)。详见 decisions.md D-002@v2 / D-003@v2 / D-005@v1 / D-006@v1。

## 1. 背景

`has_permission`(`backend/app/modules/auth/rbac.py:87`,async)是每个受保护路由的热路径——经 `core/auth_deps.py:108 require_permission()` 依赖,每个受保护接口请求都过它。当前实现三级短路(is_platform_admin → platform perms → workspace perms),未短路时每次发起 2 条 JOIN 查询(user_roles⨝roles⨝role_permissions + user_workspace_roles⨝roles⨝role_permissions),无任何缓存。

同样,PPM 数据范围 `data_scope`(`ppm/common/data_scope.py`)的 `manager_project_ids()`(每个 PPM 列表请求查 PpmProjectMember)、`is_super_admin()` 也是高频热路径,无缓存。

性能审计(W5 / C6-1 / P1)识别:权限检查是全应用最高频 DB 热点之一,应加缓存。

项目 Redis 已是基础设施级服务(`deploy/docker-compose.yml` redis:7-alpine + `backend/pyproject.toml` redis>=5.0 + `backend/app/core/redis.py` async 客户端),无需新基建。已有 auth 缓存范式 `api_key_service.py`(TTL config + try/except 降级回 DB + scan_iter 前缀失效)可直接借鉴。

**核心风险**:权限缓存失效不彻底 = 越权(用户持有过期权限)或权限丢失。这是安全敏感变更,失效逻辑必须绝对可靠。

## 2. 设计目标

- G1:`has_permission` 与 `data_scope` 热路径加 Redis 缓存,显著减少每请求 DB 查询。
- G2:缓存失效绝对安全——任何权限相关变更后缓存立即清空,不出现越权窗口(除 TTL 兜底最长 5min)。
- G3:Redis 故障不影响正确性——降级回查 DB,认证/鉴权永不因缓存层失败。
- G4:改动集中、可测、可维护——统一缓存 helper,显式失效调用。

## 3. 非目标

- N1:不缓存动态 SQL 片段(`data_scope` 的 `task_scope_clause` / `problem_scope_clause` 返回 SQLAlchemy where 表达式,不可序列化;只缓存其依赖的 `manager_project_ids` / `is_super_admin` 底层值)。
- N2:不加本地内存 TTL 二级兜底(D-004:多实例一致性问题得不偿失,Redis 故障直接回退 DB)。
- N3:不改 auth_deps 调用层语义(缓存插入点在 rbac.py / data_scope.py 内部,auth_deps 不动)。
- N4:不做按 user/role 精确失效(D-002@v2:整体清空,简单绝对安全)。
- N5:不引入 cachetools/TTLCache 等新依赖(复用已有 redis 客户端)。

## 4. 总体方案

方案 A(已选):集中式 `permission_cache` 模块 + service 层显式失效。

### 4.1 缓存命名空间与 key 设计

| 命名空间 | key 格式 | value | 写入点(miss 回填) | 读取点 |
|---|---|---|---|---|
| 平台权限集 | `perm:{user_id}:platform` | JSON `set[str]` | collect_permissions_platform | has_permission(所有调用——platform 先于 workspace 判断)、everywhere 并集之一 |
| 全工作区并集 | `perm:{user_id}:all` | JSON `set[str]` | collect_permissions_all | has_permission(workspace_id=None 的 all 判断)、everywhere 并集之一 |
| 单工作区权限集 | `perm:{user_id}:{workspace_id}` | JSON `set[str]` | collect_permissions | has_permission(workspace_id 分支) |
| PPM 数据范围 | `ppm-scope:{user_id}` | JSON `{manager_project_ids:[uuid-str...], is_super_admin:bool}` | manager_project_ids / is_super_admin | manager_project_ids、is_super_admin、task/problem_scope_clause(间接) |

> **D-003@v2(闭合 P0/X1)**:`collect_permissions_everywhere`(`/api/auth/me` 用)= platform ∪ all,读 `perm:{u}:platform` + `perm:{u}:all` 内存并集,**不单独存**。v1 曾把 platform / all / everywhere 塞进同一 `perm:{user_id}`,三者语义不同(rbac.py:37-84 实证)会互相覆盖污染——已拆键修正。

注:has_permission 第一级短路(`is_platform_admin` 读 user 对象字段)不缓存——对象已在请求内存。

### 4.2 缓存读写(降级范式,抄 api_key_service)

所有读写包 try/except,Redis 任何故障 → `get` 返回 None(miss,调用方回退查 DB)、`set`/`delete` 静默吞错(log warning)。**认证/鉴权永不因缓存层失败。**

> **D-002@v2 例外(闭合 P1/X4)**:`invalidate_all_permissions` 失败升 **ERROR 级日志**(structlog + 可监控告警),非 warning——失效失败是安全事件,可能留下最长 TTL 的越权窗口。读/写业务缓存的故障仍降级静默(不影响请求),只有失效失败必须告警。

### 4.3 失效策略(D-002@v2 整体清空)

`invalidate_all_permissions()` 用 `scan_iter` 扫 `perm:*` + `ppm-scope:*` 全部删除(量大时改 pipeline 批量 delete / UNLINK)。所有权限写 service 在 commit 后调用:

- 角色定义:`admin/roles_service.py` — create / update(RolePermission 删插、is_active 翻转)/ disable / enable / delete
- 用户平台角色:`admin/users_service.py` — create / update_user(_rewrite_roles、is_platform_admin 翻转)/ delete_user
- 工作区成员:`workspace/members_service.py` — add_or_update_member / update_member_role / remove_member / transfer_ownership
- **工作区创建(D-006@v1,闭合 P2/X2)**:`workspace/service.py` `WorkspaceService.create`(`_ensure_creator_as_owner` 授创建者 owner,写 UserWorkspaceRole)
- 项目成员:`ppm/project/service.py` `ProjectMemberService` — create / update / delete
- **启动 bootstrap 种子**(auth/service.py `seed_workspace_owner_roles` / `seed_platform_admin_role`):启动期缓存冷,**免失效**(进程刚起无缓存)

整体清空虽牺牲精确性,但角色/成员变更是低频管理操作,清空后短暂冷缓存可接受;且绝对杜绝"漏失效某 user → 越权"。

### 4.4 TTL 兜底

`permission_cache_ttl` 默认 300s(5min)。TTL 兜底覆盖两类漏失效:① 失效调用点遗漏;② invalidate 自身因 Redis 抖动失败(D-002@v2)。最长越权窗口 = TTL = 5min,作为失效逻辑的双重安全网。

## 5. 文件变更清单

| 文件 | 改动 | Phase |
|---|---|---|
| `backend/app/core/permission_cache.py` | **新建**:get/set_cached_permissions(platform/all/workspace 三键)、get/set_cached_ppm_scope(uuid 反序列化)、invalidate_all_permissions(失败升 ERROR) | P1 |
| `backend/app/core/config.py` | 新增 `permission_cache_ttl`(默认 300) | P5 |
| `backend/app/modules/auth/rbac.py` | collect_permissions_platform / _all / _workspace 入口查缓存、miss 查库+回填;everywhere 读 platform+all 内存并集 | P2 |
| `backend/app/modules/ppm/common/data_scope.py` | manager_project_ids / is_super_admin 查 ppm-scope 缓存、miss 查库+回填 | P3 |
| `backend/app/modules/admin/roles_service.py` | create/update/disable/enable/delete 后调 invalidate_all_permissions | P4 |
| `backend/app/modules/admin/users_service.py` | create/update_user/delete_user 后调 invalidate_all_permissions | P4 |
| `backend/app/modules/workspace/members_service.py` | add_or_update_member/update_member_role/remove_member/transfer_ownership 后调 invalidate_all_permissions | P4 |
| `backend/app/modules/workspace/service.py` | WorkspaceService.create(_ensure_creator_as_owner)后调 invalidate_all_permissions(D-006@v1) | P4 |
| `backend/app/modules/ppm/project/service.py` | ProjectMemberService.create/update/delete 后调 invalidate_all_permissions | P4 |
| 测试:auth/tests、workspace/tests、admin、ppm | 缓存读写+降级单测、每失效点清空安全测试、ppm-scope uuid 反序列化类型测试、无 Redis 回退正确性 | P6 |

## 6. 接口定义

### `permission_cache.py`(public API)

```python
async def get_cached_permissions(
    user_id: uuid.UUID, *, scope: str, workspace_id: uuid.UUID | None = None
) -> set[str] | None:
    """返回缓存的权限集合;miss 或 Redis 故障返回 None(调用方回退查 DB)。
    scope ∈ {'platform','all','workspace'};workspace 仅 scope='workspace' 时必填。"""

async def set_cached_permissions(
    user_id: uuid.UUID, perms: set[str], *, scope: str, workspace_id: uuid.UUID | None = None
) -> None:
    """回填权限集合;Redis 故障静默吞错。"""

async def get_cached_ppm_scope(user_id: uuid.UUID) -> dict | None:
    """返回 {manager_project_ids: set[uuid.UUID], is_super_admin: bool};miss 返回 None。

    **D-005@v1 反序列化保证类型**:manager_project_ids 必须还原为 set[uuid.UUID]
    (JSON 只能存 str),否则 data_scope.problem_operable 的 `project_id in manager_pids`
    (uuid in set[str])恒 False,经理编辑/删除问题静默失效(Design Grill X3)。"""

async def set_cached_ppm_scope(user_id: uuid.UUID, scope: dict) -> None: ...

async def invalidate_all_permissions() -> None:
    """清空 perm:* + ppm-scope:* 全部 key。所有权限写 service commit 后调用。
    失败升 ERROR 级日志(D-002@v2),不静默——失效失败是安全事件。"""
```

### rbac.py / data_scope.py 内部接入(不改 public 签名)

`collect_permissions_platform` / `_all` / `_workspace` / `manager_project_ids` / `is_super_admin` 签名不变,内部加"查缓存 → miss 查库 → 回填"逻辑;`collect_permissions_everywhere` 改为读 platform + all 两键内存并集(不查库、不单独缓存)。

## 7. 风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| 失效漏调某 service → 越权窗口 | 高 | D-002@v2 整体清空(含 WorkspaceService.create)+ TTL 300s 兜底 + 每失效点安全测试;Code review 核对所有权限写路径(grep UserWorkspaceRole/UserRole/PpmProjectMember 写点) |
| invalidate 自身失败(Redis 抖动)→ 旧权限残留 | 高 | D-002@v2 失效失败升 ERROR 级日志(监控告警)+ TTL 300s 兜底最长窗口 |
| 缓存 key 碰撞污染(platform/all/everywhere) | 高 | D-003@v2 拆键(platform/all/workspace 分离,everywhere 内存并集不存) |
| ppm-scope uuid 反序列化类型错误 → 经理权限静默失效 | 高 | D-005@v1 get_cached_ppm_scope 强制还原 set[uuid.UUID] + 类型断言测试 |
| Redis 故障 | 中 | try/except 降级回 DB(D-004),认证永不失败;沿用 api_key_service 范式 |
| data_scope 缓存与 has_permission 缓存不一致 | 中 | 两者独立命名空间(ppm-scope:* vs perm:*),invalidate_all 同时清两者 |
| 测试环境无 Redis | 低 | 降级回 DB 路径即正确行为;测试覆盖无 Redis 场景 |
| scan_iter 全命名空间扫描性能 | 低 | 本项目规模可接受;key 量增长后改 pipeline/UNLINK |

## 8. 决策引用

见 `decisions.md`:D-001(缓存范围)、**D-002@v2**(整体清空 + 失效失败告警,supersedes v1)、**D-003@v2**(拆键 platform/all/workspace,supersedes v1)、D-004(降级回 DB)、**D-005@v1**(ppm-scope uuid 反序列化类型)、**D-006@v1**(WorkspaceService.create 失效点)。
