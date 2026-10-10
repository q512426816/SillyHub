---
id: task-03
title: 'backend 同步编排与结果回报——sync 触发端点、WS RPC `linked_repos_sync`、daemon 回报端点与状态存储（FR-04/FR-05）'
title_zh: 'backend 同步编排与结果回报——sync 触发端点、WS RPC `linked_repos_sync`、daemon 回报端点与状态存储（FR-04/FR-05）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 19:04:59
priority: P0
blocks: []
requirement_ids: [FR-04, FR-05]
decision_ids: [D-008@v1, D-003@v2]
depends_on: [task-01, task-02]
allowed_paths:
  - backend/app/modules/daemon/linked_repos_sync.py
  - backend/app/modules/daemon/router/machines.py
  - backend/app/modules/daemon/tests/test_linked_repos_sync.py
  - backend/app/modules/workspace/linked_repos/router.py
  - backend/app/modules/workspace/linked_repos/service.py
  - backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py
target_files:
  - NEW:backend/app/modules/daemon/linked_repos_sync.py
  - NEW:backend/app/modules/daemon/tests/test_linked_repos_sync.py
  - backend/app/modules/daemon/router/machines.py
  - backend/app/modules/daemon/router/__init__.py
provides:
  sync-rpc:
    method: linked_repos_sync
    payload: "{workspace_id, root_path, repos:[{name, rel_path?, repo_url?, abs_path?}]}"
    timeout: "base 30s + 每仓 15s，上限 180s（对齐 sillyspec_compare.py:10 显式 timeout 先例）"
    trigger: "POST /api/workspaces/{id}/linked-repos/sync（成员可触发，受理即返）；CRUD 成功后 best-effort WS 推送（无确认语义）"
    report-endpoint: "POST /api/daemon/machines/{instance_id}/linked-repos-sync-result（落库唯一通道；body results[]: repo_name/layer/status/detail）"
expects_from:
  task-01:
    db-schema: "sync_states 表 (linked_repo_id,machine_id,layer) 唯一，upsert 状态行"
  task-02:
    crud-api: "linked_repos router/service 挂载点（sync 端点并入同一 router；GET 聚合 summary 由本 task 接管填充）"
goal: >
  同步编排与状态回环：sync 触发端点 + WS RPC `linked_repos_sync` 下发（超时定义）+
  daemon 回报端点（落库唯一通道）+ GET summary 填充（design.md 分层要点 4/5、FR-04/FR-05）。
implementation:
  - 新建 backend/app/modules/daemon/linked_repos_sync.py：RPC 编排（对齐
    backend/app/modules/daemon/sillyspec_compare.py 先例）——按成员绑定机器解析 abs_path、
    root_path 经 resolve_root_path_for_daemon 容器→宿主改写、超时计算（30s+15s/仓上限 180s）、
    请求-响应调用；CRUD 成功后 best-effort 推送复用同一例程
  - workspace linked_repos router 加 POST .../sync（成员可触发，受理即返 202 形态）；
    service 的 GET 聚合接管填充 sync_status_summary（成员=自己绑定机器最新逐层状态，
    owner/admin=全部机器）
  - backend/app/modules/daemon/router/machines.py 加 POST /machines/{instance_id}/
    linked-repos-sync-result 回报端点（daemon 机器身份认证对齐既有端点）→ upsert
    workspace_linked_repo_sync_states
  - 测试：RPC payload 组装/超时/回报 upsert/summary 聚合双视角/best-effort 推送不阻塞 CRUD
acceptance:
  - FR-04/FR-05 GWT 全过：回报落库后 GET 摘要反映最新结果；sync 触发受理即返
  - RPC 响应不写 sync_states（落库唯一通道=REST 回报，design 分层要点 4）
  - 老 daemon RPC unknown method 时状态显示「daemon 需升级」不报错（FR-07 面）
verify:
  - cd backend && uv run pytest app/modules/workspace/linked_repos/tests app/modules/daemon/tests -q --no-cov
constraints:
  - 不实现 daemon 侧落盘（task-04）
  - 不改变既有心跳协议字段（additive）
  - 禁跑全量 pytest（CLAUDE.md 规则 0）
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
