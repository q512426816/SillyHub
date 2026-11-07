---
id: task-09
title: '会话级 git-diff 只读端点（service + router 挂载 + openapi）'
title_zh: '会话级 git-diff 只读端点（service + router 挂载 + openapi）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-07 00:39:35
priority: P0
depends_on: []
blocks: [task-10]
requirement_ids: [FR-02]
decision_ids: []
provides:
  - contract: GET /api/daemon/sessions/{id}/git-diff 端点
    fields: [单文件 unified diff 文本]
allowed_paths:
  - backend/app/modules/daemon/router/__init__.py
  - backend/app/modules/daemon/session/service/git_diff.py
  - backend/app/modules/daemon/router/session_crud.py
target_files:
  - NEW:backend/app/modules/daemon/session/service/git_diff.py
  - backend/app/modules/daemon/router/session_crud.py
goal: >
  新增会话级单文件 diff 只读端点 GET /api/daemon/sessions/{session_id}/git-diff?path=：
  service 定位会话 worktree 根（复用 git_status.py 三层探测）后经 daemon RPC 取工作区 vs
  HEAD 的单文件 diff，供 git 确认卡按需查看单文件差异（FR-02「单文件可查看 diff」取数端）。
implementation:
  - 新建 backend/app/modules/daemon/session/service/git_diff.py：get_session_git_diff(svc,
    session_id, path, user_id) → GitDiffResponse（pydantic 响应模型在本文件内定义，design
    数据模型节明示）；root 决策链复用 git_status.py 同款三层（current_change_id → change_key
    → worktree 探测 / cwd 快照 / 绑定根）——探测件从 git_status.py 导入复用（_probe_worktree
    等），不复制实现、不修改 git_status.py
  - RPC 语义勘误落地（源码对齐）：design 文面写 git_diff_file，但该 RPC 是 git show <sha>
    提交级 diff（sha 必填、sillyhub-daemon/src/host-fs-handler.ts:1767 gitDiffFile），
    确认卡的文件是未提交工作区改动（已暂存/未暂存/未跟踪）——实际调 daemon RPC
    git_worktree_diff（host-fs-handler.ts:2150 gitWorktreeDiff：porcelain 单文件判态 +
    git diff HEAD + untracked no-index 分流，返回 status/head_short/diff/truncated/binary/
    error），入参 root+path（daemon 侧已带白名单守卫与 pathspec 校验）
  - 错误面照 git_status.py 同款骨架：会话属主校验走 svc.get_agent_session（缺失/跨用户统一
    404 不泄露存在性）；daemon 离线或 mid-rpc 断连→502、RPC 超时→504、forbidden（root 越界）
    →403、非 git 仓库（error 含 not a git repository）→200 no_git 空态、其余采集 error→502
  - backend/app/modules/daemon/router/session_crud.py 挂端点：照 :643 git-status 先例同款——
    router.get 路径 /sessions/{session_id}/git-diff、response_model=GitDiffResponse，依赖用
    session（SessionDep）+ user（TaskRunAgentUser，require_permission_any 无 Path 依赖），
    path 为 Query 必填参数；函数体 DaemonService(session) 薄转发 service；就近放 git-status
    端点之后（design 文件清单「挂 git_status 同文件就近」）
  - 路径安全：path 参数原样透传 daemon（daemon 侧 assertGitPathspec + allowed_roots 白名单
    兜底），backend 不做绝对路径拼接；响应只含 diff 相关字段
acceptance:
  - GET /api/daemon/sessions/{id}/git-diff?path=<相对路径> 返回 status/diff/truncated/binary
    齐全的响应（工作区 vs HEAD 口径）；schema 随路由进 openapi（openapi.json 再生成归 task-10）
  - 会话不存在/跨用户→404；daemon 离线→502、超时→504、forbidden→403、非 git 仓→no_git
    空态（错误面与 git_status.py 对齐）
  - 端点无 Path(workspace_id) 依赖形态——鉴权走 TaskRunAgentUser，不出现 422
verify:
  - cd backend && uv run pytest tests/modules/daemon/test_session_git_status.py -q
    （挂载文件 session_crud.py 存量零回归）
  - cd backend && uv run python -c "from app.main import app; print([r.path for r in
    app.routes if 'git-diff' in getattr(r, 'path', '')])"（路由注册冒烟，不落盘）
constraints:
  - 遵守 backend 模块分层约定 router/service/schema：路由薄转发、逻辑在 service、响应模型
    在 git_diff.py 内定义（design 数据模型节明示，不进 daemon/schema.py 也能经 response_model
    导出 openapi）
  - 禁止用 require_permission（其内嵌 workspace_id 的 Path 隐式依赖，本端点路径无该参数——
    用了必 422）；照 git-status 先例用 TaskRunAgentUser
  - 只读端点：零 daemon RPC 契约改动、不动 git_status.py 与 git_log 模块既有代码；backend
    审批链路零改动（D-008 dict 透传原则）
  - 禁止跑全量 pytest（规则 0）；本 task 不手改 backend/openapi.json 与两份 api-types.ts
    （生成物统一归 task-10 双跑提交）
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
