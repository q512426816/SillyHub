---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 关注点(Concerns)

> 来源:`docs/agent-platform-deep-audit-2026-07-12.md`、`docs/code-quality-hardening-2026-07-24.md`、源码与 `.claude/CLAUDE.md` 记忆条目。仅列真实问题,标注出处与状态(已修需防回归 / 待修 / 环境性)。

## 代码质量

### 🔴 高(卡死 / 烧 token / 正确性)

- **interactive cancel 不可达**:backend `_ws_cancel_stub` 是空桩(`daemon/lease_service.py:435-448` 注释陈旧"Wave 2 实现"),daemon interactive 路径(`daemon.ts:3234`)**直接 return 不进 TaskRunner、不启 lease 心跳** → 用户点"终止"界面即停,但 SDK 进程继续烧 token 到自然结束。审计 P0-1(audit §1)。
- **codex turn 收敛契约**:`notifyRunResult` 必须调,否则 consume 主循环永不退出、`currentTurnPromise` 永不 resolve → 交互式会话永久卡死(memory `codex-turn-completion-strong-contract`)。`codex-app-server-driver.ts:669` exit handler 干净退出(code=0)/信号杀(null)不 finalize 已在 code-quality §6 F5 修复,**需防回归**。
- **usage 提交链**:daemon→backend 的 token/cache/cost 走 `notifyRunResult` + `mergeAdapterUsage`(**非** `submitMessages`),`usage` 字段需 4 处同步,任一漏则丢失计费(memory `daemon-usage-submit-chain`)。
- **daemon 重启 turn 卡死根因**:`cli.ts` 漏传 persistence/recoveryClient(已修 commit `40e21d3`,配套测试 `cli-session-manager-injection.test.ts` 守护,memory `daemon-restart-session-recovery-fix`);多 daemon 实例(连本地 + 连远程同时)会触发 WS 重连风暴(memory `multi-daemon-instances`)。
- **god 文件难拆**:`task-runner.ts`(~2900 行)/ `daemon.ts`(~3500 行)高耦合,lease payload 鸭子类型几十处,无低风险切片(code-quality §7 DEFER,维持不做)。

### 🟡 中(债务 / 数据质量)

- **session-manager 内存泄漏**:`session-manager.ts:1777` end/fail 不清 `_store`,ended session 残留(code-quality §6 DEFER;需设计驱逐策略与持久化协调)。
- **A6 cache token 聚合不一致**:`stream-json.ts` L461/L706 `+=` vs L549 `=` 语义微妙,可能重复/错计 cache 词元(SAFE=N,code-quality §3/§7 A6 DEFER;印证 memory `claude-cache-token-semantics`:cache 词元是会话级累计非 turn 增量)。
- **daemon-client spec 同步断裂**:session 不 end → `postSpecSync` 不触发 + `.sillyspec` 包裹错位 + daemon 无 HTTP 只能 lease 轮询(memory `daemon-client-spec-sync-broken`,修复变更待 plan)。**这是 task-09 测试 flaky 的根因**。
- **host-fs-delegate daemon_id 路由 bug**:`delegate.py:665` 用 `daemon_runtime_id` 路由 WS 但 `_connections` 按 `daemon_instances.id`(memory `host-fs-delegate-daemon-id-routing-bug`,代码未 commit 在 worktree)。
- **runtime 读 daemon-client 断链**:runtime 页空 = `_resolver_for` 三重错位,真实 db 在 `.sillyspec/.runtime/`(memory `runtime-read-broken-daemon-client`)。
- **path-utils realpathSync 写决策热路径**:同步调用,异步化要改 `resolveRealPath` 签名波及 PolicyEngine 所有 canWrite/canCreate(code-quality §6 DEFER)。
- **ND-2 codex `_close` 不等 exit**:daemon 异常 shutdown 时 codex 子进程可能孤儿,待 shutdown 链路专项(code-quality §7 DEFER)。
- **子代理日志可见性**:`forwardSubagentText` + partial 按 parent 分桶 + 前端徽标(execute 进行中 W1+W2,memory `daemon-subagent-transcript-change`)。
- **Python→TS 重写历史注释残留**:`config.ts` / `hub-client.ts` / `adapters/index.ts` 等仍大量"对齐 Python xxx"映射注释(task-21 重写期对照),长期保留增加阅读负担。

