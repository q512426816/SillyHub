---
author: qinyi
created_at: 2026-08-08 19:10:00
title: SillySpec 路径A 派发接入指引（caller worktree 模式）
related_change: 2026-08-08-dispatch-worker-caller-worktree
audience: SillySpec 集成方 / SillyHub 部署方
---

# SillySpec 路径A 派发接入指引（caller worktree 模式）

本篇讲 SillySpec 把 worker 派发到**自己 worktree**（路径A）时，SillyHub daemon 侧
`allowed_roots` 怎么配。配置不对，worker 在 daemon 起进程那一步就会被 `forbidden` 拒掉
（design §10 R-03），或在 agent 写文件时被 Runtime Policy deny。读完本篇你能：

- 理解路径A 的部署模型（为什么单个仓根就能放行整族 worktree）；
- 分清 daemon 侧两道独立的 `allowed_roots` 守卫，知道各自的配置入口与排查方向；
- 用 `scripts/check-dispatch-allowed-roots.mjs` 在 dispatch 前一次性自检（fail-fast）。

> 路径A 的 backend / MCP 侧契约见跨仓文档 `docs/sillyspec/sillyhub-path-a-contract.md`
> （sillyspec 仓）与本仓 design
> `2026-08-08-dispatch-worker-caller-worktree/design.md`。本篇只覆盖 daemon 部署侧。

---

## 1. 部署模型（路径A）

路径A 的核心：**worker 不进 SillyHub 自建的 worktree，而是进 SillySpec caller 自己的
worktree**。SillySpec 在自己仓根下开 worktree：

```
<repo>/                          ← SillySpec caller 仓根（你正在跑 sillyspec 的仓库）
└── .sillyspec/.runtime/worktrees/
    └── <change>/                ← 路径A worker 的实际 cwd（git worktree）
```

SillySpec 调 `dispatch_worker(worktree_path=<上面那个 worktree 绝对路径>, branch="sillyspec/<change>", ...)`，
daemon 把 `worktree_path` 当作 worker 进程的 `root_path`（即 cwd）。

### 关键约定：workspace `root_path` = caller 仓根

SillyHub backend 的 workspace `root_path` 必须配成 **caller 仓根 `<repo>`**（不是 worktree
本身，也不是 `.sillyspec/.runtime/`）。原因：

- worktree 落在 `<repo>/.sillyspec/.runtime/worktrees/<change>/`，是仓根的**子路径**；
- daemon 的两道路径白名单都是「边界敏感前缀比较」（`resolved === root` 或
  `startsWith(root + sep)`，见 `file-rpc.ts:88-95`）；
- 所以**把仓根放进白名单一条，整族 worktree（任意 `<change>`）都被放行**——不用为每个
  change 单独配，也不会随 change 增减而漏配。

> 反例：若把 `root_path` 配成某个具体 worktree 目录，下一个 change 换 worktree 就越界。
> 永远配仓根。

---

## 2. 两道 allowed_roots 守卫（必须都含仓根）

daemon 侧有**两条独立**的路径白名单，分别守不同入口。**两条都必须放行仓根**，否则一个
挂在 spawn、一个挂在写文件。

### 守卫一：本地 config `allowed_roots` → `assertWithinAllowedRoots`

| 项 | 值 |
| --- | --- |
| 数据源 | daemon 本地配置文件 `~/.sillyhub/daemon/config-<server_hash>.json` 的 `allowed_roots` 数组（`DaemonConfig.allowed_roots`，`config.ts:282`） |
| 默认值 | `[os.homedir()]`（`config.ts:352`）——只允许家目录 |
| 守卫函数 | `assertWithinAllowedRoots(path, allowed_roots)`（`file-rpc.ts:70-99`） |
| 触发入口 | `HostFsHandler`（`host-fs-handler.ts`）——daemon 自跑的 `run_command` 的 cwd 校验、`list_dir` RPC、host-fs 文件读写都走这条 |
| 越界表现 | 抛 `RpcError(code='forbidden', message='path outside allowed_roots: <path>')`（`file-rpc.ts:97`） |
| 命中时机 | **worker spawn 阶段**——daemon 拿到 lease、要起进程时 cwd=`root_path` 越界，直接拒。**这是 R-03 的爆发点** |

路径A worker 的 `root_path` = caller worktree。仓根不在此白名单 → spawn 即拒，worker
根本起不来。

### 守卫二：backend runtime overlay → `PolicyEngine`

