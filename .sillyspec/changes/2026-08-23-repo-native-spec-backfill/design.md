---
author: qinyi
created_at: 2026-08-23T13:35:00Z
scale: large
change: 2026-08-23-repo-native-spec-backfill
---

# 设计：修复 repo-native 工作区 spec 回灌断链

## 背景

repo-native 工作区（源项目 `.sillyspec` 为唯一真理源，daemon 建 junction 缓存指回源项目）当前存在断链：

1. backend `build_scan_bundle`（`backend/app/modules/agent/context_builder.py:354-479`）对**所有策略**无条件注入 `--spec-root ~/.sillyhub/daemon/specs/{ws}` 等平台参数；agent 在源项目根执行该命令后，sillyspec CLI 在项目根写下 `.sillyspec-platform.json` 指针（specRoot = daemon junction 路径）与 `.sillyspec-platform-managed` 接管声明。
2. CLI 一旦检测到指针/平台参数即进入平台模式：`run/shared.js:534-536`（triggerSync 内"平台模式走自己的回传链路"跳过，四处裸判定位于 536/609/631/698）显式跳过内置 sync，`run/command.js:309-345` 每条 run 命令从指针恢复平台模式，`:349-359` 接管声明 fail-closed（指针缺失时拒绝回退本地模式，exit 1）。
3. 平台侧回灌（daemon postSpecSync 整树 tar）仅三触发点：tar 模式平台交互会话结束、前端手动「同步到服务器」按钮（outbox kind=spec-sync）、pull 前回灌（D-008）——repo-native junction 早退永不 pull，本地 agent 会话（无平台 lease）无会话结束钩子。

三边叠加：本地 agent 会话产生的变更（实例：`2026-08-23-agent-log-conversation-view`）无任何上行通道，平台变更中心（backend reparse 读服务器镜像 spec_root）看不到。stage 派发（`service.py:1358`）已有 `strategy == "platform-managed"` 门禁，与 scan 的无条件注入不对称——本变更消除该不对称并为 CLI 补防御。

注意：scan 模板的 is_platform_mode 分支判定 `bool(spec_root)` 中 spec_root 为 backend 入参容器路径，与 prompt 注入的宿主路径是双轨（D-006@2026-07-10），本设计只改 prompt 模板分支，不动 bundle.spec_root / platform_metadata.spec_root 双轨语义。

## 设计目标

1. repo-native 工作区的 scan prompt 不含任何平台参数与 init 步骤，agent 本地执行 CLI 处于本地模式，内置 sync（local.yaml platform 凭据 + resolve-by-root-path）自动上行变更到平台变更中心。
2. CLI 对"自指指针"（specRoot 经 realpath 解析回项目自身 `.sillyspec`，即 daemon junction 回环）免疫：不写入、不恢复、不因之禁用内置 sync、不因陈旧接管声明阻断本地模式。
3. platform-managed / repo-mirrored 行为逐字节不变（D-002@v1）。

## 非目标

- daemon 侧代码改动与第四回灌触发点（D-003@v1，后续变更）。
- stage 派发门禁调整（D-004@v1，repo-mirrored 差异保留）。
- repo-native 源项目 `.sillyspec` 缺失时 daemon 降级 repo-mirrored 的分歧场景治理（既有降级语义，仅风险登记）。
- 已中毒项目的批量清理工具（本次仅清理本仓库现场；其它项目靠 CLI realpath 免疫自动失效，见 Phase 2 语义）。

## 总体方案

### Phase 1｜backend：scan 注入 strategy 门禁（D-001@v1）

`build_scan_bundle` 增读 SpecWorkspace.strategy（与 service.py scan dispatch 读法一致，回退 platform-managed），模板三分支：

