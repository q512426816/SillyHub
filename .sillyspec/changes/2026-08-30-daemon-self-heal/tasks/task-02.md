---
id: task-02
title: 'downloadAndReplace: pre-write content validation + timestamped .bak backup rotation keeping 3 (mcp companion same path), implementation only'
title_zh: 'downloadAndReplace 写入校验前置 + .bak 备份轮换保留 3 份（mcp 伴生同款），仅实现'
author: 'qinyi'
created_at: 2026-08-30 17:45:33
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-003@v1, D-004@v1]
expects_from:
  task-01:
    - contract: validateBundleContent
      needs: [ok, buildId, size]
provides:
  - contract: downloadAndReplace 行为
    fields: [daemon_bundle_validation_failed, 备份轮换 3 份]
allowed_paths:
  - sillyhub-daemon/src/preflight.ts
goal: >
  downloadAndReplace（preflight.ts:434）在 writeFile(tmp) 前调 task-01 的 validateBundleContent，不可信内容不落盘不 rename 不 respawn（旧进程保活，下次触发重试）；rename 前对既有 target 产生 .bak-<yyyyMMdd-HHmmss> 备份并按文件名字典序保留最近 3 份（D-003/D-004）；mcp-server.js 伴生路径复用同函数自动同款。
implementation:
  - "写前校验（D-003）：downloadAndReplace 内 `const buf = Buffer.from(await resp.arrayBuffer())`（preflight.ts:461）之后、`await mkdir(binDir, ...)` / `await writeFile(tmp, buf)`（:465-466）之前插入 `const v = validateBundleContent(buf)`；!v.ok → logger('warn', 'daemon_bundle_validation_failed', { url: fullUrl, size: v.size, buildId: v.buildId }) + unlink(tmp).catch(() => undefined)（清上一轮可能残留的固定名 .tmp）+ return false（不 mkdir 不 writeFile 不 rename；调用链 runDaemonSelfUpdate 返回 false → 不 respawn）"
  - "备份轮换（D-004）：校验通过后、`await rename(tmp, target)`（preflight.ts:468）之前，target 存在（access/stat 试探，catch ENOENT 视为不存在）→ copyFile(target, `${target}.bak-${ts}`)，ts 为本地时间手拼 yyyyMMdd-HHmmss（Date getFullYear/getMonth/… + padStart，不依赖 locale/第三方库）；随后 readdir(binDir) 筛 `${fileName}.bak-` 前缀按文件名字典序排序，超出最近 3 份的旧备份逐个 unlink（同秒 copyFile 同名覆盖视为替换，天然去重）"
  - "备份失败不阻塞（D-004）：copyFile/清理任一步失败 → logger('warn', 'daemon_bundle_backup_failed', { target, error: fmtErr(e) }) 后继续 rename（备份是人工兜底路径，不拦自更新主线）"
  - "mcp-server.js 伴生同款零额外逻辑：updateMcpServerBundle（preflight.ts:285-311）复用同一 downloadAndReplace（fileName='mcp-server.js' 参数既有，:453 传入），步骤 1/2 自动生效；确认无绕过点即可，不另写一份校验"
  - "import 调整：`import { mkdir, writeFile, rename, unlink } from 'node:fs/promises'`（preflight.ts:35）补 copyFile、readdir、access（或 stat）；downloadAndReplace JSDoc（:423-433）与文件头模块注释同步补校验/备份说明（CLAUDE.md 规则 18：注释与实现一致）"
acceptance:
  - "cd sillyhub-daemon && pnpm typecheck 0 错误"
  - "代码形态可审：校验在 writeFile 之前（坏内容连 binDir/tmp 文件都不产生）、备份在 rename 之前、备份失败 warn 后仍走 rename、daemon_bundle_validation_failed 事件含 size/buildId 字段"
  - "downloadAndReplace 既有函数签名/参数顺序不变（task-04 直调测试依赖）；git status 改动仅 sillyhub-daemon/src/preflight.ts 一个文件"
verify:
  - "cd sillyhub-daemon && pnpm typecheck"
constraints:
  - "仅实现：不加/不改测试（校验拦截/备份轮换用例归 task-04）；本任务合入后既有 preflight 两个测试文件红属预期中间态（15/13 字节旧 fixture 会被新校验拦截），以 typecheck 为验收，留 task-04 统一换合法 fixture——不得为保绿而暂缓校验或放宽 MIN_BUNDLE_BYTES"
  - "禁止跑全量测试（CLAUDE.md 规则 0）：本任务不跑任何测试命令，验收仅 typecheck"
  - "ESM import 带 .js 后缀（仅补 node:fs/promises 具名导入，无新增本地模块）"
  - "跨平台：时间戳文件名本地时间手拼纯数字+连字符，字典序即时间序在 Windows/Linux/macOS 一致，不做平台分支；路径一律 join() 拼接"
  - "不触碰真实 ~/.sillyhub/daemon/bin：binDir 永远由调用方传入（生产默认值 DAEMON_BIN_DIR 语义与默认参不变）"
  - "与 task-01 同文件串行（Wave 1→2），execute 时基于 task-01 合入后的 preflight.ts 续改，避免行号漂移；不触碰 preflight.ts 其他函数"
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
