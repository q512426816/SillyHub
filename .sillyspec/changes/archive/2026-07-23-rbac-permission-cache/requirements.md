---
author: qinyi
created_at: 2026-07-23 09:10:29
change: 2026-07-23-rbac-permission-cache
---

# 需求规范(Requirements)

## 功能需求

- **FR-01 缓存 helper**(`permission_cache.py`):`get/set_cached_permissions`(scope=platform|all|workspace)、`get/set_cached_ppm_scope`(manager_project_ids 反序列化为 `set[uuid.UUID]`、is_super_admin 为 bool)、`invalidate_all_permissions`。业务读写 try/except 降级,Redis 故障 get 返回 None。关联 D-004(降级)、D-005@v1(uuid 反序列化)。
- **FR-02 rbac 缓存接入**:`collect_permissions_platform` / `_all` / `_workspace` 入口查缓存、miss 查库+回填;`everywhere` 读 platform+all 内存并集不存。关联 D-003@v2(三键)。
- **FR-03 data_scope 缓存接入**:`manager_project_ids` / `is_super_admin` 查 ppm-scope 缓存、miss 查库+回填。关联 D-005@v1。
- **FR-04 失效触发**:以下 service 的 create/update/delete/状态翻转 commit 后调 `invalidate_all_permissions`——`admin/roles_service`(create/update/disable/enable/delete)、`admin/users_service`(create/update_user 含 _rewrite_roles+is_platform_admin 翻转/delete_user)、`workspace/members_service`(add_or_update_member/update_member_role/remove_member/transfer_ownership)、`workspace/service.WorkspaceService.create`(_ensure_creator_as_owner)、`ppm/project/service.ProjectMemberService`(create/update/delete)。关联 D-002@v2、D-006@v1。
- **FR-04a 失效可靠性**:`invalidate_all_permissions` 失败升 **ERROR 级日志**(可监控告警),不阻断业务 commit。关联 D-002@v2。
- **FR-05 配置**:`permission_cache_ttl` 默认 300s。
- **FR-06 测试**:缓存读写+降级单测;每失效点"改完即清空"安全测试;ppm-scope uuid 反序列化类型断言测试;无 Redis 环境回退查库正确性测试。

## 决策引用(全部当前版本 D-xxx@vN)

- D-001@v1:缓存范围 = has_permission + data_scope → FR-02/03/04
- D-002@v2:整体清空 + 失效失败 ERROR 告警 → FR-04/04a
- D-003@v2:拆键 platform/all/workspace + everywhere 并集 → FR-01/02
- D-004@v1:无 Redis 降级回 DB → FR-01
- D-005@v1:ppm-scope uuid 反序列化类型 → FR-01/03
- D-006@v1:WorkspaceService.create 失效点 → FR-04

**无未覆盖的当前版本决策(无剩余风险)。**

## 验收标准

- AC-01:受保护路由权限检查命中缓存时不再打 DB JOIN(除 miss/失效后首次)。
- AC-02:任一 FR-04 失效触发点执行后,`perm:*` + `ppm-scope:*` 全部清空(安全测试验证)。
- AC-03:Redis 故障(或测试环境无 Redis)时,权限检查回退查 DB,结果与无缓存一致。
- AC-04:ppm-scope 缓存反序列化后 manager_project_ids 元素类型为 `uuid.UUID`(类型断言)。
- AC-05:经理(部门/项目/开发/业务经理)经 `problem_operable` 的编辑/删除权限在缓存启用后仍正确。