- **platform-managed / repo-mirrored**：现有 `is_platform_mode` 平台模板原样保留（含 init 跳过、全平台参数、"文档生成在 {host_spec_root}/docs/（扁平布局）"规则文案）。
- **repo-native**：新本地模板——
  - 无 init 步骤（源项目必有 `.sillyspec`；且本地 init 残留清理有删 local.yaml 平台凭据的已知坑，见 git 72f153fb）；
  - `scan_start_cmd = sillyspec run scan --dir "{root_path}"`（零平台参数）；
  - done 命令同现状（本就不带平台参数）；
  - 规则文案：文档生成在源码目录 `.sillyspec/` 下；CLI 自动经 local.yaml 凭据同步到平台，无需手动操作；其余规则（AskUserQuestion 门禁、逐步 done）沿用。

`render_bundle_to_claude_md`（`context_builder.py:568`）的 sillyspec 工具提示硬编码 `--spec-root <spec_root>`，改为中性表述（"按会话 prompt 模板的参数执行 scan；未给平台参数时不自行添加"），不再误导本地模式。

### Phase 2｜工具仓 CLI（/Users/qinyi/Desktop/sillyspec）：指针生命周期 realpath 回环判定（D-001@v1）

新共享判定（`src/run/shared.js`，init.js 经既有惰性 require 复用）：

```
isSelfReferentialSpecRoot(cwd, specRoot): boolean
  // 双方 fs.realpathSync（native，junction/symlink 跨平台穿透）后严格相等 → true；
  // 任一路径不存在/realpath 抛错 → false（按外部目录处理，保守不干预）。

isPlatformMode(platformOpts, cwd): boolean
  // (platformOpts.specRoot || platformOpts.runtimeRoot) && !isSelfReferentialSpecRoot(cwd, platformOpts.specRoot)
```

四个消费点统一接入：

1. **指针恢复**（`run/command.js:309-345`）：读到指针后若 specRoot 自指 → 忽略指针（platformOpts 置空，本地模式）+ warn 一行（"检测到自指平台指针（repo-native junction 回环），已忽略并按本地模式运行"）。runtimeRoot 落在 specRoot 内，自指判定以 specRoot 为准即可覆盖。
2. **指针写入**（`run/command.js` 尾部 `writePlatformPointer` 调用 + `init.js writeInitPlatformPointer` 的 isExternalSpec 判定）：写入前过 isPlatformMode；`init.js` 的词法 `resolve()` 比较补 realpath（junction 不再被误判外部目录）。显式 flag 传入自指 specRoot（平台会话旧模板/存量脚本）同样跳过写入。
3. **平台模式门禁收敛**（`shared.js` 四处 `platformOpts?.specRoot || platformOpts?.runtimeRoot`：triggerSync / triggerPull / triggerPullActiveChange / 第四处 null 返回）：统一改调 isPlatformMode，自指时内置 sync 与 auto-pull 按本地模式语义运行。specBase 仍取 platformOpts.specRoot（junction 与本地 .sillyspec 同物理目录，行为等价，最小改动）。
4. **接管声明 fail-closed 降级**（`run/command.js:355-369`）：声明存在且指针缺失时，先检查 `decl.specRoot` 是否自指 → 自指视为陈旧声明，warn 并按本地模式继续（不 exit 1）。disconnect 三清语义不变。

附带：`src/doctor-diagnostics.js` 增自指指针/陈旧声明告警条目。发版 3.27.3，全局重装生效（安装产物直接 ship src/，无构建步骤）。

### Phase 3｜现场验证

- 本仓库现场已清理（指针+接管声明已删，local.yaml 凭据保留，CLI 已回本地模式且本变更进度已上行——brainstorm 期间 `[spec-sync] 已同步 63 个文件变更` 实证）。
- verify 阶段复查：活跃平台会话是否重写指针；三策略 scan bundle 快照；CLI 三门禁回归；repo-native 平台会话链路（junction + 会话结束整树回灌）不回归。

## 文件变更清单

本仓 backend：

