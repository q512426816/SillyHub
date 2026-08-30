---
id: task-03
title: 'respawnDaemonAndExit: last-line on-disk validation before spawn (block without exit; signature to async Promise<void per plan ruling option a) + runPreflight optional binDir third param, implementation only'
title_zh: 'respawnDaemonAndExit 拉起前最后防线校验（不过不退出；签名改 async Promise<void，plan 审查裁定方案 a）+ runPreflight 增可选 binDir 参数，仅实现'
author: 'qinyi'
created_at: 2026-08-30 17:45:33
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-07, FR-08]
decision_ids: [D-003@v1, D-005@v1, D-006@v1, D-009@v1]
expects_from:
  task-01:
    - contract: validateBundleOnDisk
      needs: [binDir, logger, label]
provides:
  - contract: respawnDaemonAndExit 签名
    fields: [async Promise<void, runPreflight binDir 第三参]
allowed_paths:
  - sillyhub-daemon/src/preflight.ts
goal: >
  respawnDaemonAndExit（preflight.ts:334）spawn 前调 task-01 的 validateBundleOnDisk 作防线 3——坏盘不被拉起：error daemon_self_update_respawn_validation_failed + 提前 return 不退出（D-005）；签名按 plan 审查问题 3 裁定钉死方案 (a)：同步 void 改 async … Promise<void>（daemon.ts 两处调用点 fire-and-forget 兼容）；runPreflight 增可选第三参 binDir 透传 runDaemonSelfUpdate（D-006 测试隔离根因修复的 src 侧半边，测试侧归 task-04）。
implementation:
  - "respawnDaemonAndExit 签名（preflight.ts:334-338）改 `export async function respawnDaemonAndExit(logger: PreflightLogger, binDir: string = DAEMON_BIN_DIR, exitDelayMs: number = 500): Promise<void>`；函数体首行 `const ok = await validateBundleOnDisk(binDir, logger);`，!ok → logger('error', 'daemon_self_update_respawn_validation_failed', { bundle: join(binDir, DAEMON_BUNDLE_NAME) }) + return（不 spawn、不 setTimeout(process.exit)，旧进程保活）；校验通过后既有 spawn/unref/exit 逻辑（preflight.ts:339-366）逐行不动"
  - "runPreflight 签名（preflight.ts:95-98）改 `runPreflight(config: DaemonConfig, logger: PreflightLogger, binDir?: string): Promise<void>`；内部 runDaemonSelfUpdate(BUILD_ID, config, logger, binDir)（:106 改传第四参——binDir 参数已存在，preflight.ts:190，undefined 透传即默认 DAEMON_BIN_DIR）；respawn 调用点（:110）改 `await respawnDaemonAndExit(logger, binDir)`，仍在既有 try/catch 内，runPreflight 永不 reject 语义不变"
  - "daemon.ts 三个相关调用点一律不改（allowed_paths 不含 daemon.ts；daemon.ts 归 task-05~07 线）：生产 runPreflight 调用点 daemon.ts:1525 不传第三参 → 行为不变（R5 向后兼容）；respawn 两处调用点 daemon.ts:2145/:2179 保持 fire-and-forget（无 await）——async 化后返回 Promise 未 await，但函数全路径自收敛不 reject，无 unhandled rejection；方案 (a) 兼容性以 daemon.ts 零改动下 typecheck 0 错为证"
  - "JSDoc（preflight.ts:313-333）更新：async 签名、spawn 前防线 3 校验先行说明、引用 D-005/D-009（主拦截在 _tryUpdate stop 前，本函数为最后防线，覆盖 runPreflight 启动路径——该路径无 stop，拦截后正常继续启动旧逻辑）；文件头模块注释同步"
acceptance:
  - "cd sillyhub-daemon && pnpm typecheck 0 错误（daemon.ts 零改动也 0 错——证明 void→Promise<void> 对 fire-and-forget 调用点兼容，方案 (a) 成立）"
  - "代码形态可审：校验在 spawn 之前、不过即 return 不 setTimeout(process.exit)；runPreflight 第三参为可选（binDir?: string）且透传到 runDaemonSelfUpdate 第四参"
  - "git status 改动仅 sillyhub-daemon/src/preflight.ts 一个文件，daemon.ts 零改动"
verify:
  - "cd sillyhub-daemon && pnpm typecheck"
constraints:
  - "仅实现（respawn 拦截/坏盘用例归 task-04）：本任务合入后 preflight.test.ts 的 respawnDaemonAndExit describe（:506-583 同步直调 + 空 tmpDir 无 bundle）与 runPreflight 集成 645 用例预期红，属预期中间态，task-04 统一补 await + 预置合法 fixture——不得为保绿回退 async 化"
  - "签名钉死方案 (a)：async … Promise<void>，不得改回调/事件查询等其他形态（plan 审查问题 3 裁定）；不得给 daemon.ts 调用点加 await 义务（daemon.ts 不在本任务范围）"
  - "禁止改 daemon.ts（plan Wave 铁律：preflight.ts 与 daemon.ts 两线文件不相交）"
  - "ESM import 带 .js 后缀（本任务无新增 import，validateBundleOnDisk 同文件可调）"
  - "禁止跑全量测试（CLAUDE.md 规则 0），验收仅 typecheck；不触碰两个 preflight 测试文件"
  - "与 task-01/02 同文件串行（Wave 1→2→3），基于前两任务合入后的 preflight.ts 续改；不触碰真实 ~/.sillyhub/daemon/bin（binDir 由调用方/测试传入）"
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
