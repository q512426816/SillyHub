# 未分类知识

> 项目特定的架构经验、历史记录、尚未提炼成通用 pattern 的知识。
> 已分类的迁移到：`sillyspec-gotchas.md`（工具坑）/ `testing-gotchas.md`（测试坑）/ `patterns.md`（架构）/ `known-issues.md`（项目坑）/ `conventions.md`（约定）。
> 已修复项保留并标注状态，便于回溯。INDEX.md 不索引本文件——条目成熟后请迁出到分类文件并加 INDEX 索引。

（2026-09-28 清账：本文件原有 41 条（40 个 `##` 条目 + 1 条丢标题的 SSE 路由条目）已全部迁出到五个分类文件并在 INDEX.md 补索引，见变更 2026-09-28-knowledge-inbox-clear。当前收件箱为空，新踩坑从下方追加。）


## 跨仓 worktree task 用直接 git commit，wt-commit 只认主仓 worktree

`sillyspec wt-commit --change <变更名>` 固定在**主仓** worktree（`.sillyspec/.runtime/worktrees/<变更名>`）跑 `git add/commit`；跨仓 task（task 卡 `repo: sillyspec` 等）的 worktree 是 `<变更名>--<repo-key>` 后缀目录，在跨仓 worktree 内跑 wt-commit 会被 CLI 当成 sillyspec 仓自己的项目实例（找它自己的 .sillyspec）报「worktree 不存在」。正确做法：跨仓 worktree 内直接 `git -C <worktree> add + commit`（execute step 指引「跨仓 worktree task」段本就钉了此方式），apply 阶段 CLI 统一把跨仓 worktree 交付 patch 回对应主工作区。另注意 wt-commit 的 `-m` 缺失会报错（不是可选参数）。来源：task-05/task-02 提交实操（2026-10-09-tombstone-conflict-root-fix）。

## 【待确认】daemon 集成测试的 daemon.start() 被系统代理黑洞拖死（npm view 30s×2）

`daemon.start()` 链上 `runPreflight`（preflight.ts runSillySpecCheck）与 `_registerDaemon` 的 `probeLatest`（sillyspec-manager.ts，未注入 sillyspecManager 时）各起一次 `npm view sillyspec version --prefer-online` 子进程；npm 12 在 Windows **遵循系统代理**（WinINET ProxyServer，如 Clash 127.0.0.1:7897），代理对 npm 流量黑洞时每次外呼挂满 runCmd 的 30s 超时帽 → 每个 `daemon.start()` 用例白付 30-60s，满套件整文件超时（2026-10-10 实测 daemon-borrow-sandbox 全红、daemon-kind-dispatch 20 用例 60s 超时；主仓 HEAD 对照复现=环境归因非代码回归）。`npm_config_registry`/`npm_config_proxy` env 钉法无效（系统代理优先级更高）。**修法（2026-10-10-borrow-sandbox-workspace-context task-04 已示范）**：测试文件 `vi.mock('../src/preflight.js', ...)` no-op 掉 runPreflight（182s→1.3s）+ 构造器注入 no-op `sillyspecManager`（官方注入口，daemon.ts ctorOpts）；不断言 preflight 行为的用例组语义无损。候选推广：daemon-kind-dispatch.test.ts 等所有真起 daemon.start() 的测试文件同款 mock（待确认后可立独立小变更）。来源：task-04 排障（reg query ProxyEnable=1 ProxyServer=127.0.0.1:7897 + spawn 计时二分定位）。

## pi 1.0+ 原生 MCP：PI_CODING_AGENT_DIR 重定向后 mcp.json 平铺在目录根（无 agent 子层）

pi 1.1.0 内置 MCP 客户端（pi mcp 子命令 / --no-mcp 开关 / mcp__<server>__<tool> 命名空间），配置读 ~/.pi/agent/mcp.json（全局）或 .pi/mcp.json（项目）。设 PI_CODING_AGENT_DIR 重定向后 pi root 直接对应 agent 层——per-session MCP 配置必须写 `<PI_CODING_AGENT_DIR>/mcp.json`（平铺），不是 `<dir>/agent/mcp.json`；格式与 codex 同风格 `{"mcpServers": {name: {command, args?, env?}}}`，per-server env（MCP_SESSION_ID）经条目 env 字段透传。`pi mcp list --json` 可离线验证连接与工具枚举。来源：2026-10-10-all-engines-mcp-injection task-01/task-05（SPIKE-00）。

## @modelcontextprotocol/sdk 1.29 高级 API 是 registerTool（tool() 旧三参形状已不兼容）

sdk 1.29 的 McpServer 注册工具用 `server.registerTool(name, { description, inputSchema: ZodRawShape }, handler)`；旧 `server.tool(name, schemaShape, handler)` 三参形状会抛 "expected a Zod schema or ToolAnnotations"。inputSchema 要 Zod raw shape——纯 JSON schema 对象不行，无参工具可省略 inputSchema。来源：2026-10-10-all-engines-mcp-injection SPIKE-00 echo server 实测。

## daemon mcp-server 的 env 契约：MCP_SERVER_BACKEND_URL + MCP_TOOLSET（file/mission_worker 两档）

daemon 侧 stdio MCP server（mcp-server.js）从 env 读 backend URL：键名是 `MCP_SERVER_BACKEND_URL`（不是 MCP_HUB_BASE_URL），token 走 `MCP_SERVER_DAEMON_API_KEY`（X-API-Key 优先）+ `MCP_SERVER_DAEMON_TOKEN`（Bearer）；工具集由 `MCP_TOOLSET` env 控制且仅认字面量 file / mission_worker，拼写错误或漏配**容错回落编排 5 工具**（不报错）——手动探测时工具集不对先查这个键。上传 fail-closed：MCP_ALLOWED_ROOT 未设时 upload_file 一律拒绝。来源：2026-10-10-all-engines-mcp-injection task-09 端到端实测。


## 【待确认】async session rollback 后访问 ORM 对象属性触发 MissingGreenlet（异常路径标量先捕获）

SQLAlchemy async（expire_on_commit 语义）下，`await session.rollback()` 会 expire 会话内全部 ORM 对象——异常处理路径里再访问 `obj.attr`（哪怕记日志 `str(agent_run.id)`）会触发同步 lazy load → `MissingGreenlet: greenlet_spawn has not been called`，且该异常常发生在 except 块自身，把原异常吞成误导性的 greenlet 报错（2026-10-12-session-defects task-08 实证：auto_resume 压缩失败分支 rollback 后记日志访问 agent_run.id 连环爆）。修法：进入可能 rollback 的 try 前把异常路径需要的标量先捕获（`co_run_id = str(agent_run.id)`），rollback 后需要对象时经 `await session.get(Model, pk)` 异步重载再操作。来源：task-08（commit 954cb88f 修正过程）。

（fake timers waitFor 条目已确认，迁出至 testing-gotchas.md——2026-10-13-session-change-files-hover 归档）