### 🟢 低 / 环境性

- **Windows `daemon-start.bat` 需 CRLF**(memory `daemon-restart-session-recovery-fix`)。
- **多 daemon 实例**:`stop` 子命令读单一 `daemon.pid`,多实例 PID 文件互相覆盖;停按 `--server` 区分别误杀;无自动拉起(memory `multi-daemon-instances`)。
- **`claude.exe` 孤儿清理**:禁 `taskkill /IM` 通杀(会自杀),按 PID 精确杀排除当前会话(memory `claude-exe-orphan-cleanup`)。
- **宿主机 `~/.claude/settings.json` 覆盖平台注入**:cc-switch model/env 覆盖平台注入 → 已修为注入 `CLAUDE_CONFIG_DIR` 隔离到 `~/.sillyhub/daemon/claude-config`(commit `13fc1dc9`,memory `claude-code-config-dir-isolation-under-daemon`)。
- **D1 心跳监听器泄漏 / D2 codex parse 吞异常**:已在 code-quality Wave D 修复(`task-runner.ts:887`、`codex-app-server-driver.ts:718`),**需防回归**。
- **无显式债务标记**:grep `src/` 未发现 `TODO:`/`FIXME:`/`XXX:`/`HACK:` 残留(`credential.ts` 的 `{{USER_XXX}}` 是业务占位符模板,非债务);无 `: any`/`as any` 类型逃逸。
- **旧 Python `sillyhub_daemon/` 残留**:entry point 可能还指向 Python 实现,需 `pip uninstall` + 删残留 `sillyhub-daemon.exe`(README 安装小节)。

## 依赖风险

- **`@anthropic-ai/claude-agent-sdk` 钉死 `0.3.181`**(`package.json` + 8 条 pnpm overrides 把 win32/linux/darwin 的 x64/arm64/musl 平台包子包全部 override 到主包)——升级需同时改 version + 8 条 overrides,漏一条导致平台包解析失败。memory `daemon-bundle-tsc-module-not-found`:`.pnpm` 真实包目录可能空,普通 `pnpm install` 命中缓存不修,必须 `pnpm install --force` 才真重下。
- **self-update 按 backend manifest 对齐 bundle**:光 cp bundle 无效,daemon 按 backend manifest 对齐(升降级都 `need_restart` 退出);必须 `pnpm bundle` + rebuild backend + 重启 daemon(memory `daemon-self-update-downgrades-manual-bundle`)。
- **SDK 0.3.x 仍处早期**:`claude-sdk-driver.ts` 实现依赖 spike 结论(query 签名、interrupt turn 级、resume 按 cwd 分目录),0.x 阶段可能频繁破坏性变更,driver 封装需持续跟随。
- **Node ≥ 20**(`engines.node`)+ `packageManager: pnpm@9.6.0`:Node 18 及以下不兼容(`AbortSignal.timeout` / 原生 fetch 等);pnpm 版本漂移可能破坏 lockfile 一致性。
- **Node 20 原生 fetch 隐式行为依赖**:`hub-client.ts` 依赖"默认不读 HTTP_PROXY/HTTPS_PROXY"(等价旧 Python `trust_env=False`)和"无连接池"(`close()` no-op),这两个行为随 Node 版本可能变化。
- **`@modelcontextprotocol/sdk ^1.29.0` / `ws ^8.18.0` / `zod ^4.4.3`**:zod 4 是主版本,API 与 zod 3 不兼容(项目内已全量用 v4 写法);升级 ws / MCP SDK 需核实 WS 握手与 MCP 工具调用契约未变。
- **`@vercel/ncc ^0.44.0`**(bundle 用):打包成单文件 `dist/cli.js`,动态 require / 原生模块需 ncc 兼容(claude-agent-sdk 平台包已用 pnpm overrides 收口)。
- **本地代理外部依赖**:daemon 调用本机 `claude` / `codex` / `copilot` 等 CLI,这些是**运行时外部进程**,版本/安装路径由 `agent-detector.ts` 探测,不在依赖树内——升级代理 CLI 可能破坏 6 个协议适配器(stream-json / json-rpc / jsonl / ndjson / pi-json / text)的解析契约。