| 项 | 值 |
| --- | --- |
| 数据源 | backend DB：`DaemonRuntime.allowed_roots`（per-runtime，2026-07-06 下沉后主用）；legacy 回退 `DaemonInstance.allowed_roots`（`service.py:654-658`）。经心跳 / WS 下发到 daemon 的 per-runtime `PolicyCache`（`ws_hub.py:375-396`） |
| 守卫函数 | `PolicyEngine.judgeWrite` → `isPathUnderAnyRoot(normalizedPath, policy.allowedRoots)`（`policy/filesystem-policy.ts:201`、`policy/path-utils.ts:149-175`） |
| 触发入口 | agent 的**写类工具**——Claude Code 的 Write / Edit、Codex 的写操作等（写沙箱） |
| 越界表现 | 返回 `{allowed: false, reason: 'Runtime Policy 拒绝本次写入。\n... 原因：目标目录未配置为可写目录。'}`（`filesystem-policy.ts:56,209`） |
| 命中时机 | **worker 跑起来之后**调写工具时——worker 进程起来了，但每个写操作被 deny |

effective 计算（`service.py:648-650`）：`effective = daemon_roots ∩ AgentProfile.allowed_roots_overlay`。
overlay 空则等于 daemon 原值（不收紧）；overlay 非空且越界则抛 `AgentProfileOverlayTooWide`
（profile 只能收紧、不能放宽）。

> 读类工具（`canRead`）默认全 allow、不审计（`filesystem-policy.ts:88-90`），不在本守卫
> 关注范围。

### 两道守卫的关系

| 维度 | 守卫一（本地 config） | 守卫二（runtime overlay） |
| --- | --- | --- |
| 配置在哪 | daemon 本机 JSON 文件 | backend DB（daemon 实体 / runtime） |
| 谁来读 | `HostFsHandler` / `list_dir` RPC | agent 写类工具 |
| 命中阶段 | spawn（cwd 校验） | 写文件时 |
| 报错关键词 | `forbidden 'path outside allowed_roots'` | 「目标目录未配置为可写目录」 |
| 修复入口 | 编辑 `config-<hash>.json`（见 §3） | 改 backend `DaemonRuntime.allowed_roots` / 实体 allowed_roots（见 §3） |

**两道都要放行仓根**。只配一道：配了一没配二 → worker 起来但写不进；配了二没配一 →
worker 压根起不来。

---

## 3. 配置示例

### 3.1 守卫一：编辑 daemon 本地 config

定位文件：daemon 按它连接的 backend 地址算 hash，文件名
`~/.sillyhub/daemon/config-<sha256[0:8]>.json`（`config.ts:94-114`）。例如连
`http://localhost:8000` 的 daemon，文件可能是
`~/.sillyhub/daemon/config-a1b2c3d4.json`。不确定文件名就交给校验脚本（§4）全量扫。

在 `allowed_roots` 数组里**追加仓根绝对路径**：

```json
{
  "server_url": "http://localhost:8000",
  "allowed_roots": [
    "C:\\Users\\qinyi\\IdeaProjects\\multi-agent-platform",
    "/home/qinyi/multi-agent-platform"
  ]
}
```

约定（来自 `config.ts:264-282`、`normalizeAllowedRoots` `config.ts:533-559`）：

- **必须绝对路径**——相对路径会被 `path.resolve` 基于 cwd 折叠，跨工作目录不可靠；
- **不要写 `~`**——Node 的 `path.resolve` 不识别 `~`，会当成字面目录名，写成真实的
  绝对路径；
- **Windows 盘符保留原样**（`C:\\Users\\...`）——loadConfig 不做大小写归一，比较时再按
  平台归一（`file-rpc.ts:83-86`）；
- 反斜杠 / 正斜杠均可（win32 `path.resolve` 自动统一）；
- 配完**重启 daemon**（config 在启动时读入内存，`cli.ts` 加载流程）。

### 3.2 守卫二：backend runtime overlay

数据源在 backend DB（经管理 API / 前端配置，不在 daemon 本地文件）：

1. **daemon 实体 / runtime 的 `allowed_roots`**（主）：在 SillyHub 后端给目标 daemon 实体
   （或其 runtime）的 `allowed_roots` 加上仓根。这是 per-runtime 沙箱的来源
   （`service.py:654-658`），下发到 daemon 的 `PolicyCache`。
2. **AgentProfile `allowed_roots_overlay`**（可选收紧）：如果 dispatch 时绑定的 profile
   设了 overlay，overlay 也必须覆盖仓根，否则 effective 取交集后可能丢掉仓根。**路径A
   最省心做法：profile overlay 留空**（默认），effective 即等于 daemon roots。

> 实体 allowed_roots 与本地 config（守卫一）是两套值，**不会自动同步**。一边改了另一边
> 不动是常见踩坑（见 §5 排查表）。

---

## 4. smoke 前置硬校验脚本

