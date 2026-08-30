---
id: task-01
title: 'preflight.ts: add bundle validator trio (MIN_BUNDLE_BYTES / validateBundleContent / validateBundleOnDisk), implementation only'
title_zh: 'preflight.ts 新增校验器三件套（MIN_BUNDLE_BYTES/validateBundleContent/validateBundleOnDisk），仅实现'
author: 'qinyi'
created_at: 2026-08-30 17:45:33
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-003@v1]
provides:
  - contract: validateBundleContent
    fields: [ok, buildId, size]
  - contract: validateBundleOnDisk
    fields: [binDir, logger, label]
  - contract: MIN_BUNDLE_BYTES
    fields: []
allowed_paths:
  - sillyhub-daemon/src/preflight.ts
goal: >
  在 src/preflight.ts 新增 bundle 内容校验器三件套（常量 + 两个校验函数），为 task-02 写入校验/备份、task-03 respawn 最后防线、task-07 stop 前主拦截提供共享校验口径——D-003 零子进程：buffer ≥ 64KB 且正则可提取 BUILD_ID，拦下 8-30 事故类 'NEW BUNDLE BODY'（15 字节、无 BUILD_ID）占位/半截内容。
implementation:
  - "模块级常量：在路径常量区（DAEMON_BIN_DIR/DAEMON_BUNDLE_NAME 之后，preflight.ts:63-73 附近）新增 `export const MIN_BUNDLE_BYTES = 65_536;`，注释引用 D-003（主 bundle 实测 3,572,030B / mcp 1,157,632B，64KB 有 17 倍余量；15 字节 'NEW BUNDLE BODY' 必拦）"
  - "纯函数校验器：`export function validateBundleContent(buf: Buffer): { ok: boolean; buildId: string | null; size: number }` —— size=buf.length；buf.length >= MIN_BUNDLE_BYTES 且正则 /BUILD_ID\\s*=\\s*[\"']([^\"']+)/ 首处匹配可提取 → { ok: true, buildId, size }；任一不过 → { ok: false, buildId: <提取值或 null>, size }。零子进程零 IO。正则与 daemon.ts:210 的 DISK_BUILD_ID_RE 同款同值重声明（preflight.ts 不可 import daemon.ts——daemon.ts:107 已 import preflight.ts 会成环；同值重声明先例：DAEMON_BUNDLE_NAME 两文件各自声明，daemon.ts:200-203 注释）"
  - "盘上校验器：`export async function validateBundleOnDisk(binDir: string, logger: PreflightLogger, label?: string): Promise<boolean>` —— readFile(join(binDir, DAEMON_BUNDLE_NAME)) 后调 validateBundleContent；读失败（catch）或校验不过 → logger('debug', 'daemon_bundle_on_disk_invalid', { label: label ?? DAEMON_BUNDLE_NAME, size, buildId, error? }) 返回 false（读失败视为不过，size/buildId 省略）；通过 → true。在既有 `import { mkdir, writeFile, rename, unlink } from 'node:fs/promises'`（preflight.ts:35）上补 readFile"
  - "权威拦截事件由调用方记（respawnDaemonAndExit → error daemon_self_update_respawn_validation_failed〔task-03〕；_tryUpdate → warn daemon_update_aborted_bad_bundle〔task-07〕；downloadAndReplace → warn daemon_bundle_validation_failed〔task-02，直调 validateBundleContent 非本函数〕），本函数只记 debug 明细，避免同一次拦截双记 warn/error"
  - "JSDoc 对齐文件既有风格（中文、标注事件名/常量来源/决策编号），文件头模块注释（preflight.ts:1-30）补防线 2/3 一句概述"
acceptance:
  - "cd sillyhub-daemon && pnpm typecheck（tsc --noEmit，tsconfig include 仅 src）0 错误，三个新导出编译通过：validateBundleContent 同步纯函数、validateBundleOnDisk 返回 Promise<boolean>、MIN_BUNDLE_BYTES 常量"
  - "零既有行改动：runPreflight/runDaemonSelfUpdate/downloadAndReplace/respawnDaemonAndExit/runSillySpecCheck 行为不变（本任务只新增，不触碰其他函数）"
  - "git status 改动仅 sillyhub-daemon/src/preflight.ts 一个文件"
verify:
  - "cd sillyhub-daemon && pnpm typecheck"
constraints:
  - "仅实现：不加/不改任何测试文件（校验器单测集中落 task-04，plan Wave 铁律：preflight 侧单测全部归 task-04）"
  - "ESM import 带 .js 后缀：本任务仅补 node:fs/promises 具名导入（readFile），无新增本地模块 import；禁止 import daemon.ts（成环）"
  - "禁止跑全量测试（CLAUDE.md 规则 0）：本任务验收仅 typecheck，不触碰 tests/preflight.test.ts 与 tests/preflight-download-replace.test.ts"
  - "纯函数零子进程零平台分支（Buffer 长度 + 正则），Windows/Linux/macOS 行为一致"
  - "不触碰真实 ~/.sillyhub/daemon/bin：validateBundleContent 无 IO；validateBundleOnDisk 只读且 binDir 一律由调用方传入"
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
