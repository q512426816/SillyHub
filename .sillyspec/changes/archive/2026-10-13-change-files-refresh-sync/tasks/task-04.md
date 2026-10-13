---
id: task-04
title: 'backend 同步前置——change/router.py `list_change_files` 前插 `_sync_change_via_daemon`：resolve_member_binding_or_none（未绑定 skip）→ query_daemon_online_by_id（离线 skip）→ hub.send_rpc(''sillyspec_sync_change'', timeout=15) 整体 try/except（DaemonRuntimeOffline/DaemonRpcTimeout/DaemonRpcRemoteError 四路 log.info 静默降级）；service.list_files 零改动 [target: backend/app/modules/change/router.py]'
title_zh: 'backend 同步前置——change/router.py `list_change_files` 前插 `_sync_change_via_daemon`：resolve_member_binding_or_none（未绑定 skip）→ query_daemon_online_by_id（离线 skip）→ hub.send_rpc(''sillyspec_sync_change'', timeout=15) 整体 try/except（DaemonRuntimeOffline/DaemonRpcTimeout/DaemonRpcRemoteError 四路 log.info 静默降级）；service.list_files 零改动 [target: backend/app/modules/change/router.py]'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-13 12:58:32
priority: P0
depends_on: []
blocks: [task-05, task-06]
requirement_ids: [FR-01, FR-02, FR-04]
decision_ids: [D-002@v1, D-003@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/change/router.py
target_files: [backend/app/modules/change/router.py]
goal: >
  backend GET files 同步前置：绑定解析 → 在线判断 → send_rpc 触发 daemon 定向同步（15s 超时），四路失败静默降级——刷新即最新的平台侧入口（D-002/D-003）。
implementation:
  - backend/app/modules/change/router.py 新增 _sync_change_via_daemon(session, workspace_id, change, user_id) -> None：resolve_member_binding_or_none（workspace/member_runtimes/resolver.py:41）None→return；query_daemon_online_by_id（member_runtimes/queries.py:27）None→return；get_daemon_ws_hub().send_rpc(daemon_id, 'sillyspec_sync_change', dict(change=change.change_key, workspace_id=str(workspace_id)), timeout=15)
  - 降级收口（D-003）：try/except DaemonRuntimeOffline / DaemonRpcTimeout / DaemonRpcRemoteError（ws_hub.py:541-544 异常族）→ log.info('change.files_refresh_sync_skipped', reason=...) 后 return——任何情况不抛
  - list_change_files（change/router.py:364）在 service.list_files 前调 _sync_change_via_daemon（user 从既有 _user Depends 取，需解除匿名以传 user_id）
  - imports：MemberBindingResolver/resolve_member_binding_or_none、query_daemon_online_by_id、get_daemon_ws_hub、daemon RPC 异常类（懒导入防循环依赖，对齐 machines.py:396 惯例）
acceptance:
  - 绑定在线时：send_rpc 被调（method/change_key/workspace_id 正确），其后才 list_files
  - 未绑定/离线/超时/远端错误四路：不抛、正常走 list_files 返回现有镜像数据
  - service.list_files（change/service.py:606）diff 零改动
verify:
  - cd backend && uv run ruff check app/modules/change/router.py && uv run mypy app/modules/change/router.py
constraints:
  - 不新增 HTTP 端点、不改响应 schema（ChangeFileList 原样）
  - files/content、files/raw、files/pending 端点不挂前置（非目标）
  - 不接入借用兜底（_resolve_borrowed_or_own_runtime）——未绑定即降级，避免借他机 CLI 副作用
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
