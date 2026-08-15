---
author: qinyi
created_at: 2026-08-15T15:07:51
change: 2026-08-15-init-trigger-sillyspec-init
stage: brainstorm
status: draft
scale: large
risk_level: integration-tested
revision: 2
---

# 设计文档 — init lease 触发 sillyspec init

## 背景与目标

平台工作区"初始化"（init lease）当前为纯文件/HTTP 编排（`handleInitLease` 5 步：写状态文件 → pullSpecBundle → postSpecSync → writeLocalYaml），不执行 `sillyspec init` 命令。后果：成员本地项目目录缺少 `.sillyspec-platform.json` 平台指针、CLAUDE.md/AGENTS.md 等指令注入、spec 目录骨架。sillyspec CLI 侧平台模式参数（`--workspace-id` / `--spec-dir` + `writeInitPlatformPointer`）已就绪但无人调用。

**目标**：daemon 在 init lease 编排中，以平台模式参数 spawn `sillyspec init` 子进程，让本地项目真正获得 init 应有产物；失败语义对齐 D-003 先例（硬失败 = lease failed）。

**非目标（Non-Goals）**：
- 不改 backend lease 契约（`mode=init` metadata、claim payload 结构均不变）
- 不动 daemon 现有 skills 分发链路（skill-manager 仍是唯一 skills 渠道）
- 不动 gate verify 命令白名单（本变更不放开 daemon 任意命令执行）
- 不处理 init lease 之外的扫描/会话流程

（rev2 注：原"backend 零变更"非目标已按 D-008@v2 解除——增量同步 add 同 hash no-op 化属 backend 配套小改。）

## 决策记录

| ID | 决策 | 依据 |
|---|---|---|
| D-001@v1 | 驱动方式 = daemon spawn CLI 子进程（方案A） | 单一真相源；版本随 preflight 自动升级；否决 B（耦合 CLI 内部 ESM/CJS 混合结构）、C（重演 2026-07-07 双写漂移教训） |
| D-002@v2 | 插入位置 = pullSpecBundle **之后**、postSpecSync 之前 | rev1 的"pull 之前"被 Grill P0 否决：pullSpecBundle 是整删重建（spec-sync.ts:191-196 先 `rm -rf specDir` 再解包），pull 前 init 的骨架会被 pull 物理删除，`.runtime/`（sillyspec.db 等）不在 bundle 中无法恢复。后置则骨架免于删除，且 postSpecSync（其后执行）把骨架回传服务器 |
| D-003@v1 | init 失败 = 硬失败，lease 终态 failed | 对齐 2026-08-12-init-provision-local-yaml D-003 先例；init 产物是核心目的而非锦上添花 |
| D-004@v1 | skills 只走 skill-manager，init 跳过 skills 复制 | 用户决策：避免双渠道版本漂移；CLI 侧加 `--no-skills` 开关 |
| D-005@v1 | 目标工具 = daemon agent-detector 检测结果映射 | 用户决策；Grill 核实 agent-detector 12 provider 与 sillyspec VALID_TOOLS 6 值全部同名可映射，空兜底 claude 与 sillyspec detectTools 行为一致 |
| D-006@v1 | 超时 60s，超时按失败处理 | init 纯本地 fs+SQLite 无网络，60s 充裕 |
| D-007@v1 | tools 透传 = TaskRunner 构造注入 | Grill P1：detectAgents 结果存 `Daemon._agentPaths`（私有）；创建点在 **cli.ts**（`new TaskRunner` 唯一处）且 detectAgents 在 `Daemon.start()` 晚于构造 → cli.ts 构造前先跑一次 detectAgents（或复用 detector 静态探测）映射后传入；缺省 undefined → 兜底 ['claude'] |
| D-008@v2 | init 骨架多成员冲突 = backend 增量 add 同 hash no-op 化 | 用户决策（Grill P0/P1 修法 a）：backend `apply_ops` 冲突分支增加"content_hash 相同 → 跳过不落盘且**不算 conflict**"豁免；否则第二成员的骨架文件 add(base_version=0) 对服务器已有行必 conflict。同时 `projects/<name>.yaml` 携带成员机器绝对路径（互异必冲突），daemon 侧增量排除该路径不回传 |
| D-009@v1 | spawn 前版本门控 | 用户决策（Grill P1）：老 CLI 静默忽略 `--no-skills` 且 exit 0（未知 flag 落 filteredArgs 不报错），且 preflight 仅 daemon 启动跑一次，长驻 daemon 不自愈 → spawn 前先跑 `sillyspec --version`（3s 超时），低于最小版本（含 --no-skills/--tool 多值的 CLI 版本号，常量集中定义）即 fail-fast，错误信息中文提示"重启 daemon 或 npm install -g sillyspec@latest" |

