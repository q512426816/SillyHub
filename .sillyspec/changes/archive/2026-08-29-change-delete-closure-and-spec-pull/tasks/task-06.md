---
id: task-06
title: 'soft_delete_change_dir + DELETE /changes/{cid}（组合权限）+ 服务顺序 + 审计 + 权限矩阵测试'
title_zh: 'soft_delete_change_dir + DELETE /changes/{cid}（组合权限）+ 服务顺序 + 审计 + 权限矩阵测试'
author: 'qinyi'
created_at: 2026-08-29 12:57:58
priority: P0
depends_on: ['task-02', 'task-04']
blocks: ['task-07']
requirement_ids: [FR-05a, FR-05b, FR-05c]
decision_ids: [D-001@v1, D-002@v1]
provides:
  - contract: 'DELETE /api/workspaces/{workspace_id}/changes/{change_id}'
    fields: ['ChangeDeleteResponse {ok, backup_dir, file_count}；无权限 403、不存在 404、已删幂等 409']
expects_from:
  task-02:
    - contract: platform_deleted 拦截基建
      needs: ['spec_file_manifest.platform_deleted 列 + apply_ops/_write_spec_root 拦截已落；本任务只写标记，不重复实现拦截']
  task-04:
    - contract: CLI 墓碑写路径处理器
      needs: ['progress 上行 status=deleted 处理器已存在（仅置 location=deleted）；本任务在其后接线 soft_delete_change_dir（platform_sync/service.py 最小侵入一处调用）']
allowed_paths:
  - backend/app/modules/change/router.py
  - backend/app/modules/change/service.py
  - backend/app/modules/change/schema.py
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/change/tests/test_delete_change.py
  - backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py
goal: >
  落地平台删除入口后端（design §6）：DELETE /api/workspaces/{ws}/changes/{cid} 组合权限
  （CHANGE_ARCHIVE 或 change.owner_id==当前用户，owner 空仅前者）+ 服务顺序
  soft_delete_change_dir 镜像软删 → 删 progress 行 → location='deleted' → change_events
  审计，加 enrich 对 deleted 行前置过滤、承接 task-04 CLI 墓碑写路径的镜像软删接线，
  使已删变更三 tab 不显示且四条复活通道全部失效（FR-05a/b/c，D-001@v1/D-002@v1）。
