---
id: task-01
title: 'sillyspec-manager workspaceId parameterization + workspace_root_unknown semantics + tests'
title_zh: 'sillyspec-manager 工作区参数化与未认领错误语义及测试'
author: 'qinyi'
created_at: 2026-09-09 21:29:54
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/sillyspec-manager.ts
  - sillyhub-daemon/tests/sillyspec-conflict-snapshot.test.ts
  - sillyhub-daemon/tests/sillyspec-platform-command.test.ts
target_files:
  - sillyhub-daemon/src/sillyspec-manager.ts
  - sillyhub-daemon/tests/sillyspec-conflict-snapshot.test.ts
  - sillyhub-daemon/tests/sillyspec-platform-command.test.ts
provides:
  - contract: SillySpecManager workspaceId API
    fields: [conflictSnapshot, runResolve, statusRootFor, workspace_root_unknown]
goal: >
  daemon 管理器的对比快照与裁决执行按 workspaceId 查映射取根，未命中抛
  workspace_root_unknown（裁决记 failed 不 spawn），无 workspaceId 保留 legacy
  单槽位语义——本 change 的核心根解析层。
implementation:
  - Deps 增加可选注入 statusRootFor 回调（入参 workspaceId 字符串，按 ws 查根；未命中返回 null，不在解析器内部回退单槽位）；构造函数存回调（缺省返回 null）
  - 新增私有解析 _resolveWorkspaceRoot(workspaceId)（返回 string 或 null）——workspaceId 非空走 statusRootFor（null 即未命中，不回退 _statusCwd）；空/undefined 走 this._statusCwd()（legacy）
  - conflictSnapshot(change, kind, workspaceId?)：root 解析换 _resolveWorkspaceRoot；workspaceId 非空且解析 null → throw RpcError('workspace_root_unknown', '该工作区尚未被本机会话认领，请先在该工作区发起一次会话')；legacy 路径 no_spec_root 语义不变
  - runResolve(change, strategy, workspaceId?)：_requireCommandPrecondition 增加可选 workspaceId 参（runGhostCleanup 不传 → legacy 单槽位）；workspaceId 非空且未命中 → recordCommandResult({action:'resolve', state:'failed', error:'该工作区尚未被本机会话认领，无法执行 sillyspec 命令'}) 返回 null 不 spawn；其余失败路径文案不变
  - 更新 sillyspec-conflict-snapshot.test.ts：新增 ① 带 ws 且映射命中 → 用映射根（单槽位投毒不影响）② 带 ws 且未命中 → RpcError code=workspace_root_unknown 不回退 ③ 不带 ws → 单槽位回归
  - 更新 sillyspec-platform-command.test.ts：新增 ① runResolve 带 ws 未命中 → 结果槽 failed 含「尚未被本机会话认领」且未 spawn ② 带 ws 命中 → spawn 用映射根 ③ 不带 ws → 单槽位回归
acceptance:
  - 带非空 workspaceId 且映射命中：conflictSnapshot/runResolve 使用映射根，单槽位被投毒不影响结果（测试断言）
  - 带非空 workspaceId 且映射未命中：对比抛 RpcError('workspace_root_unknown')；裁决 state=failed 且无 CLI spawn
  - 空 workspaceId：两方法走 _statusCwd() 单槽位，no_spec_root / failed 文案与现状一致
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/sillyspec-conflict-snapshot.test.ts tests/sillyspec-platform-command.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 不改 runGhostCleanup 签名与行为（范围外）
  - statusRootFor 内部不回退单槽位（回退等于保留 bug）
  - statusCwd/statusTargets 注入形态与心跳采集不动
  - ESM import 带 .js 后缀；不新增依赖
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
