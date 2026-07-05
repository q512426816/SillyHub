---
author: WhaleFall
created_at: 2026-06-26T12:29:27
change: 2026-06-26-daemon-root-path-translation
---

# Design: daemon workspace root_path 容器→宿主机路径翻译修复

## 1. 背景

### 1.1 现象
变更中心「需求分析-触发智能体执行」启动的 CC 会话（session `bfe2359c`，agent_run `2ddc9306`，lease `457b3303`）在空目录执行，CC 找不到项目源码，反复 `find` 失败后 `status=cancelled exit=-1`。前端日志页因并发 schema 漂移（`agent_run_logs.dedup_key` 缺失，已另修）返回 500，掩盖了本问题。

### 1.2 根因（实证）
backend 跑在 Docker 容器内，workspace `root_path` 存容器路径 `/host-projects/WorkNew/SillyHub`（`HOST_PROJECTS_DIR=F:/` 挂载到 `/host-projects`），`path_source=server-local`。daemon 跑在 Windows 宿主机，收到该容器路径后：

- `sillyhub-daemon/src/workspace.ts:137` prepareWorkspace 分支0 `statSync("/host-projects/WorkNew/SillyHub")` → 宿主机不存在 → fallback 到分支3「无 repoUrl → 创建空目录」。
- CC cwd 变成 `C:\Users\12532\.sillyhub\daemon\workspaces\sillyhub`（terminal.log header 实证），该目录只有 daemon 生成的 `.claude/CLAUDE.md` + `.sillyspec-platform.json`，**零源码、非 git 仓库**。
- daemon `allowed_roots=["C:\\Users\\12532"]`（config.json 实证），不含 `F:`，即使 cwd 对也访问不了项目源码。

backend 在三处把**容器路径原样透传给 daemon**（未做反向改写）：
- `backend/app/modules/agent/router.py:268` `root_path=ws_row.root_path`
- `backend/app/modules/agent/placement.py:258` 和 `:484` `metadata["root_path"]=root_path`
- `backend/app/modules/agent/router.py:184` 注释自述「向 daemon 透传真实 root_path」，但透传的是容器路径。

### 1.3 为什么现有 spec_root_map 没救
daemon `translateSpecRoot`（`sillyhub-daemon/src/daemon.ts:179`）只翻译 **prompt 里的 spec_root**（`/data/spec-workspaces` → `E:\Software\Git\data\spec-workspaces`），不翻译 workspace `root_path`（`/host-projects`），也不作用于 cwd（`daemon.ts:2114 cwd = execPayload.rootPath` 直接用原值）。即 spec 文档工作区有容器→宿主机翻译，**项目代码目录无翻译**——设计遗漏。

## 2. 目标 / 非目标

### 目标
- backend 下发 daemon 的 `root_path` 改为宿主机路径，daemon 零配置直接用作 cwd。
- batch（TaskRunner / prepareWorkspace）+ interactive（session-manager cwd）两条执行路径都修复。
- daemon 自动放行 backend 下发的 root_path（动态 allowed_roots），无需用户手改 config。
- 复用现有 `HOST_PATH_PREFIX` / `CONTAINER_PATH_PREFIX` 配置，不新增 env。

### 非目标
- 不改 `translateSpecRoot`（prompt 的 spec_root 翻译保持，向后兼容）。
- 不改 DB `workspace.root_path` 存储语义（仍是 backend 视角的容器路径，供 backend scanner 用）。
- 不新增 daemon 端 `root_path_map` 翻译（不可移植，`2026-06-22-a1-backend-host-path` 已否决该方向）。
- 不处理 `agent_run_logs.dedup_key` schema 漂移（已由运维 hotfix 修复并记录 quicklog ql-20260626-003）。

## 3. 方案设计（方案 A：backend 下发宿主机路径）

### 3.1 backend：新增 container→host 改写函数
`backend/app/modules/workspace/service.py` 新增 `resolve_root_path_for_daemon(root_path, path_source)`，与现有 `resolve_root_path_for_server`（:82，host→container，给 backend scanner）成对：