| 类型 | 文件 | 改动 |
|---|---|---|
| 修改 | `backend/app/modules/agent/context_builder.py` | build_scan_bundle 增 strategy 读取与三分支模板（repo-native 本地模板）；render_bundle_to_claude_md 工具提示中性化 |
| 修改 | `backend/app/modules/agent/tests/test_context_builder.py` | 三策略模板断言：repo-native 无平台参数/无 init/本地文案；platform-managed/repo-mirrored 快照不变 |

## sillyspec 仓变更（/Users/qinyi/Desktop/sillyspec，独立提交 + 发版 3.27.3）

- `src/run/shared.js`（新增 isSelfReferentialSpecRoot / isPlatformMode；四处平台模式判定收敛，task-02）
- `src/run/command.js`（指针恢复自指忽略；指针写入过 isPlatformMode；接管声明自指降级，task-03）
- `src/init.js`（writeInitPlatformPointer isExternalSpec 补 realpath，task-03）
- `src/doctor-diagnostics.js`（repo-native 断链画像告警，task-03）
- `test/`（task-02/03 新增测试）
- `package.json`（version 3.27.3，task-04）

## 接口定义

### isSelfReferentialSpecRoot(cwd: string, specRoot?: string|null): boolean
- 语义：specRoot 经 realpath 后与 `join(cwd, '.sillyspec')` realpath 严格相等 → true；specRoot 空/任一路径不存在/realpath 异常 → false。
- 约束：cwd 必须为项目根（与指针查找 `join(cwd, '.sillyspec-platform.json')` 同基准）；子目录运行时指针本就不可见、不进本判定，monorepo 多实例漂移沿用既有提醒链路（countAncestorSpecDirs）。
- 用途：repo-native junction 回环检测（daemon 缓存路径 `~/.sillyhub/daemon/specs/{ws}` → symlink → `<cwd>/.sillyspec`）。

### isPlatformMode(platformOpts: object, cwd: string): boolean
- 语义：`(platformOpts.specRoot || platformOpts.runtimeRoot) && !isSelfReferentialSpecRoot(cwd, platformOpts.specRoot)`。
- 替换 shared.js 四处裸判定；自指 → 本地模式（sync/auto-pull 按本地语义）。

### build_scan_bundle 策略分支（行为契约）
- strategy ∈ {platform-managed（含 SpecWorkspace 缺失回退）, repo-mirrored} → 现平台模板，含 `--spec-root/--runtime-root/--workspace-id/--scan-run-id`，无 init。
- strategy = repo-native → 本地模板：`sillyspec run scan --dir "<root_path>"`，无平台参数，无 init，规则文案声明产物落源码 `.sillyspec/` 且 CLI 自动同步平台。

## 生命周期契约表（repo-native scan lease 流）

| 事件 | 触发 | 处理方 | 本次变更后行为 |
|---|---|---|---|
| scan_lease_created | 用户点扫描 | backend | lease payload 仍带 specStrategy=repo-native / latest_spec_version（daemon 消费，不变）；AgentRun prompt 为本地模板（Phase 1） |
| daemon_pulled | daemon poll | daemon | pullSpecBundle repo-native 分支建/复用 junction（不变） |
| scan_started | agent 执行 | CLI（agent 进程内） | 无平台参数 → 本地模式：specBase=cwd/.sillyspec（经 junction 同物理目录）；不写指针（Phase 2）；auto-pull/内置 sync 本地语义 |
| scan_step_done | 每步 done | CLI | 内置 sync 增量上行（local.yaml 凭据 + resolve-by-root-path 归属 workspace）——断链修复主通道 |
| session_end | 平台会话结束 | daemon | postSpecSync 整树回灌（junction 穿透打包，不变） |
| init_lease（初始化按钮） | 用户 | daemon→CLI | local.yaml 凭据写入不变；platform connect 若写指针 → Phase 2 自指跳过/忽略 |

## 风险登记

