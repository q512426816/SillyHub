---
id: task-06
title: 'Wire cwd guard into daemon interactive claim path'
title_zh: 'daemon.ts 认领段接线——truthy 分支 + stat/白名单终检 + notifyRunResult 拒绝不 mkdir（depends_on: task-05）'
author: 'WhaleFall'
created_at: 2026-08-28 15:48:26
priority: P0
depends_on: [task-05]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-004@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
goal: >
  把 workspace 绑定会话的 cwd 守卫接线进 daemon.ts 交互认领段（3760-3869）：
  cwd 解析改 truthy 判定，firstRunId 守卫后插入「白名单终检先行 + stat 存在性」
  检查（FR-05/D-004@v1），失败经 notifyRunResult 主动回传拒绝且不再 mkdir——
  堵死错机派发时在错误机器上静默创建空目录继续跑的灾难性静默失败。
implementation:
  - 'cwd 解析 truthy 判定（:3790-3793 非借用分支）：`rawRootPath` 为非空字符串才作 cwd；空串 '''' 与 undefined/null 一律 `cwd = this._config.workspace_dir` 兜底（现状 `??` 不兜空串是陷阱，Grill D-1.2 修订）。'
  - '插入点在 firstRunId 非空守卫（:3808-3816）之后（保证 notifyRunResult 可用，防 run 永久 pending）：`rawRootPath` 为非空字符串且非 BORROW_SANDBOX_MARKER（workspace 绑定形态）——先白名单终检 `assertWithinAllowedRoots(cwd, this._effectiveAllowedRoots())`（:2530 同款用法；双违反形态白名单优先报 cwd_forbidden），再 fs stat 存在性检查，两检查结果经 `checkWorkspaceBoundCwd(cwd, exists, roots)`（task-05 提供）得 verdict。'
  - 'verdict 失败 → 对齐 executable-not-found 块（:3818-3849）既有主动回传模式：`notifyRunResult(leaseId, execPayload.claimToken, firstRunId, {status:''error_during_execution'', is_error:true, result_summary:verdict.message})`，回传失败仅 warn 不阻塞主循环，随后 return——不 mkdir、不进 spawn。'
  - 'gap-8 mkdir 收敛（:3852-3869）：workspace 绑定形态（非空 rootPath）删除/绕过无条件 `mkdir(cwd, {recursive:true})`；仅空 rootPath 兜底路径（daemon-client 会话回落 workspace_dir）保留 mkdir（:3861-3869）原样；借用沙箱分支（:3763-3789）不动。stat 需在 daemon.ts 顶部 node:fs/promises import（现仅 mkdir，:40）处补入。'
acceptance:
  - 'cwd 越白名单 → 拒（cwd_forbidden）：notifyRunResult 回传 status=error_during_execution、is_error=true、result_summary=中文原因（含 cwd），磁盘不建目录，session 不 spawn。'
  - 'cwd 不存在 → 拒（cwd_not_found）且磁盘上未创建该目录；白名单+存在性双违反时白名单（cwd_forbidden）优先。'
  - 'rootPath 为空串/undefined/null → 走 config.workspace_dir 兜底并保留 gap-8 mkdir（daemon-client 兜底目录可建）。'
  - '借用沙箱（BORROW_SANDBOX_MARKER）路径行为零变化（prepareWorkspace 自建目录，fail-open 回退逻辑不动）。'
verify:
  - cd sillyhub-daemon && pnpm typecheck && pnpm test（接线无自动化断言——「不 mkdir/保留 mkdir」按 design Wave C 声明以 typecheck + 既有 claim 链路回归保障，验收时如实人工核验）
constraints:
  - 内联逻辑只增不重构 god file（约 4700 行）：守卫判定全部外移到 task-05 的 checkWorkspaceBoundCwd 纯函数，daemon.ts 只接线（含补 stat import）。
  - 不改 notifyRunResult 通道格式（status/is_error/result_summary 字段语义与既有消费方兼容）。
  - 不改借用沙箱/空 rootPath 兜底行为；插入点必须在 firstRunId 守卫之后（notifyRunResult 可用性）。
  - 本卡不加接线级自动化测试（mkdir 无断言），三形态×双 OS 单测归 task-05。
expects_from: ['task-05: checkWorkspaceBoundCwd + CwdGuardVerdict']
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