## 方案设计

### 1. CLI 侧前置改动（sillyspec 仓，先发版）

**(a) `--no-skills` 开关**：`src/index.js` 参数解析新增 `--no-skills`（布尔），透传 `cmdInit(dir, { ..., noSkills })`；`src/init.js` `doInstall` 读取后跳过"复制 skills 到各工具目录"整段（指令注入不受影响）。

**(b) `--tool` 多值**：`src/index.js` 解析 `--tool claude,codex` 逗号分隔（兼容重复 `--tool`），`cmdInit` 展开后逐一过 `VALID_TOOLS` 校验。

**(c) 平台模式跳过项目内 `.sillyspec/` 清理**（R-05，复核 N-02 收口）：`doInstall` 对外部 specDir 的"清理旧残留"段（含无资产分支的 `rmSync(legacyDir)` 整删与 `cleanupRuntimeResidue`）在平台模式（platformOpts 非空）时**整体跳过**——平台成员的项目内 `.sillyspec/` 通常只有 local.yaml（changes/projects/db 都在外部 specCacheRoot），任何清理都会连带删掉平台第 5 步写入的 local.yaml（含用户手调 mcp 段）。

发版顺序：CLI 先发；daemon `MIN_SILLYSPEC_VERSION_FOR_INIT` 常量记录该版本号（D-009 门控比对用）。

### 2. daemon 侧编排（sillyhub-daemon 仓）

`spec-sync.ts` 新增 `runSillyspecInit(params)`：

```
步骤 0：版本门控（D-009）
  spawn('sillyspec --version')（shell:true 范式，对齐 preflight.ts:399；3s 超时）
  版本 < MIN_SILLYSPEC_VERSION_FOR_INIT → return ok:false, error=sillyspec_init_cli_too_old
步骤 1：spawn init（60s 超时，D-006）
  sillyspec init
    --dir <rootPath>              // 成员本地项目根（targetDir）
    --spec-dir <specCacheRoot>    // ~/.sillyhub/daemon/specs/<wsId>（外部规范目录）
    --workspace-id <wsId>         // 平台模式信号 → writeInitPlatformPointer 落指针（status:active）
    --no-skills                   // D-004
    --tool <tools.join(',')}      // D-005/D-007
  spawn 用 shell:true + 超时杀树（对齐 preflight runWithTreeKill 范式在 spec-sync 侧实现；
  bare name spawn 在 Windows 必 ENOENT，shell:true 解决路径定位，无需 resolveWindowsCmdShim）
退出码 0 = 成功；非 0 / 超时 / spawn 失败 = ok:false（error 前缀 sillyspec_init_failed:）
```

`handleInitLease` 编排变为 6 步（rev2 时序，D-002@v2）：

1. writeDaemonState（不变，硬失败 abort）
2. pullSpecBundle（不变，硬失败 abort；**整删重建语义保留**——bundle 为权威内容）
3. **runSillyspecInit（新增，硬失败 abort，D-003）**
4. postSpecSync（不变，软失败 warn；此时把 init 新增骨架经增量 diff 回传服务器）
5. writeLocalYaml（不变，硬失败 abort）

**`.runtime` 兜底（rev2）**：pull 整删重建后 init 在 pull 之后的 specCacheRoot 上重建 `.runtime/`（init 的 doInstall 会建 `.runtime/{artifacts,history,logs,templates}` + sillyspec.db），骨架完整。

工具列表来源（D-007）：`Daemon` 启动 `detectAgents` 后映射 VALID_TOOLS（agent-detector 12 provider 与 VALID_TOOLS 6 值同名交集）→ 创建 TaskRunner 时构造注入 `detectedAgents`；`_runInitLease` 读 ctx 无该字段（旧调用方/测试）→ 兜底 `['claude']`。

### 3. backend 配套改动（D-008@v2）

`spec_workspace/service.py` `apply_ops` 冲突分支（:1105-1111）修改：

```python
# 原：row is not None and row.version != op.base_version → conflict
# 新：版本不匹配时，若 op.hash 非空且 == row.content_hash → 同内容 no-op（不落盘、不 conflict，回 new_versions[path]=row.version 让 daemon 对齐 manifest）
#     否则维持 conflict
```

`FileOp.hash` 字段已存在（schema.py:98），daemon 增量 push 的 add op 已带 `hash`（spec-sync.ts:689），后端只加比对，契约零变更。

**daemon 侧配套（复核 N-01 收口）**：`projects/` 排除须**三处统一**——`computeIncrementalOps` 的 walkDir、`buildFullManifest`（全量快照缓存）、`packSpecDir`（回退 tar 打包）的排除清单都加 `projects` 前缀。只加增量排除会导致：全量回退路径照样上传绝对路径文件；且全量缓存含 projects/ 行而增量 walk 无 → 生成 delete op 误删服务器行。

