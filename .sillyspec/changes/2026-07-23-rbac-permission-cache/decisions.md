---
author: qinyi
created_at: 2026-07-23 08:48:54
change: 2026-07-23-rbac-permission-cache
---

# 决策台账 — rbac 权限缓存

## D-001@v1: 缓存范围 = has_permission + data_scope 一并覆盖
- type: boundary
- status: accepted
- source: user
- question: 本次权限缓存覆盖哪些热路径?
- answer: 同时覆盖 has_permission(collect_permissions* 集合)与 data_scope(manager_project_ids / is_super_admin)。两套都是高频热路径,一并做避免二次返工。
- normalized_requirement: 缓存必须覆盖 collect_permissions* 与 manager_project_ids/is_super_admin;task/problem_scope_clause 不直接缓存(基于底层缓存值构建)。
- impacts: [P2, P3, P4-ppm]
- evidence: 用户轮次"连 PPM 列表一起";rbac.py:87;data_scope.py manager_project_ids/is_super_admin
- priority: high

## D-002@v2: 失效策略 = 整体清空 + 失效失败 ERROR 告警(supersedes D-002@v1)
- type: architecture
- status: accepted
- supersedes: D-002@v1
- source: user + Design Grill X4
- question: 角色/成员变更时缓存如何失效?失效调用自身失败怎么办?
- answer: 所有权限变更触发点统一执行 invalidate_all_permissions 清空 perm:* + ppm-scope:* 全部(继承 v1)。v2 增补:invalidate 失败升 **ERROR 级日志**(可监控告警),非 warning——失效失败是安全事件,可能留下最长 TTL 的越权窗口;读/写业务缓存故障仍降级静默(不影响请求)。
- normalized_requirement: 任一权限写 service(Role/RolePermission/UserRole/is_platform_admin/UserWorkspaceRole/PpmProjectMember 的 create/update/delete)commit 后必须调 invalidate_all_permissions;invalidate 抛错时 log.error(含触发点上下文),不向上抛(不阻断业务 commit)。
- impacts: [P1 失败告警, P4, 风险登记-invalidate失败, P6-安全测试]
- evidence: Design Grill X4;api_key_service.py:298-312 静默吞错为反面;structlog ERROR 级
- priority: high

## D-003@v2: 缓存粒度 = 拆键 platform/all/workspace + everywhere 内存并集(supersedes D-003@v1)
- type: architecture
- status: accepted
- supersedes: D-003@v1
- source: code + Design Grill X1
- question: 缓存 key 怎么设计?collect_permissions_platform / _all / _everywhere 能否共用一个 key?
- answer: **不能共用**(v1 错误)。三者返回语义不同的集合(rbac.py:37-84 实证):platform=平台级、all=全工作区并集、everywhere=platform∪all。v2 拆为三键:`perm:{u}:platform`、`perm:{u}:all`、`perm:{u}:{workspace_id}`;everywhere 读 platform+all 内存并集,**不单独存**。has_permission 在所有调用先判 platform,workspace_id=None 时再判 all,workspace_id 指定时判单工作区键。
- normalized_requirement: 缓存 value 为 set[str];三键分离;collect_permissions_everywhere 签名不变但内部改读两键并集(不查 DB);get/set_cached_permissions 接 scope ∈ {platform,all,workspace} 参数。
- impacts: [P1 key 设计, P2 rbac 接入, 风险登记-key碰撞]
- evidence: Design Grill X1;rbac.py collect_permissions_platform(49)/_all(37)/_everywhere(75)
- priority: high

## D-004@v1: 无 Redis 降级 = 回退查 DB(不加本地兜底)
- type: architecture
- status: accepted
- source: code
- question: Redis 不可用时怎么办?
- answer: 沿用 api_key_service 约定,Redis 故障 try/except 回退查 DB,不加本地内存 TTL 兜底。保证正确性优先;本地兜底引入多实例一致性问题,得不偿失。
- normalized_requirement: 业务缓存读写 try/except;Redis 故障 get 返回 None(miss)、set/delete 静默吞错;不引入 cachetools/TTLCache 等本地缓存依赖。(注:invalidate 失败按 D-002@v2 升 ERROR,不在此列)
- impacts: [P1, 风险登记-Redis故障, P6-无Redis测试]
- evidence: api_key_service.py 缓存读写降级范式;core/redis.py get_redis
- priority: high

## D-005@v1: ppm-scope uuid 反序列化保证类型
- type: architecture
- status: accepted
- source: Design Grill X3
- question: ppm-scope 缓存的 manager_project_ids(uuid 列表)经 JSON 往返变 str,下游怎么办?
- answer: JSON 只能存 str,但 data_scope 下游用 uuid 做判断(`problem_operable` 的 `project_id in manager_pids`,project_id 是 uuid)。get_cached_ppm_scope 反序列化时必须把 manager_project_ids 还原为 `set[uuid.UUID(...)]`,is_super_admin 还原为 `bool`。否则 uuid-in-set[str] 恒 False,经理编辑/删除问题静默失效。
- normalized_requirement: get_cached_ppm_scope 返回 dict 中 manager_project_ids: set[uuid.UUID]、is_super_admin: bool;P6 加类型断言测试(反序列化后元素类型为 uuid.UUID)。
- impacts: [P1 permission_cache, P3 data_scope, P6-类型测试, 风险登记-uuid反序列化]
- evidence: Design Grill X3;data_scope.py:148 problem_operable `in` 判断;:55/70 返回 set[uuid.UUID]
- priority: high

## D-006@v1: WorkspaceService.create 失效点补全
- type: boundary
- status: accepted
- source: Design Grill X2
- question: 创建工作区时 _ensure_creator_as_owner 授予 owner(写 UserWorkspaceRole),是否在失效清单?
- answer: 补入。`_ensure_creator_as_owner`(`workspace/service.py:729`,line 770 写 UserWorkspaceRole 授 owner)的**所有调用方**——`create`(`:148/165/222`)与 `scan_generate`(`:609`,daemon-client 建工作区独立路径,`:669` 调用,不经 create)——commit 后都需调 invalidate_all_permissions,创建者的 all/everywhere 缓存才及时失效(否则最长 TTL 内缺新 ws 权限——权限缺失方向,非越权,但仍是错误)。plan-review 发现 scan_generate 遗漏(Design Grill X2 当时未穷尽 `_ensure_creator_as_owner` 调用方,属误判闭合,现补)。bootstrap 启动种子(auth/service.py seed_*)免失效(进程冷启无缓存)。
- normalized_requirement: WorkspaceService.create commit 后调 invalidate_all_permissions;auth/service.py 启动种子路径文档注明免失效(不调)。
- impacts: [P4-workspace create, 风险登记-失效漏调]
- evidence: Design Grill X2;workspace/service.py:770 _ensure_creator_as_owner、:121 create;auth/service.py:427/502 seed
- priority: medium