`scripts/check-dispatch-allowed-roots.mjs` —— 在 dispatch 前一次性校验**守卫一**（本地
config）含 caller 仓根，不含就非零退出 + 中文引导。让 R-03 在部署期 fail-fast，而不是
dispatch 时才报 forbidden。

### 用法

```bash
# 校验当前目录是否已被本机所有 per-server config 放行（最常用）
node scripts/check-dispatch-allowed-roots.mjs

# 显式指定仓根
node scripts/check-dispatch-allowed-roots.mjs --repo-root C:\path\to\repo

# 只校验连某后端的那个 daemon（定位单个 config-<hash>.json）
node scripts/check-dispatch-allowed-roots.mjs --server-url http://localhost:8000
```

### 行为

- 仓根在 `allowed_roots`（含等值 / 父目录前缀）→ **EXIT 0**；
- 仓根不在 / config 文件缺失 / `allowed_roots` 为空 → **EXIT 1** + 中文引导（追加到哪个
  字段、JSON 示例、§3.2 runtime overlay 提示）；
- 不传 `--server-url` → 全量扫 `~/.sillyhub/daemon/config-*.json`，**任一缺失仓根即判
  失败**（fail-closed，避免「这个 server 配了、那个 server 没配」的暗坑）；
- 跨平台：Windows 盘符大小写归一、POSIX 大小写敏感，比较语义 1:1 对照
  `file-rpc.ts:82-95`；
- 纯读 JSON 文件，**不启动 / 不依赖 daemon 进程**，也不连 backend。

> 脚本只覆盖**守卫一**。守卫二（runtime overlay）在 backend DB，需在 SillyHub 后端 /
> 前端确认；本脚本不查 DB（保持无运行时依赖、可裸跑）。两个守卫都过才算部署到位。

### 何时跑

- 首次接入路径A、换 backend 地址、新建 / 迁移 caller 仓库后：必跑；
- dispatch 报 `forbidden 'path outside allowed_roots'` 时：第一时间跑（比翻日志快）。

---

## 5. 守卫触发点表 + 排查指引

| 症状 | 命中守卫 | 排查方向 |
| --- | --- | --- |
| worker 不起来；daemon 日志 / dispatch 响应见 `forbidden` + `path outside allowed_roots: <cwd>` | 守卫一 | 本地 `config-<hash>.json` 的 `allowed_roots` 没含仓根；跑 §4 脚本；改完重启 daemon |
| worker 起来了但写文件被拒；agent 输出见「目标目录未配置为可写目录」 | 守卫二 | backend `DaemonRuntime.allowed_roots`（或 `DaemonInstance.allowed_roots`）没含仓根；或 profile `allowed_roots_overlay` 把仓根交集掉了 |
| 路径前缀撞库：`/home/user` 配了，`/home/user-evil` 反而被放行 / 被拒异常 | 比较语义 | 检查是否误配了兄弟目录前缀；`under` 是边界敏感的（必须 `root + sep` 前缀），别手动拼字符串判断 |
| Windows 大小写：`C:\Repo` 配了，实际 cwd 是 `c:\repo` 被拒 | 守卫一比较 | 不应发生（`file-rpc.ts:85` toLowerCase 归一）；若发生说明 daemon 版本旧或被改，对照 `file-rpc.ts:82-95` |
| 换 backend 地址后配置「丢了」 | per-server 隔离 | daemon 按 `server_url` hash 分文件存配置（`config.ts:110-114`），新地址 = 新 hash = 新空配置 → 需重新加仓根 |

---

## 6. 相关代码索引

| 角色 | 文件:行 |
| --- | --- |
| 守卫一：`assertWithinAllowedRoots`（含 `under` 边界敏感比较、Windows 归一） | `sillyhub-daemon/src/file-rpc.ts:70-99` |
| 守卫一数据：`DaemonConfig.allowed_roots` 字段 | `sillyhub-daemon/src/config.ts:282` |
| 守卫一默认：`[homedir()]` | `sillyhub-daemon/src/config.ts:352` |
| per-server 配置文件定位 `configPathForServer` / `serverHash` | `sillyhub-daemon/src/config.ts:94-114` |
| 守卫二：`PolicyEngine.judgeWrite` → `isPathUnderAnyRoot` | `sillyhub-daemon/src/policy/filesystem-policy.ts:201`、`sillyhub-daemon/src/policy/path-utils.ts:149-175` |
| 守卫二下发：WS 推 `allowed_roots` 到 daemon | `backend/app/modules/daemon/ws_hub.py:375-396` |
| 守卫二 effective 计算：`daemon ∩ profile.overlay` | `backend/app/modules/agent/service.py:648-658,697-720` |
