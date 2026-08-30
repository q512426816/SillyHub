---
id: task-04
title: 'preflight test suite: binDir isolation for runPreflight integration cases + validFakeBundle fixtures (incl. legacy 13-byte download-replace fixture) + validator/backup/respawn-intercept cases + real-bin hash regression'
title_zh: 'preflight.test.ts + preflight-download-replace.test.ts 全套测试：集成用例 binDir 隔离 + validFakeBundle fixture 合法化（含 download-replace 旧 fixture）+ 校验器/备份/respawn 拦截新用例 + 真实 bin hash 不变回归'
author: 'qinyi'
created_at: 2026-08-30 17:45:33
priority: P0
depends_on: ['task-01', 'task-02', 'task-03']
blocks: []
requirement_ids: [FR-05, FR-06, FR-07, FR-08, FR-09]
decision_ids: [D-003@v1, D-004@v1, D-005@v1, D-006@v1]
expects_from:
  task-01:
    - contract: validateBundleContent
      needs: [ok, buildId, size]
    - contract: validateBundleOnDisk
      needs: [binDir, logger, label]
    - contract: MIN_BUNDLE_BYTES
      needs: []
  task-02:
    - contract: downloadAndReplace 行为
      needs: [daemon_bundle_validation_failed, 备份轮换 3 份]
  task-03:
    - contract: respawnDaemonAndExit 签名
      needs: [async Promise<void, runPreflight binDir 第三参]
allowed_paths:
  - sillyhub-daemon/tests/preflight.test.ts
  - sillyhub-daemon/tests/preflight-download-replace.test.ts
goal: >
  preflight 线全套测试落地（依赖 task-01/02/03 实现完成）：runPreflight 集成用例 binDir 隔离堵住"测试写真实 bin"根因（8-30 事故元凶 preflight.test.ts:645 用例）；既有非法 fixture（'NEW BUNDLE BODY' 15 字节 / '// bundle v2' 13 字节）换 validFakeBundle 合法假 bundle（D-006）；新增校验器/下载拦截/备份轮换/respawn 拦截用例；加真实 ~/.sillyhub/daemon/bin hash 前后不变回归断言。
implementation:
  - "tests/preflight.test.ts 新增 helper `validFakeBundle(buildId: string): Buffer` —— Buffer.concat([Buffer.from(`export const BUILD_ID = \"${buildId}\";\n`), Buffer.alloc(MIN_BUNDLE_BYTES)])（总长 > MIN_BUNDLE_BYTES 且首行含可提取 BUILD_ID，D-006）；从 '../src/preflight.js' 补导入 MIN_BUNDLE_BYTES / validateBundleContent / validateBundleOnDisk"
  - "fixture 合法化（D-006，防线 2 上线后旧 fixture 必红）：runDaemonSelfUpdate describe 三个下载替换用例的 bundleResponse('NEW BUNDLE BODY') / 'NEW MCP BODY'（:311 / :340-341 / :366）换 new Response(validFakeBundle('def5678')) / validFakeBundle('mcp-def5678')（Response 构造器接受 Buffer 作 BodyInit）；readFileSync 内容断言（:320 / :348-349）改为 validateBundleContent(readFileSync(target)) 的 ok/buildId 断言；mcp 404 用例（:356-375）主 bundle fixture 同步换合法（mcp 仍 404）"
  - "runPreflight 集成 describe（:587-666）三个用例的 runPreflight(makeConfig(), fn)（:602 / :617 / :650）全部改传第三参 makeTmpDir()（:623-665 用例即 8-30 写真实 bin 的根因用例）；其 fixture（:645-646）换合法 bundle 后，respawn spawn 断言（:653-658）在 await runPreflight 解析后仍成立（respawnDaemonAndExit 已 async 且盘上是刚落盘的合法 bundle → 校验通过照常 spawn，spawn 参数含 join(binDir,'sillyhub-daemon.js')）"
  - "respawnDaemonAndExit describe（:506-583）三用例适配 async 化：调用补 await；spawn 前置条件是盘上 bundle 合法 → 各用例先 writeFileSync(join(binDir, 'sillyhub-daemon.js'), validFakeBundle('abc1234')) 预置好盘（空 tmpDir 读失败会被防线 3 拦下不 spawn）"
  - "新增用例（preflight.test.ts）：① 校验器直调——合法（≥64KB + BUILD_ID）ok=true 且 buildId 提取正确；15 字节 'NEW BUNDLE BODY' ok=false 且 buildId=null；Buffer.alloc(70_000) 无 BUILD_ID ok=false；恰好 65_536 字节含 BUILD_ID 边界 ok=true。② validateBundleOnDisk——预置合法 bundle → resolves true；预置坏 bundle → false；目录不存在（读失败）→ false。③ 下载拦截（直调 downloadAndReplace）——fetch 返回 'NEW BUNDLE BODY' → false、target 不存在、.tmp 不残留、预置旧 target 内容不变、warn daemon_bundle_validation_failed 含 size=15/buildId=null。④ 备份轮换——预置 target 后连续替换 4 次（vi.useFakeTimers + vi.setSystemTime 制造不同秒时间戳）→ 同前缀 .bak 恰 3 份且最旧被清、target 为最新内容；同秒两次替换 → .bak 数不增（同名覆盖）。⑤ respawn 拦截——binDir 预置坏 bundle → await respawnDaemonAndExit 后 spawnMock 0 次、fake timers 推进 5s exitSpy 未调用、error daemon_self_update_respawn_validation_failed。⑥ binDir 透传——runPreflight 第三参传 tmp 目录 + 合法 bundle → 新 bundle 落在该 tmp 目录"
  - "tests/preflight-download-replace.test.ts：成功用例 body '// bundle v2'（:31，13 字节无 BUILD_ID）换本地内联同款 validFakeBundle('v2') helper（两测试文件各自内联，不新增共享文件超 allowed_paths）；断言改 validateBundleContent(readFileSync(...)) ok=true 且 buildId='v2'，'无 .tmp 残留'断言（:46）保留；失败用例（:49-67）body '// x'（4 字节）会被前置校验拦（到不了 rename）→ 改用合法大 body + target 预置为目录，保留 rename 失败/.tmp 清理覆盖；非 200 用例（:69-85）不动；另补坏内容（<64KB）→ false 且 target/.tmp 均不出现 + warn daemon_bundle_validation_failed 用例"
  - "真实 bin hash 回归（根因回归，FR-09/D-006）：preflight.test.ts 顶层新增用例——测试开始前记录 join(homedir(), '.sillyhub', 'daemon', 'bin') 下全部文件的 { 文件名 → createHash('sha256') 摘要 } 映射（目录不存在则记空映射并跳过比对），文件级所有用例跑完后重算，断言逐文件 hash 一致且文件集合无增删"
  - "两文件头部注释块（preflight.test.ts:1-13 mock 策略说明）同步更新：注明 node:fs/promises 不 mock、集成用例 binDir 一律临时目录、fixture 须合法 bundle（CLAUDE.md 规则 18）"