1. **修复落地前再中毒**：活跃平台会话（2026-08-23 实测存在，cwd=本仓库）若执行旧模板 scan 会重写指针。缓解：现场已清理 + verify 复查；Phase 2 发版后自指指针自动失效（免疫）。
2. **工具仓发版滞后窗口**：backend 门禁先行生效即停止新中毒；存量中毒项目在 CLI 发版前需手动清理（`rm .sillyspec-platform.json .sillyspec-platform-managed`，保留 local.yaml）。
3. **repo-native 源项目无 .sillyspec 的 daemon 降级**（spec-sync.ts:117-118 降级 repo-mirrored 拉平台 bundle）：backend 模板仍按 DB strategy=repo-native 走本地模式，scan 写 repo 新建 `.sillyspec`，daemon 缓存与之分歧。既有降级即有损（warn 日志），本次不扩大治理，登记待后续。
4. **repo-native 双写者竞态**（审查 P1 补登记）：修复后 repo-native 同时存在 CLI 内置 sync 增量上行（manifest+FileOp，platform_sync 通道）与 daemon 会话结束 postSpecSync 整树回灌（tar 通道，junction 穿透打包）。正常时序下整树打包读的是打包时刻磁盘最新状态，内容收敛；但两通道交错（daemon 长会话快照落后于本地增量）时，tar 整树覆盖可短暂回滚已上行增量的文档内容，且 repo-native junction 早退不享受 D-008 pull 前回灌保护。缓解：本次依赖 apply_ops 单写者与 reparse 收敛（下次增量/整树推送即自愈）；根治（postSpecSync 前置 mtime 比对）与 D-003 同属 daemon 后续变更。
5. **local.yaml platform 凭据缺失静默失败**（审查 P1 补登记）：内置 sync 为 best-effort（凭据缺失静默跳过）。repo-native 成员若从未经 platform connect / init lease 写入凭据，断链依旧且无感知。缓解：task-03 doctor 告警扩为「repo-native 断链画像」（自指指针 / 陈旧声明 / local.yaml platform 段缺失三项齐查）。
6. **D-004@v1 repo-mirrored 双通道并存**：scan 走 daemon 整树回灌、stage 走 CLI 增量上行，整树覆盖与 manifest 增量共存依赖 platform_sync 既有 apply_ops 单写者语义；本次不动，风险登记。
7. **原型跳过**：零 UI 变更（文件清单无前端文件），不生成 prototype-*.html；依据分段展示设计步分级规则。
8. **工具仓测试基建**：test/run-tests.mjs 自有 runner，新增测试需按其注册模式接入（execute 期读 run-tests.mjs 确认）。

## 自审（Self-Review）

- 章节齐全：背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记 ✓；frontmatter author/created_at/scale ✓；引用全部当前版本决策 D-001@v1/D-002@v1/D-003@v1/D-004@v1 ✓；含生命周期契约表（lease/daemon 关键词命中）✓。
- 依据核对：scan 无条件注入（context_builder.py:420 scan_start_cmd 拼接，:413 is_platform_mode=bool(spec_root)）/ stage 门禁（service.py:1358）/ shared.js:486 跳过 / command.js:309-369 恢复+fail-closed / spec-sync.ts:104-119 junction —— 均为本次会话实读源码，非推测。
- 存疑复核（已解除）：① `writePlatformPointer` 全仓仅两调用点——init.js:426（writeInitPlatformPointer，isExternalSpec 判定即 Phase 2 修改点）与 command.js:364（`if (platformOpts.specRoot || platformOpts.runtimeRoot)` 门禁即 Phase 2 修改点），无隐藏第三写入方，四消费点覆盖完整；② `sillyhub-daemon/src/spawn-env.ts` 无 specRoot/SILLYHUB_PLATFORM 类 env 注入，daemon 不经 env 通道触发 CLI 平台模式。
- 规模自检：跨仓 large，brainstorm→plan→execute→verify 完整流程必要 ✓。
