---
id: task-02
title: 'backend GET /git-log/status 端点 + GitLogStatusResponse schema + 六分支集成测试'
title_zh: 'backend GET /git-log/status 端点 + GitLogStatusResponse schema + 六分支集成测试'
author: 'qinyi'
created_at: 2026-08-26 23:21:52
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-05, FR-06]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/git_log/router.py
  - backend/app/modules/git_log/service.py
  - backend/app/modules/git_log/schema.py
  - backend/app/modules/git_log/tests/test_router.py
expects_from:
  task-01:
    - contract: GitStatusRpc
      needs: 'branch/detached/upstream/ahead/behind/files_changed/additions/deletions/untracked_count/head_short/empty/fetch_performed/fetch_error/error——十四字段与 design §7.2 逐字对齐（与 task-01 provides 一致）'
provides:
  - contract: GitLogStatusEndpoint
    fields:
      - 'GET /workspaces/{workspace_id}/git-log/status（WORKSPACE_READ 门控）→ GitLogStatusResponse'
      - 'git_mode(git|no_git)/branch(str|null)/detached(bool)/upstream(str|null)/ahead(int|null)/behind(int|null)'
      - 'dirty{files_changed+additions+deletions+untracked_count}(int|null) + head_short(str|null) + empty(bool)'
      - 'fetch{performed(bool)+error(fetch_timeout|fetch_failed|no_remote|null)} + synced_at(ISO 组装时刻)——逐字段对齐 design §5.3'
goal: '在 backend git_log 模块新增 GET /workspaces/{workspace_id}/git-log/status 轻端点（design §5.3，D-002 方案 A），复用既有链路消费 task-01 GitStatusRpc 并映射为 GitLogStatusResponse，供 task-03 前端状态条取数'
implementation:
  - 'router.py +1 GET /workspaces/{workspace_id}/git-log/status 端点：WORKSPACE_READ 门控、无 query 参数、对齐既有三端点形态与错误映射'
  - 'service.py 新增 get_status：复用 _resolve_binding(:438)/_fetch_workspace(:461)/_probe_git_mode(:475)/_send_git_rpc(:500) 四私有方法（签名零改动）；RPC 结果按 §7.2 十四字段契约校验，缺字段 → GitLogContractGap 502'
  - '字段映射 §7.2 → §5.3：fetch_performed/fetch_error → fetch.performed/fetch.error 嵌套；synced_at = backend 组装时刻 ISO 时间戳；no_git → 200 空态（同 commits 端点语义）；fetch.error 非空时 behind 仍返回 stale 值 + fetch.performed=false（前端黄条依据）'
  - 'schema.py 新增三嵌套模型 GitLogStatusResponse + dirty{files_changed/additions/deletions/untracked_count} + fetch{performed/error}，snake_case 全程，逐字段对齐 §5.3'
  - 'tests/test_router.py 追加六分支集成测试（mock RPC 按 §7.2 契约）：正常/无 upstream/fetch 降级 200+error/no_git 空态 200/daemon 离线 502/契约缺口 502'
acceptance:
  - 'OpenAPI 出现 status 端点且标 WORKSPACE_READ 门控'
  - '六分支测试断言到字段映射与降级形态：fetch.performed=false + error 代号、synced_at 存在、no_git 空态 200、契约缺口 502、无 upstream 时 ahead/behind=null'
  - 'schemas 与 design §5.3 逐字段一致（三嵌套模型 + 类型与 null 语义）'
verify:
  - 'cd backend && uv run ruff check app/modules/git_log'
  - 'cd backend && uv run pytest app/modules/git_log -q --no-cov'
constraints:
  - '不改既有三端点与四私有方法签名；local.yaml 已有 git_log 映射无需新增；无 DB 写入'
  - '旧 daemon 下 method_not_found 走既有错误映射（422 提示升级），不新增错误码'
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