### 4. 时序与一致性（rev2）

- pull 整删重建（bundle 权威内容落地）→ init 建骨架/写指针/注入指令（项目根 + specCacheRoot）→ postSpecSync 增量 diff 把骨架新文件（add op，含 hash）回传 → 同内容 no-op（D-008@v2）或新建 version=1。
- `.sillyspec-platform.json` 由 init 的 `writeInitPlatformPointer` 落盘（sillyspec 独占写入，符合 2026-07-07 D-001@v1）。
- 第二成员加入已扫描工作区：pull 拉到权威文档 → init 补骨架+指针+指令 → postSync 骨架 add 命中服务器已有行 → 同 hash no-op 不冲突；`projects/` 已排除。

### 5. 幂等性

- init 各步骤本身幂等（existsSync 跳过 / CLAUDE.md 版本感知三态注入）。
- 重复 init lease：pull 整删后 init 重建，无害；writeLocalYaml 幂等（platform 段覆盖 / mcp 段保留）。
- **注意（R-05）**：sillyspec `doInstall` 对外部 specDir 会清理项目内旧 `.sillyspec/` 残留（有真实资产保护）；平台模式下 `local.yaml` 在清理白名单里会被删后由第 5 步重写——CLI 改动 (c) 已堵此洞（no-skills 时跳过删 local.yaml）。

### 6. 与 preflight 版本机制的衔接

preflight 仅 daemon 启动跑一次 → D-009 运行时门控补位：每次 init lease spawn 前独立比对版本，不依赖 daemon 重启。CLI 过旧时 lease fail-fast，错误信息含升级指引；用户升级后无需重启 daemon（下次 init 门控即通过）。

## 文件变更清单（File Changes）

### sillyspec 仓变更
| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | src/index.js | init 参数解析：--no-skills + --tool 多值 |
| 修改 | src/init.js | cmdInit/doInstall 接 noSkills；平台模式跳过项目内清理段 |
| 新增 | test/init-no-skills.test.mjs | --no-skills 不产生 skills 目录用例 |
| 新增 | test/init-tool-multi.test.mjs | --tool 多值注入/去重/非法值用例 |
| 新增 | test/init-platform-keep-local-yaml.test.mjs | 平台模式保留 local.yaml 用例 |

### main 仓变更
| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/spec-sync.ts | 新增 runSillyspecInit（含版本门控）+ handleInitLease 插入第 3 步 + HandleInitLeaseParams 增 tools + 三处排除加 projects + MIN_SILLYSPEC_VERSION_FOR_INIT 常量 |
| 修改 | sillyhub-daemon/src/task-runner.ts | TaskRunner 构造增可选 detectedAgents；_runInitLease 透传 tools |
| 修改 | sillyhub-daemon/src/cli.ts | 构造 TaskRunner 前 detectAgents 映射并注入（D-007；创建点在 cli.ts 非 daemon.ts） |
| 修改 | sillyhub-daemon/tests/test_init_lease.test.ts | 改写：runSillyspecInit 可注入（既有全局 spawn mock 返 null 会击穿新步骤）；新增成功/失败/门控/顺序用例 |
| 新增 | sillyhub-daemon/tests/run-sillyspec-init.test.ts | runSillyspecInit 单测（门控/参数/退出码/超时） |
| 修改 | sillyhub-daemon/tests/spec-sync-incremental.test.ts | projects/ 排除 + 缓存残留不生 delete op 用例 |
| 修改 | backend/app/modules/spec_workspace/service.py | apply_ops 冲突分支同 hash no-op（D-008@v2） |
| 新增 | backend/app/modules/spec_workspace/tests/test_apply_ops_same_hash_noop.py | 同 hash no-op / 异 hash 仍 conflict 用例 |

**不改动**：前端（初始化 UI/轮询不变）、lease metadata/claim payload 契约、tests/spec-sync.test.ts（无 projects fixture 不受影响，task-07 仅按需补用例）。

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| init lease dispatch（不变） | backend | daemon | mode=init, workspace_id, root_path | lease pending → claimed |
| init lease claim（不变） | daemon | backend | claim_token | lease claimed + token 注入 payload |
| init lease complete（不变） | daemon | backend | stats.init_synced_at / init_synced_spec_version | WorkspaceMemberRuntime.init_synced_* 回写；失败路径 stats.init_error 新增前缀 sillyspec_init_failed: / sillyspec_init_cli_too_old |
| 增量同步 apply_ops（语义微调） | daemon | backend | ops[].hash 参与冲突比对 | 同 hash no-op 不再置 conflict=true；其余不变 |

