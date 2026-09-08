---
id: task-04
title: 'backend 实现 sillyspec_compare.py + compare 端点 + DTO ql_id'
title_zh: 'backend 实现 sillyspec_compare.py + compare 端点 + DTO ql_id'
author: 'qinyi'
created_at: 2026-09-07 13:53:21
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-02, FR-03, FR-06, FR-07, FR-08, FR-09]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/sillyspec_compare.py
  - backend/app/modules/daemon/router.py
target_files:
  - NEW:backend/app/modules/daemon/sillyspec_compare.py
  - backend/app/modules/daemon/router.py
goal: >
  实现 compare 编排 service + compare REST 端点 + DaemonHeartbeatSillySpecConflict
  增 ql_id 可选字段，让 task-03 契约测试转绿，为 task-05 gen:types 与前端弹窗提供冻结契约。
implementation:
  - 新建 sillyspec_compare.py——asyncio.gather 并行 hub.send_rpc（daemon_id、method sillyspec_conflict_snapshot、显式 15s 超时，ws_hub.py:495）与平台侧读取；离线/超时按 DaemonRuntimeOffline 范式抛 504（explorer/service.py:272 先例）
  - 平台侧 spec-tree——SpecWorkspaceService 取 spec_root，按 daemon 回报路径逐条 containment 校验（拒 .. 段、resolve 落点必须在 spec_root 内，spec_workspace/service.py:1486-1504 同款），越界按平台侧缺失处理不读取；platform_updated_at 取文件 mtime 最大值
  - spec-tree 比对——status 四分类（modified/local_only/platform_only/identical），双侧均缺失剔除计 dropped_paths；modified 用 difflib.SequenceMatcher 出对齐 diff_rows（equal/delete/insert + 双侧 lineno/text，replace 展开为 delete+insert 相邻行）；本地 truncated 无 content 的文件不出 diff_rows；护栏单文件 diff 5000 行置 diff_truncated、整响应 2MB 置 response_truncated 并按文件倒序丢 diff_rows
  - progress 比对——平台侧走 PlatformSyncService.get_progress（platform_sync/router.py:313 同款调用），白名单字段（当前阶段/阶段标签/步骤进度/最近活跃/ql_id/ghost）归一化 progress_rows（label/local_value/platform_value/differ），本地缺失字段显式「—」；platform_updated_at 取 last_pushed_at
  - router.py 新增 GET /machines/{instance_id}/sillyspec-conflicts/{change}/compare（kind + workspace_id 查询参数），挂 sillyspec-resolve 旁（router.py:1409 区）——RuntimeAdminUser + _get_owned_instance（越权 404）、change 白名单复用 _validate_change 同款正则（422）、校验 workspace 成员资格；SillySpecConflictCompareResponse DTO 按 design §7.2 逐字段落地；DaemonHeartbeatSillySpecConflict（router.py:313 区）加可选 ql_id 字段（str 或 None，缺省 None），零改写透传语义不变
acceptance:
  - task-03 全部测试转绿，ruff 无新告警
  - compare 端点响应字段与 design §7.2 逐字段一致（含 dropped_paths 与 response_truncated），404/422/504 三态齐备
  - DaemonHeartbeatSillySpecConflict 新增 ql_id 可选字段后，既有心跳与机器视图测试零回归
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_sillyspec_compare.py -q
  - cd backend && uv run ruff check app/modules/daemon
constraints:
  - 不跑 pnpm gen:types——openapi.json 与 api-types.ts 同步归 task-05
  - 不加测试（task-03 已备好）；不改 sillyspec-resolve/ghost-cleanup 既有通道与心跳投影既有字段语义
  - RPC 超时显式 15s（send_rpc 默认 10s 不可用）；不新增权限概念，完全复用 RuntimeAdminUser + _get_owned_instance；不动 ws_hub.py 与 spec_workspace/service.py 本体
expects_from:
  task-02:
    - contract: SillySpecConflictSnapshot
      needs: [files, progress, ql_id, local_updated_at, conflict_created_at]
provides:
  - contract: SillySpecConflictCompareResponse
    fields: [change, kind, ql_id, conflict_created_at, local_updated_at, platform_updated_at, response_truncated, dropped_paths, files, progress_rows]
    consumers: [task-05, task-06, task-07, task-08]
  - contract: DaemonHeartbeatSillySpecConflict
    fields: [ql_id]
    note: 可选增量字段（零改写透传语义不变），经 task-05 gen:types 后供前端标题（task-08）消费
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