acceptance:
  - "cd sillyhub-daemon && pnpm test -- tests/preflight.test.ts 全绿（vitest run 单文件，含全部新增用例）"
  - "cd sillyhub-daemon && pnpm test -- tests/preflight-download-replace.test.ts 全绿"
  - "真实 ~/.sillyhub/daemon/bin 目录文件 hash 测试前后逐文件不变（hash 回归用例绿；目录不存在时跳过）"
  - "cd sillyhub-daemon && pnpm typecheck 0 错误（src 侧未被本任务触碰的回归确认）"
  - "git status 改动仅 sillyhub-daemon/tests/preflight.test.ts 与 sillyhub-daemon/tests/preflight-download-replace.test.ts 两个文件（src/preflight.ts 等实现文件不许动）"
verify:
  - "cd sillyhub-daemon && pnpm test -- tests/preflight.test.ts"
  - "cd sillyhub-daemon && pnpm test -- tests/preflight-download-replace.test.ts"
  - "cd sillyhub-daemon && pnpm typecheck"
  - "测试前 sha256sum ~/.sillyhub/daemon/bin/*（Windows PowerShell 用 Get-FileHash -Algorithm SHA256）记录，两测试文件跑完后再跑一次，逐文件 hash 与文件集合比对不变"
constraints:
  - "仅改两个测试文件：src/preflight.ts 与其他任何文件不许动；用例红时若判定为 task-01/02/03 实现缺陷，记录并回报，不顺手改实现（CLAUDE.md 规则 9：非测试逻辑有误禁止改测试迁就，反之亦然）"
  - "真实 ~/.sillyhub/daemon/bin 绝不可写：所有会写盘的用例 binDir 一律 mkdtempSync 临时目录（afterEach rmSync 既有清理复用）；hash 回归用例对真实 bin 只读"
  - "禁止跑全量测试（CLAUDE.md 规则 0）：仅跑上述两个文件，其余测试文件留给 task-08 整体回归"
  - "ESM import 带 .js 后缀（'../src/preflight.js'）；类型-only 导入用 import type（对齐 src tsconfig verbatimModuleSyntax 风格）"
  - "跨 Windows/Linux/macOS：路径一律 join() 拼接不硬编码分隔符；时间戳断言不依赖系统时区敏感格式；大 Buffer 用 Buffer.alloc/pad 而非逐字符拼接"
  - "依赖顺序：必须在 task-01/02/03 全部合入后执行（否则新导出/新行为不存在，用例无从写起）；本任务完成后两文件全绿是 task-08 整体回归的前置输入"
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
