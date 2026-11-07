---
id: task-04
title: 'driver-factory.ts write-only branch git approval wiring (D-016 + escape valve SILLYHUB_GIT_APPROVAL)'
title_zh: 'driver-factory.ts 仅写校验分支补 git 审批接线（D-016 + 逃生阀 SILLYHUB_GIT_APPROVAL）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-07 00:39:35
priority: P0
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-01, FR-06]
decision_ids: [D-001, D-008, D-016]
expects_from:
  - task-01 的 detectGitWriteIntent 与 task-02 的 collectGitApprovalPayload
  - task-03 落地的 git 注册逻辑（共享 helper 单一真相，Wave 内 01→02→03 序先行）
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager/driver-factory.ts
  - sillyhub-daemon/tests/interactive/driver-factory-approval-wiring.test.ts
target_files:
  - sillyhub-daemon/src/interactive/session-manager/driver-factory.ts
  - sillyhub-daemon/tests/interactive/driver-factory-approval-wiring.test.ts
goal: >
  driver-factory.ts 仅写校验分支（sillyhub-daemon/src/interactive/session-manager/driver-factory.ts:370-381，现注入 _buildWriteOnlyCanUseToolCallback、无 resolver/WS 通道——D-001「默认全局生效」的可达性缺口）补 git 审批最小接线：会话启动即构造 PermissionResolver（R-12 时序）+ git 拦截分支注入该回调，普通工具写校验路径不变（D-016）；SILLYHUB_GIT_APPROVAL=off 逃生阀全局关闭（FR-06）。
implementation:
  - 读双分支现状：driver-factory.ts:291 approvalReady 判定、:301-369 approvalReady 分支（resolver 经 mgr._permissionResolverFactory 建 + _buildCanUseToolCallback 注入，task-03 的 git 分支已在其内）、:370-381 else if (writeGuardEnabled) 仅写校验分支（:375 _buildWriteOnlyCanUseToolCallback，纯本地校验无 resolver）
  - 仅写校验分支补最小审批面（D-016）：mgr._permissionResolverFactory 与 mgr._permissionWsClient 均在时构造 resolver 存入 mgr._resolversBySession（与 approvalReady 分支同时机——会话启动即建，R-12：resolver 通道初始化不晚于首个 git 命令）；任一缺失保持现状不接线（fail-soft 不恶化）
  - git 拦截注入：该分支 canUseTool 在写校验之外前置 git 拦截——复用 task-03 在 permission.ts 落的同一 git 注册逻辑（抽共享 helper 单一真相，禁止两份漂移副本）；非 git 命令行为与现状逐字节一致
  - 逃生阀：SILLYHUB_GIT_APPROVAL 为 'off' 时本分支与 task-03 挂载点均不拦（默认 on）；env 读取与判定和 task-03 同一实现
  - 单测（扩展 tests/interactive/driver-factory-approval-wiring.test.ts）：enableApproval=false + writeGuardEnabled 会话「启动即拦截可达」（首个 Bash git commit 即 resolver.register dialog_kind='git_approval'，R-12 实现期核实点）；off 阀不拦走现状；factory/wsClient 缺失时不接线不抛错；普通写工具经 _wrapWithWriteGuard 行为不变
acceptance:
  - enableApproval=false（无 manual_approval）+ writeGuardEnabled 会话：git commit/push 命中 → resolver.register（dialog_kind='git_approval'）可达（D-016/D-001 全局生效）
  - 「会话启动即拦截可达」单测通过（R-12 实现期核实点）；resolver 构造时机与 approvalReady 分支同时机
  - SILLYHUB_GIT_APPROVAL=off 时行为与现状完全一致（brownfield 全局验收 3 / FR-06）
  - 非 git 工具调用（写校验/读放行）行为与现状一致；factory/wsClient 缺失时降级现状不抛错
  - 存量 driver-factory-approval-wiring.test.ts / session-manager-write-guard.test.ts 用例零回归
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/driver-factory-approval-wiring.test.ts tests/interactive/session-manager-write-guard.test.ts
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 普通工具写校验路径零改动：_wrapWithWriteGuard 包装顺序、writeGuardEnabled 语义、approvalReady 分支（driver-factory.ts:301-369）除共享 helper 引用外不动
  - git 拦截实现与 task-03 共享单一真相（抽公共 helper），禁止复制粘贴两份漂移
  - resolver 构造复用 mgr._permissionResolverFactory 工厂（不绕过工厂自建）；WS 通道复用 mgr._permissionWsClient
  - daemon ESM import 带 .js；规则 0 禁全量测试，仅跑相关测试文件
  - 不实现代执行（W2 范围）；本 task 仅打通挂起可达性
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
