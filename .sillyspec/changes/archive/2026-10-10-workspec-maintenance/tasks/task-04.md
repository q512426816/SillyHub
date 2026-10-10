---
id: task-04
title: 'daemon 双落盘例程——spawn `workspace add` + `register-repo`、能力探测降级、execFile 数组形参、结果归一回报（FR-03/FR-04/FR-07）'
title_zh: 'daemon 双落盘例程——spawn `workspace add` + `register-repo`、能力探测降级、execFile 数组形参、结果归一回报（FR-03/FR-04/FR-07）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 19:04:59
priority: P0
blocks: []
requirement_ids: [FR-03, FR-04, FR-07]
decision_ids: [D-008@v1, D-003@v2, D-004@v2, D-005@v2]
depends_on: [task-03]
allowed_paths:
  - sillyhub-daemon/src/linked-repos-sync.ts
  - sillyhub-daemon/src/protocol.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/sillyspec-manager.ts  # execute 修订：export resolveSillySpecBinDefault 一行（bin 解析单一源复用，避免复制 npm 布局候选逻辑）
  - sillyhub-daemon/src/hub-client.ts  # execute 修订：加 postLinkedReposSyncResult 回报方法（REST 落库唯一通道的 daemon 侧腿）
  - sillyhub-daemon/tests/linked-repos-sync.test.ts
target_files:
  - NEW:sillyhub-daemon/src/linked-repos-sync.ts
  - NEW:sillyhub-daemon/tests/linked-repos-sync.test.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/sillyspec-manager.ts
provides:
  daemon-sync:
    handler: "linked_repos_sync RPC handler（协议 method 注册进 protocol.ts 类型）"
    layers: "projects_yaml(spawn sillyspec workspace add) + repos_registry(spawn sillyspec local register-repo)"
    report: "结果归一 [{repo_name, layer, status: ok|skipped|failed, detail?}] POST 回报（404 静默）"
expects_from:
  task-03:
    sync-rpc: "payload/超时/回报端点契约（见 task-03 provides.sync-rpc）"
goal: >
  daemon 双落盘例程：在成员机器上按 RPC payload 逐仓两层 spawn sillyspec CLI 落盘
  工具消费点，能力探测降级，结果归一回报（design.md 总体方案、FR-03/FR-04/FR-07）。
implementation:
  - 新建 sillyhub-daemon/src/linked-repos-sync.ts：逐仓两层落盘——
    projects 层 `sillyspec workspace add <name> <rel_path> --repo <url>`（rel_path 空则
    skipped；不传 --role）；repos 层 `sillyspec local register-repo <name> <abs_path>`
    （abs_path 空则 skipped=本机路径未配置）；spawn 一律 execFile 数组形参（复用
    sillyhub-daemon/src/sillyspec-manager.ts 基建），cwd=root_path（payload 为准，
    缺失回退本地 WorkspaceManager 解析），路径正斜杠化
  - 能力探测：sillyspec 版本/子命令不存在 → 该层 skipped(detail=需升级)，不报错不重试；
    同机 register-repo 串行队列 + 失败重试一次（R-07）
  - sillyhub-daemon/src/protocol.ts：RpcRequest method 类型加 linked_repos_sync；
    daemon.ts 注册 handler 并在完成后 POST 回报（对齐 hub-client 回调形态，404 静默）
  - tests/linked-repos-sync.test.ts：命令拼装（数组形参/正斜杠）/两层独立成败/降级
    skipped/失败归一 failed+detail/幂等重跑用例（mock execFile）
acceptance:
  - FR-03 GWT：两层命令按 payload 正确拼装并落盘（产物由 CLI 写出，daemon 不拼 yaml）
  - FR-07 GWT：工具版本不足 → skipped(需升级)；成员未配路径 → repos 层 skipped 且
    projects 层独立成败
  - vitest 全绿：命令拼装/幂等/降级/失败归一四类用例
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/linked-repos-sync.test.ts
constraints:
  - R-05：execute 本 task 前确认活跃变更 2026-10-10-borrow-sandbox-workspace-context
    已收口归档（同触 daemon.ts/protocol.ts）；未归档则先处理该变更再开本 task
  - 不手写/手改 local.yaml 与 projects yaml 内容（一律经 CLI 命令，D-008）
  - 不做 clone/预取/健康巡检（非目标）
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