```python
def resolve_root_path_for_daemon(root_path: str, path_source: str | None) -> str:
    """Map root_path to a path the daemon process can access on its host.

    daemon-client: root_path 本就在 daemon 机器（宿主机路径），原样返回。
    server-local / 其他: 把 container_path_prefix 替换回 host_path_prefix（逆 _rewrite_path）。
    未配置前缀（裸机部署，容器=宿主机）时原样返回。
    """
    if is_daemon_client_path_source(path_source):
        return root_path
    settings = get_settings()
    host_prefix = settings.host_path_prefix
    container_prefix = settings.container_path_prefix
    if not host_prefix or not container_prefix:
        return root_path
    normalized = root_path.replace("\\", "/").rstrip("/")
    c_norm = container_prefix.replace("\\", "/").rstrip("/") + "/"
    if normalized.startswith(c_norm) or normalized + "/" == c_norm:
        remainder = normalized[len(c_norm.rstrip("/")):]
        if not remainder.startswith("/"):
            remainder = "/" + remainder
        return host_prefix.rstrip("/") + remainder
    return root_path
```

逻辑与 `_rewrite_path`（:53）对称：前者 host→container，本函数 container→host。路径规范化（`\`→`/`、前缀末尾 `/`）沿用 `_rewrite_path` 已验证的跨平台处理。

### 3.2 backend：下发点改写（调用点搜索实证）
所有 backend → daemon 的 `root_path` 下发边界改用 `resolve_root_path_for_daemon`（plan 阶段 grep 实证修正：真正下发点是 `daemon/lease/context.py` 构造的 lease claim payload，不是 placement.py）：

| 位置 | 现状 | 改后 |
|---|---|---|
| `daemon/lease/context.py:240-241` | batch lease claim payload `rootPath`/`root_path` = `lease_meta["root_path"]`（camelCase+snake_case 双写） | 改写成 `resolve_root_path_for_daemon`（需在该函数上下文拿 path_source） |
| `daemon/lease/context.py:72` | interactive lease claim payload `root_path` = `lease_meta.get("cwd") or lease_meta.get("root_path")` | 同上改写 |
| `agent/router.py:268` | execution-context 响应 `root_path=ws_row.root_path` | `resolve_root_path_for_daemon(ws_row.root_path, ws_row.path_source)`（path_source 已可取，router.py:242） |
| `agent/context_builder.py` 的 `--dir "{root_path}"`（:569/:572/:579） | scan/init 命令用原 root_path | 核对执行环境：命令在 daemon 执行则入参改写 |

**不改**（backend 内部消费，保持容器路径）：
- `agent/placement.py:258/484`：写入 `lease.metadata["root_path"]`，被 backend `daemon/run_sync/service.py:766` post_scan_validation 容器内 fs 读 → 保持容器路径。
- `agent/service.py:1283`：`resolve_root_path_for_server`（backend 容器内 fs 验证）。
- `daemon/run_sync/service.py:766`：backend post_scan_validation（容器内）。

> 边界判定：`root_path` 字段在 backend→daemon 的出口（context.py claim payload + execution-context 响应）改写；在 backend 内部（lease.metadata 存储 + post_scan）保持容器路径。这样 backend 与 daemon 各自拿到本机可访问的路径，互不干扰。

### 3.3 daemon：自动放行 allowed_roots
daemon 收到 lease/session 的宿主机 `root_path` 后，在执行前动态加入运行时白名单。新增 helper（建议放 `sillyhub-daemon/src/workspace.ts` 或独立的 path-guard 模块）：

```ts
// 伪代码：lease/session 执行入口调用
ensureAllowedRoot(rootPath); // 把宿主机 rootPath 加入运行时 allowed_roots（覆盖 config 静态值）
```

调用点：
- `task-runner.ts:323` prepareWorkspace 前（batch）。
- `daemon.ts:2114` interactive cwd 赋值前。

config 静态 `allowed_roots`（`config.ts`）不动，作兜底；运行时白名单在进程内追加 backend 下发的可信 root_path。安全性依据：root_path 来自 backend 鉴权下发的 lease/session，视为可信。

### 3.4 daemon：prepareWorkspace / cwd 不改逻辑
收到宿主机路径后现有逻辑自动正确：
- `workspace.ts:137` 分支0 `statSync(宿主机路径)` → 成功 → 直接用作 cwd（跳过 mirror clone）。
- `daemon.ts:2114` `cwd = execPayload.rootPath` → 宿主机路径，CC 在项目根执行。

### 3.5 配置
`deploy/.env`（已有）：`HOST_PATH_PREFIX=F:/`、`CONTAINER_PATH_PREFIX=/host-projects`，经 docker-compose `environment` 注入 backend 容器。本次**复用，不新增 env**。未配置时（`host_path_prefix`/`container_path_prefix` 都空）改写函数原样返回 → 裸机部署（backend 直跑宿主机，容器=宿主机路径）兼容。

## 4. 决策记录

### D-001@v1: root_path 翻译放 backend 端（方案 A）
- type: architecture / status: accepted / source: code+user
- question: root_path 容器→宿主机翻译放哪端？
- answer: backend 端。下发 daemon 时用 `resolve_root_path_for_daemon` 把容器路径改写成宿主机路径。
- normalized_requirement: 所有 backend→daemon 的 root_path 下发点（§3.2 表）用 `resolve_root_path_for_daemon(root_path, path_source)`；server-local 走 container→host，daemon-client 原样透传。
- impacts: workspace/service.py 新增函数；agent/router.py + placement.py + context_builder.py 改下发点。
- evidence: workspace/service.py:53-93 `_rewrite_path`/`resolve_root_path_for_server`；agent/router.py:268；a1-backend-host-path 方案 B 依据。

### D-002@v1: daemon 自动放行 allowed_roots
- type: architecture / status: superseded / source: user+code
- question: daemon allowed_roots 不含项目路径，CC 即使 cwd 对也访问不了，怎么处理？
- answer（原 brainstorm 假设）: daemon 收到 backend 下发的宿主机 root_path 后，动态加入运行时 allowed_roots，零配置。
- **execute 阶段澄清（superseded）**: grep 实证 daemon `allowed_roots`（`assertWithinAllowedRoots`, `file-rpc.ts:66`）**只用于 `list_dir` RPC**（`daemon.ts:1710`），**不管 CC 执行的 cwd/文件访问**。CC 的 cwd 由 `prepareWorkspace` statSync 决定（`task-runner.ts:323` 分支0），访问文件走 OS 权限。因此 task-01~04（backend 下发宿主机 root_path）已足以修复 CC 执行；task-05（ensureAllowedRoot）非本次 CC bug 必需，**用户确认跳过**。task-05 的价值仅在 `list_dir` RPC 浏览项目目录放行（独立场景，本次不实现）。
- risk: 若未来前端用 `list_dir` RPC 浏览项目目录且 allowed_roots 不含 → 仍需实现 task-05。本次不阻塞。
- evidence: `file-rpc.ts:66`、`daemon.ts:1710`、`task-runner.ts:323`。

### D-003@v1: batch + interactive 两路径都覆盖
- type: boundary / status: accepted / source: user
- question: 覆盖哪些执行模式？
- answer: batch（prepareWorkspace/TaskRunner）+ interactive（session-manager cwd）都改。
- normalized_requirement: workspace.ts prepareWorkspace 入口 + daemon.ts interactive 执行入口都收到宿主机路径 + 自动放行。
- impacts: workspace.ts + daemon.ts + task-runner.ts。

### D-004@v1: 不新增 daemon 端 root_path 翻译
- type: compatibility / status: accepted / source: code
- question: 是否保留/新增 daemon 端翻译作兜底？
- answer: 不新增。现有 `translateSpecRoot`（prompt 的 spec_root）保留不动；root_path 不加 daemon 翻译（避免不可移植）。新 daemon 直接用 backend 下发的宿主机路径。
- risk: 旧 daemon（未升级 allowed_roots 自动放行）收到宿主机路径但仍被 allowed_roots 拦 → 需 daemon 升级（同变更交付）。

## 5. 文件变更清单

### backend（Python）
- `backend/app/modules/workspace/service.py`：新增 `resolve_root_path_for_daemon`（§3.1）+ 单测（server-local 改写、daemon-client 原样、裸机未配置原样、Windows `\` 规范化）。
- `backend/app/modules/daemon/lease/context.py`：:72（interactive）+ :240-241（batch，rootPath/root_path 双写）lease claim payload 的 root_path 改写（需在上下文拿 path_source）。
- `backend/app/modules/agent/router.py`：:268 execution-context 响应 root_path 改写（path_source :242 已可取）。
- `backend/app/modules/agent/context_builder.py`：核对 scan/init 命令 `--dir`（:569/:572/:579）root_path 入参，daemon 执行则改写。
- `backend/app/modules/agent/service.py`：核对 build_scan_bundle 调用（:1333/:1399）传给 context_builder 的 root_path 入参。
- **不改**：`agent/placement.py:258/484`（lease.metadata 供 backend `run_sync/service.py:766` 内部读）、`agent/service.py:1283`（resolve_root_path_for_server）、`run_sync/service.py:766`（post_scan 容器内）。

### sillyhub-daemon（TypeScript）
- `sillyhub-daemon/src/workspace.ts` 或新 `path-guard.ts`：新增 `ensureAllowedRoot`。
- `sillyhub-daemon/src/task-runner.ts`：:323 prepareWorkspace 前调用 ensureAllowedRoot。
- `sillyhub-daemon/src/daemon.ts`：:2114 interactive cwd 前调用 ensureAllowedRoot。
- 测试：`sillyhub-daemon` vitest 加 ensureAllowedRoot 单测（动态白名单追加、config 静态不动）。

### deploy
- 无改动（复用现有 HOST_PATH_PREFIX / CONTAINER_PATH_PREFIX）。

## 6. 生命周期契约表（lease + session）

本次**不新增生命周期事件、不改变状态机**，仅改 `root_path` 字段在现有事件 payload 中的取值（backend→daemon 边界：容器路径→宿主机路径）。下方矩阵列出 lease（batch）与 session（interactive）的完整事件×状态及 root_path 流转点。

### 6.1 lease（batch）状态机 × 事件
状态：`pending` → `claimed` → `started` → `completed` / `expired` / `cancelled`

| 事件 | 方向 | 状态转换 | payload 含 root_path？ | 改写点 |
|---|---|---|---|---|
| lease 创建（metadata） | backend→DB | (init)→pending | 是：`metadata["root_path"]`（placement.py:258/484） | **不改写**（backend `run_sync:766` 内部读，保持容器路径） |
| lease claim（payload） | backend→daemon | pending→claimed | 是：claim payload rootPath/root_path（context.py:72 / :240-241） | **container→host**（resolve_root_path_for_daemon） |
| execution-context | backend→daemon | claimed（查询） | 是：response.root_path=ws_row.root_path（router.py:268） | **container→host** |
| lease start | daemon→backend | claimed→started | 否 | — |
| lease messages | daemon→backend | started | 否（messages） | — |
| lease complete | daemon→backend | started→completed | 否 | — |
| expire/cancel | backend/超时 | →expired/cancelled | 否 | — |

daemon 收到 claim + execution-context 后：`prepareWorkspace(rootPath)` statSync 宿主机路径成功→用作 cwd；`ensureAllowedRoot(rootPath)` 动态放行。

### 6.2 session（interactive）状态机 × 事件
状态：`active` → `ended`（含 inject/interrupt 中间控制）

| 事件 | 方向 | 状态转换 | payload 含 root_path？ | 改写点 |
|---|---|---|---|---|
| session create | backend→daemon（send_session_control） | (init)→active | 是：execPayload.rootPath（daemon.ts:2114） | **container→host**（backend 构造 execPayload 时） |
| session inject/interrupt | daemon/backend | active | 否（控制指令） | — |
| session end | daemon→backend | active→ended | 否 | — |
| recover（重启收敛） | daemon→backend | crashed→active/ended | 否 | — |

daemon 收到 session create 后：`cwd = execPayload.rootPath`（宿主机路径）；`ensureAllowedRoot(rootPath)` 动态放行。

### 6.3 字段契约
- `root_path` 字段语义不变（仍是 workspace 项目根），仅在 backend→daemon 边界取值改写为宿主机路径。
- backend 自身容器内 fs 访问（scan_docs/knowledge/task）仍走 `resolve_root_path_for_server`（host→container），独立路径，不受影响。
- `daemon-client` workspace：root_path 本就是宿主机路径，`resolve_root_path_for_daemon` 原样透传，不参与改写。
- 无新 DTO 字段、无新事件。

## 7. 验收标准

1. **batch lease 执行**：变更中心触发 agent 执行，daemon terminal.log header `cwd=F:\WorkNew\SillyHub`（或规范化等价），CC `find scan-docs/page.tsx` 命中，run 正常完成不再 cancelled。
2. **interactive session**：对话模式触发，daemon cwd 同样是项目根，CC 能读源码。
3. **daemon-client workspace**：root_path 原样透传，行为不变（回归）。
4. **daemon allowed_roots**：执行期间运行时白名单含本次 root_path（日志可观察），config 静态值不变。
5. **裸机兼容**：`HOST_PATH_PREFIX`/`CONTAINER_PATH_PREFIX` 都未配置时，改写函数原样返回，backend 直跑宿主机场景不受影响。
6. **不回归**：backend scan_docs/knowledge/task 等容器内 fs 访问仍走 `resolve_root_path_for_server`，行为不变。
7. **单测**：`resolve_root_path_for_daemon` + `ensureAllowedRoot` 单测全过。

## 8. 兼容策略（brownfield）

- **回退路径**：改写函数在未配置前缀或 path_source 不匹配时原样返回，等同于现状。出问题可临时清空 `HOST_PATH_PREFIX`/`CONTAINER_PATH_PREFIX` 回退到旧行为（backend scanner 会受影响，仅作紧急回退）。
- **旧 daemon**：未升级 ensureAllowedRoot 的 daemon 仍会被 allowed_roots 拦。要求 daemon 与 backend 同步升级（同变更交付，daemon 分发物 rebuild）。
- **数据**：无 DB schema 变更、无数据迁移。

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| context_builder --dir 改写影响 scan 命令在容器内执行的旧路径 | 核对 build_scan_bundle 调用方：仅「命令在 daemon 执行」时改写，容器内执行不改。execute 阶段逐调用点确认 |
| daemon 自动放行放宽安全边界 | root_path 来源是 backend 鉴权下发的 lease/session，视为可信；运行时白名单仅进程内、不落盘 |
| Windows 路径前缀匹配边界（盘符 `F:` vs `F:/`） | 沿用 `_rewrite_path` 已验证的 `\`→`/` + rstrip('/') 规范化，单测覆盖 |
| placement.py 拿不到 path_source | execute 阶段确认 placement 上下文是否带 ws.path_source，必要时从 workspace 行补查 |
| 旧 daemon 不兼容 | 同变更交付 daemon 升级；文档说明 |

## 10. Design Grill 查证与 execute 确认项

### Grill 已查证（无矛盾）
- **root_path 下发消费方都是 daemon**：`ExecutionContextResponse`（router.py:268，execution-context 端点，daemon 领取 lease 后调用）+ `lease.metadata`（placement.py:258，daemon claim 时读）两处消费方都是 daemon。backend 自身容器内 fs 访问走 `resolve_root_path_for_server(ws_row.root_path)`（独立路径，router.py:268 取 `ws_row.root_path` 而非 `lease_meta`），改写 daemon 下发值不冲突。
- **router.py:268 path_source 已可获取**：router.py:242 `path_source = ws_row.path_source if ws_row else "server-local"`，改写时直接用，无需补查。

### execute 阶段仍需确认
- `agent/placement.py:258/484` 函数签名能否拿到 `path_source`（router 已证明可从 ws_row 取；placement 上下文待确认，必要时补查 workspace 行）。
- `agent/context_builder.py` 的 `--dir` 命令实际执行环境（daemon vs 容器内）——影响是否改写。
- `agent/service.py:1333/1399` build_scan_bundle 的 root_path 入参来源——确认是否容器路径。

## 11. 自审

按 brainstorm step 11 检查项：
- ✅ 需求覆盖：根因（容器路径透传）+ 目标（backend 下发宿主机路径 + daemon 自动放行 + 双路径）+ 用户三决策（D-001~003）全覆盖。
- ✅ Grill 覆盖：design 引用 D-001~D-004 全部当前版本决策。
- ✅ 约束一致性：跨平台沿用 `_rewrite_path` 规范化；复用 CONVENTIONS/ARCHITECTURE 的 env 配置模式。
- ✅ 真实性：文件路径/函数名/行号均来自排查实证（workspace/service.py:53/82、router.py:268/242、placement.py:258/484、daemon.ts:179/2114、workspace.ts:137、config.ts spec_root_map）。
- ✅ YAGNI：不新增 env/daemon 翻译/DB 改动/DTO 字段。
- ✅ 验收标准：§7 七条可测试。
- ✅ 非目标清晰：§2。
- ✅ 兼容策略：§8 回退路径 + 旧 daemon 升级。
- ✅ 风险识别：§9。
- ✅ 生命周期契约表：§6（lease + session 事件×状态矩阵）。