implementation:
  - 'change/schema.py：新增 ChangeDeleteResponse（ok: bool / backup_dir: str / file_count: int，design §11 契约）；location 在 DTO 是自由 str（schema.py:78、:115）不改 ChangeRead/ChangeSummary（last_pushed_at 归 task-11，不混入）'
  - 'spec_workspace/service.py 新增 soft_delete_change_dir(workspace_id, change_key)：按 change.location 选镜像前缀（active→changes/{key}/、archive→changes/archive/{name}/，归档区行同样可删）；manifest 前缀枚举现存文件（exists=True，前缀查询须转义 LIKE 通配 %/_——变更名含下划线常见，或取回 workspace manifest 行 Python startswith 过滤），逐文件 asyncio.to_thread(_move_op_file)（:1187）移 backup_root/{BACKUP_TS_FORMAT 时间戳}/<rel>（_backup_root :1141），manifest 置 exists=False、version+1、platform_deleted=True（base_version 直读 manifest 现值，零 409 冲突），目录空后自底向上 rmdir（照 _converge_stale_files :1252-1261 清理范式，仅触碰该目录不整树扫描），末尾 _prune_spec_backups（:1266）；返回 {backup_dir, file_count}；零文件幂等返回 file_count=0'
  - 'change/service.py 新增 ChangeService.delete_change(workspace_id, change_id, actor)：取行不存在 404；行已 location=deleted 幂等拒绝（409 code=change_deleted，与 task-04 拒收口径一致）；顺序执行 ① soft_delete_change_dir ② 删 platform_change_progress 对应 (workspace_id, change_name) 行 ③ Change.location=deleted 软删不物理删（ChangeEventORM FK CASCADE 会丢审计，model.py:346-402）④ 写 change_events event_type=delete、detail={deleted_by, change_key, file_count, backup_dir}（照 platform_sync/service.py:335-404 _sync_change_owner 的 begin_nested savepoint 范式）；commit 后组装 ChangeDeleteResponse'
  - 'change/router.py 注册 DELETE /changes/{change_id}：组合权限 = 先取 Change 行判 owner_id==当前用户，非 owner 再 has_permission(Permission.CHANGE_ARCHIVE)（permissions.py:76；workspace_owner 角色已内置、platform_admin 短路，现零端点引用）——require_permission 依赖工厂（auth_deps.py:108-132）不支持行级 OR，实现为端点内组合校验，permission 用法照 members_router.py:208 先例；不过判 PermissionDenied 403'
  - 'enrich 前置过滤（change/service.py 同文件顺带落，plan 任务表口径）：enrich_summaries（:1581-1628）与 enrich_with_workspace_ids 的投影覆盖对 location=deleted 行跳过——latest_progress 终态覆盖（archived 回翻）与 stage_info 覆盖不再作用于 deleted 行（CLI 墓碑路径置 location 后读侧不被旧 progress 回翻）'
  - '承接 task-04 接线：platform_sync/service.py 的 CLI 墓碑 status=deleted 写路径处理器（task-04 已置 location=deleted）后追加 soft_delete_change_dir 调用收敛镜像（最小侵入一处调用；读时投影层零副作用原则不破坏——接线在写路径）'
  - '测试：新增 change/tests/test_delete_change.py（权限矩阵：owner 本人 200 / 非 owner 持 workspace_owner 角色 200 / 非 owner 普通成员 403 / owner_id 为空仅权限持有者可删 / 不存在 404 / 已删幂等 409；服务顺序断言：progress 行删 + location=deleted + change_events[delete] detail 四字段 + Change 行不物理删；enrich 前置过滤两态）+ spec_workspace/tests/test_soft_delete_change_dir.py（文件移入备份区路径断言 + manifest exists/version+1/platform_deleted 三断言 + 空目录 rmdir + 变更名含下划线前缀不漏不误伤 + 零文件幂等）'
acceptance:
  - '权限矩阵全绿：owner 本人 200；非 owner 持 change:archive（workspace_owner 角色）200；非 owner 无权限 403；owner_id 为空仅权限持有者可删；不存在 change_id 404（D-001@v1）'
  - '删除成功响应 {ok=true, backup_dir, file_count}；Change 行保留且 location=deleted（不物理删）；platform_change_progress 对应行删；change_events 追加 event_type=delete 且 detail 含 deleted_by/change_key/file_count/backup_dir（D-002@v1）'
  - 'manifest 前缀行全部 exists=False、version 各 +1、platform_deleted=True；镜像文件实际移入备份区且变更目录被 rmdir；二次删除幂等拒绝且不产生第二个 delete 事件'
  - 'location=archive 行删除走 changes/archive/{name}/ 前缀，同样落三标记 + 审计'
  - 'enrich 对 deleted 行不再被 latest_progress 投影覆盖（status/current_stage 不回翻）'
  - 'CLI 墓碑（task-04 写路径）触发后镜像被 soft_delete_change_dir 同步收敛'
verify:
  - 'cd backend && python -m pytest app/modules/change/tests/test_delete_change.py -q'
  - 'cd backend && python -m pytest app/modules/spec_workspace/tests/test_soft_delete_change_dir.py app/modules/change/tests/test_enrich_projection.py -q（enrich 前置过滤回归）'
constraints:
  - '不做恢复 UI/回收站 tab（D-002@v1 Non-Goal）；不物理删 Change 行（审计 CASCADE）'
  - 'soft_delete_change_dir 仅触碰该变更目录（前缀枚举），禁整树扫描（R-03 Windows bind mount stat 断崖）'
  - 'platform_sync/service.py 仅允许墓碑接线一处调用（最小侵入），不改 _ensure_change_row 拒收逻辑（task-04 领地）'
  - '不动 apply_ops/_write_spec_root 拦截（task-02 领地）、不动 quicklog 对账（task-05 领地）、不加 last_pushed_at（task-11 领地）'
  - '不跑 pnpm gen:types、不改 openapi.json/api-types.ts（再生成产物归 task-07 同步提交）'
  - '遵守 CLAUDE.md 规则 0：只跑上列相关测试，全量留 CI'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