（lease/heartbeat/claim 对外契约零变更；apply_ops 是幂等语义收紧——原必 conflict 的同内容 add 变 no-op，旧 daemon 不传 hash 时行为不变。）

## 风险登记（Risk Register）

| 风险 | 等级 | 缓解 |
|---|---|---|
| R-01 CLI 未发版先部署 daemon | 中 | D-009 版本门控 fail-fast + 中文升级指引；发版顺序约束（CLI 先） |
| R-02 Windows spawn 路径/shim | 低 | shell:true + 超时杀树（preflight 已验证范式），tests 覆盖 |
| R-03 doInstall 清理项目内旧 .sillyspec 误伤 | 低 | 已有真实资产保护（changes/projects/sillyspec.db 拒绝整删）；R-05 补 local.yaml 洞 |
| R-04 agent-detector 映射不全 | 低 | 兜底 ['claude']；映射表集中一处 |
| R-05 re-init 删 local.yaml 丢手调 mcp 段 | 中 | CLI 改动 (c)：平台模式整体跳过项目内 .sillyspec 清理段（覆盖无资产整删分支）；vitest/CLI 测试断言 |
| R-06 超时 kill 不彻底留孤儿 | 低 | shell:true + tree-kill 范式 |
| R-07 backend no-op 豁免被滥用（异内容伪装同 hash） | 低 | no-op 仅当 op.hash == row.content_hash（内容相同无害）；daemon hash 为 sha256 不可伪造内容 |
| R-08 pull 后 init 失败时已 pull 内容残留（部分状态） | 低 | lease failed 引导重试；重试 pull 幂等重建，init 重新跑 |
| R-09 projects/ 排除后服务器清单无该目录 | 低 | 该文件仅本地寻址用（相对 specDir），服务器不需要；三处排除统一（N-01）防全量路径漏传与 delete op 误删 |

## 测试策略

- **单元（sillyhub-daemon vitest）**：runSillyspecInit 版本门控（过旧 fail-fast / 通过放行）、spawn 参数组装（flag 顺序/--no-skills/--tool 逗号）、退出码/超时映射；handleInitLease 6 步顺序（init 在 pull 后 postSync 前）+ init 失败 abort writeLocalYaml 不执行；_runInitLease tools 透传与兜底。改写既有全局 spawn mock（runSillyspecInit 依赖注入）。
- **单元（sillyspec 仓）**：--no-skills 跳过 skills 复制、--tool 多值校验、平台模式 no-skills 不删 local.yaml。
- **单元（backend pytest）**：apply_ops 同 hash 版本不匹配 → no-op 不 conflict；异 hash → 仍 conflict；不传 hash（旧 daemon）→ 行为不变。
- **集成**：本机真实 daemon 手动 init lease 走通（首成员：rootPath 出现 .sillyspec-platform.json + CLAUDE.md，specCacheRoot 出现骨架，服务器收到骨架 no-op/新建）；第二成员场景：骨架 add 全 no-op 无 conflict。
- **回归**：test_init_lease.test.ts 改写后全绿；spec-sync-incremental 12 用例全绿；backend spec_workspace 既有用例全绿。

## 自审（Self-Review）

- ✅ D-002@v2 后置时序与 pull 整删重建语义自洽（Grill X-01 闭合）：骨架建于 pull 之后不被删，`.runtime` 由 init 重建。
- ✅ Grill X-02/X-16 闭合：同 hash no-op（backend）+ projects/ 排除（daemon）。
- ✅ Grill X-03 闭合：D-007 wiring 指定（创建点实为 cli.ts，构造前探测；文件清单已更正）。
- ✅ Grill X-05/X-06 闭合：spawn 机制明确为 shell:true + tree-kill，不用未导出的 runWithTreeKill、无需 shim。
- ✅ Grill X-09/X-10 闭合：D-009 运行时版本门控，不依赖 daemon 重启。
- ✅ Grill X-14 闭合：测试策略如实改写（既有 mock 必红，runSillyspecInit 可注入）。
- ✅ Grill X-15 闭合：R-05 + CLI 改动 (c) 平台模式整体跳过项目内清理段（复核 N-02：无资产整删分支一并覆盖）。
- ✅ 复核 N-01 闭合：projects/ 三处排除统一（增量/全量缓存/tar 回退），防 delete op 误删。
- ✅ 与 D-001@v1（platform-json sillyspec 独占）一致；skill-manager 分工清晰；lease 契约零变更。
- ⚠️ 已知限制：跨仓发版顺序依赖（CLI 先发）——D-009 门控把静默漂移变成显式失败，风险受控。
