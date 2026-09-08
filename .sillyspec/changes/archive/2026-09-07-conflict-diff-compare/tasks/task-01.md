---
id: task-01
title: add-daemon-conflict-snapshot-rpc-tests
title_zh: 'daemon 快照 RPC 测试先行（conflictSnapshot/ql_id/截断护栏/防逃逸）'
author: 'qinyi'
created_at: 2026-09-07 13:53:21
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-07, FR-08]
decision_ids: [D-001@v1, D-004@v1]
allowed_paths:
  - sillyhub-daemon/tests/sillyspec-conflict-snapshot.test.ts
target_files:
  - NEW:sillyhub-daemon/tests/sillyspec-conflict-snapshot.test.ts
goal: >
  为 sillyspec_conflict_snapshot RPC 的 daemon 侧行为先行固化 vitest 用例（conflictSnapshot 两种 kind、ql_id、四道截断护栏、realpath 防逃逸、心跳 ql_id 补报），红态锚定 design §7.1 契约，task-02 实现后转绿。
implementation:
  - 新建 sillyhub-daemon/tests/sillyspec-conflict-snapshot.test.ts，照 sillyspec-platform-command.test.ts 惯例（runProgressJson/statusCwd 全依赖注入、mkdtemp 临时 spec 根、零真实 spawn）
  - spec-tree 正常路径用例：临时根写 .sillyspec/.runtime/spec-sync-conflict-<change>.json 含 conflicting_paths，逐路径断言 content/mtime/size，缺失文件置 missing=true
  - 冲突记录缺失与 JSON 损坏两例：均抛 RpcError（code 非 internal）
  - 防逃逸用例：conflicting_paths 混入 .. 段与符号链接越界路径，realpath 落点在 spec 根外即拒读、不泄漏根外内容
  - 截断护栏用例一：单文件超 256KB 置 truncated=true 且缺省 content；路径数超 300 截断
  - 截断护栏用例二：files 内容总字节超 4MB 时按信噪比排序（changes/<change>/ 目录优先、archive 沉底），溢出路径仅元信息且 truncated=true
  - 二进制用例：非 utf8 内容置 binary=true 且不带 content
  - ql_id 用例：quick-* 名且 guard.json 存在回其 quicklogId；guard.json 缺失与非 quick 名均回 null
  - progress 用例：kind=progress 读 .runtime/sync-conflict-<change>.json，并从 progress show --json 全局 envelope 的 data.changes[] 过滤该 change 条目，local_updated_at 取 last_active
  - 无 spec 根用例：statusCwd 回 null 时抛 RpcError 且 code 为 no_spec_root
  - 心跳补报用例：collectStatusOnce 后 pending_conflicts 的 quick 条带 ql_id，单条 guard.json 读失败仅缺省该条、不阻断其余条与心跳
  - RPC 分发用例：注册后 sillyspec_conflict_snapshot 的 params（change/kind）透传 manager，RpcError code 经 _dispatchRpc 原样回填
acceptance:
  - 行为矩阵全覆盖：RPC 分发、两种 kind、记录缺失与损坏、防逃逸、四道截断护栏、ql_id 有无、progress 过滤、无根报错、心跳补报
  - 现阶段运行全红且失败原因均为 conflictSnapshot 尚未实现（红因锚定，非断言误写）
  - 全部用例零真实 spawn、零网络，临时目录 afterEach 清理，Windows 可直接跑
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/sillyspec-conflict-snapshot.test.ts
constraints:
  - 只新增测试文件，不改 sillyhub-daemon/src 下任何代码（实现归 task-02）
  - 用例只锚定 design §7.1 公开契约（RPC 方法名、result 字段名、RpcError code），不依赖将实现细节的私有形态
  - 不跑 pnpm gen:types，不动 openapi.json 与前端类型（归 task-05）
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
