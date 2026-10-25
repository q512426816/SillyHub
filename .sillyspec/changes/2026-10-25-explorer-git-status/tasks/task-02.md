---
id: task-02
title: 'backend 双端点——schema 4 DTO + service get_dirty_files/get_worktree_diff + router 两端点 + tests/modules/git_log/test_git_log_dirty_files.py 降级测试（404/502/422/no_git/正常聚合 mock RPC）'
title_zh: 'backend 双端点——schema 4 DTO + service get_dirty_files/get_worktree_diff + router 两端点 + tests/modules/git_log/test_git_log_dirty_files.py 降级测试（404/502/422/no_git/正常聚合 mock RPC）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-25 20:18:25
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-006@v1]
allowed_paths:
  - backend/app/modules/git_log/schema.py
  - backend/app/modules/git_log/service.py
  - backend/app/modules/git_log/router.py
  - NEW:backend/tests/modules/git_log/__init__.py
  - NEW:backend/tests/modules/git_log/test_git_log_dirty_files.py
target_files:
  - backend/app/modules/git_log/schema.py
  - backend/app/modules/git_log/service.py
  - backend/app/modules/git_log/router.py
  - NEW:backend/tests/modules/git_log/__init__.py
  - NEW:backend/tests/modules/git_log/test_git_log_dirty_files.py
expects_from:
  - task-01: RPC git_dirty_files / git_worktree_diff 契约字段（send_rpc 载荷结构）
provides:
  - GET /workspaces/{wid}/git-log/dirty-files → GitDirtyFilesResponse（task-03 gen:types 消费）
  - GET /workspaces/{wid}/git-log/worktree-diff?path= → GitWorktreeDiffResponse（task-03 gen:types 消费）
goal: >
  backend git_log 模块暴露两个只读端点（改动文件清单 + 单文件工作区 diff），
  完整复用既有绑定解析/probe/错误映射骨架（D-006），并交付四种降级形态测试。
implementation:
  - backend/app/modules/git_log/schema.py 按 design.md §接口定义新增 GitDirtyFilesResponse / GitDirtyFileItem / GitIgnoredItem / GitWorktreeDiffResponse 四 DTO（字段与 task-01 RPC 契约逐字对齐）
  - backend/app/modules/git_log/service.py 新增 get_dirty_files / get_worktree_diff：复用 _resolve_binding(:472) / _probe_git_mode(:509，direct→no_git 空态) / _send_git_rpc(:534)；daemon 未知方法经既有 _map_remote_error 的 method_not_found 分支(:453)自动映射 422 GitLogDaemonTooOld——映射代码零改动；_validate_result 严格校验 RPC 载荷
  - backend/app/modules/git_log/router.py 对齐既有四端点形态(:53-114)新增两 GET 端点，WORKSPACE_READ 门控，RPC 超时 30s，path 参数复用 _validate_diff_path
  - NEW:backend/tests/modules/git_log/（目录+__init__.py，对齐 tests/modules/explorer/ 先例）：test_git_log_dirty_files.py 覆盖——未绑定 404 / daemon 离线 502 / daemon 版本过旧（method_not_found）422 / no_git 空态 / 正常聚合（mock RPC 载荷→响应逐字段断言）两组端点各五形态
acceptance:
  - pytest 单文件全绿（聚焦测试，不跑全量）
  - 两端点 OpenAPI schema 可被后续 gen:types 正确生成（response_model 齐全）
  - 降级文案中文且与既有 git-log 端点口径一致
verify:
  - cd backend && uv run pytest tests/modules/git_log/test_git_log_dirty_files.py -q
  - cd backend && uv run python -c "from app.modules.git_log.schema import GitDirtyFilesResponse, GitWorktreeDiffResponse"
constraints:
  - 只读端点，WORKSPACE_READ 门控与既有四端点一致；不新增写操作
  - 不改动 git_log 既有四端点与 _map_remote_error 映射代码
  - 错误结构复用既有 AppError 家族（GitLogNotBound/GitLogDaemonOffline/GitLogDaemonTooOld）
  - 测试用 mock RPC（patch ws_hub 单例访问器，explorer/git_log 既有测试同款手法）
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
