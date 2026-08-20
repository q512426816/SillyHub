---
schema_version: 1
doc_type: design
change_name: 2026-08-20-runtime-readpoint-repo-first
author: qinyi
created_at: 2026-08-20T02:20:00+00:00
scale: large
status: draft
risk_level: medium
dependencies:
  - 2026-08-19-runtime-live-daemon-read
---

# 运行时状态读点修正：优先读成员本机仓库 .sillyspec/.runtime/

## 1. 背景与问题

前序变更 `2026-08-19-runtime-live-daemon-read` 把 `/workspaces/[id]/runtime` 页面的数据源从「平台容器快照」切到「daemon WS RPC 实时读取」，方向正确但**读点选错**：daemon 侧 `RuntimeHandler` 固定读 spec 缓存目录 `~/.sillyhub/daemon/specs/<workspace_id>/`（`specCacheRootFor`）。

该读点在当前执行模型下系统性拿不到数据：

1. **platform-managed 策略下缓存不含 `.runtime/`**。spec bundle 同步在设计上排除整棵 `.runtime/` 子树与 `sillyspec.db`（`spec-sync.ts` `UPLOAD_EXCLUDE_TOP_BASE` 与 pull 方向同构排除）。实测本工作区（b97f8231，multi-agent-platform 自身）缓存目录只有 `ROADMAP.md` + `changes/`。
2. **当前主要执行流（agent 驱动）的数据真源在成员本机仓库**。agent 会话以 `root_path` 为 cwd，按仓库规则直接在仓库跑 sillyspec CLI，运行时产物（`progress.json` / `user-inputs.md` / `artifacts/` / `sillyspec.db`）全部写入 `<root_path>/.sillyspec/.runtime/`。实测该目录数据齐全且持续更新，`progress dump --spec-dir <repo>/.sillyspec --json` 返回完整进度。
3. **缓存里偶有的 `.runtime/` 是历史残留**。本机 20 个工作区缓存中 12 个有 `.runtime/`，但均为 7 月旧执行模型（在缓存里跑 execute）与平台触发 scan 的产物，不代表当前工作流状态。

结果：页面稳定渲染「当前工作区没有运行时数据」空态——不报错、不缺绑定，纯粹读错了地方。

## 2. 设计目标

- **FR-01**：runtime 页四类数据（进度 / 用户输入 / 产物列表 / 产物内容）优先读当前用户 binding 行 `root_path` 下的 `<root_path>/.sillyspec/.runtime/`。
- **FR-02**：读点选择在 daemon 侧完成；`root_path` 缺失、校验失败或目录不存在时回退现有缓存目录，行为与现状完全一致（零回归）。
- **FR-03**：RPC 向后兼容——不改方法名、不改响应形状，仅加可选参数；老 daemon 忽略新参数自然回退，无需版本门控。
- **FR-04**：安全防线复用 explorer 同款 `assertWithinAllowedRoots`（realpath/junction 感知 + Windows 盘符归一）+ shell 元字符黑名单预检（§6），读点固定在 `.sillyspec/.runtime` 内，artifact filename 预检与 containment 主防线不变。
- **FR-05**：前端 user-inputs 大文件显示截断（尾部 50000 字符 + 含文件路径的提示，§5.3），副标题文案反映「优先本机仓库，回退同步缓存」的真实数据来源。

## 3. 方案对比（决策记录）

| | A：RPC 传 root_path + daemon 读点选择（采纳） | B：工作区策略切 repo-native（否决） | C：仅改文案（否决） |
|---|---|---|---|
| 修复范围 | 所有工作区 / 所有成员 / 任意策略 | 仅单个工作区，逐个切换 | 无 |
| 代码量 | backend 4 方法加参 + daemon 读点选择 + 测试 | 零代码纯运维 | 极小 |
| 兼容性 | 老 daemon 忽略新参数，零版本门控 | 缓存残留目录静默降级回 pull（`repo_native_junction_blocked_fallback`），切换不可验证 | 无 |
| 风险 | 低：安全复用现有防线，失败回退缓存 | 中：牵动 scan 直写源项目 / 打包回灌方向等整个同步行为 | 无 |

**D-01@v1（读点选择规则）**：daemon 收到非空 `root_path` 时，依次过三道校验——①元字符黑名单预检（§6 shell 注入面对策）②`assertWithinAllowedRoots` ③`<root_path>/.sillyspec/.runtime` 目录存在——全部通过 → specDir = `<root_path>/.sillyspec`；任一不过 → 回退 `specCacheRootFor(workspace_id)`。**校验失败一律回退而非报错**（root_path 来自用户自配的 binding 行，路径失效时页面不应 502，回退缓存保持可用）；workspace_id 非法的 forbidden 仍 fail-loud（§5.2 catch 边界）。

**D-02@v1（路径改写位置）**：backend 侧下发前经 `resolve_root_path_for_daemon`（`workspace/service.py:75`）做容器→宿主改写，daemon 收到的即宿主路径，与 lease claim / execution-context 下发 root_path 的既有做法一致。

**D-03@v1（谁的数据）**：`root_path` 取**当前操作用户自己的 binding 行**（`MemberBindingResolver.resolve_member_binding_or_none` 已返回整行），每个成员看到自己本机的运行态，与页面「我的绑定」鉴权语义一致。借用（borrow）路径无自有 binding，不进本链路，行为不变。

## 4. RPC 契约变更

四个方法（`runtime.read_progress` / `runtime.read_user_inputs` / `runtime.list_artifacts` / `runtime.read_artifact`）params 增加可选字段：

```jsonc
// 请求（新增字段 root_path，可选，字符串）
{ "workspace_id": "<uuid>", "root_path": "C:\\Users\\qinyi\\IdeaProjects\\multi-agent-platform" }
// 响应形状不变：{progress} / {content} / {artifacts} / {content}
```

- backend：无条件携带 `root_path`（binding 行 `root_path` 列 `NOT NULL`，恒有值）。
- 老 daemon：handler 只读 `params.workspace_id`，多余键自然忽略 → 行为与现状一致。
- 新 daemon 收到无 `root_path` 的请求（老 backend / 测试）→ 走缓存，与现状一致。

## 5. 各端实现

### 5.1 backend（`app/modules/runtime/service.py`）

- `_resolve_binding` 返回值从 `daemon_id` 扩为 `(daemon_id, root_path)`（或直接返回 binding 行取两字段）。
- 四个服务方法的 `params` 各加 `"root_path": resolve_root_path_for_daemon(binding.root_path)`。
- 错误映射、超时、鉴权全部不变。

### 5.2 daemon（`sillyhub-daemon/src/runtime-handler.ts` + `daemon.ts`）

- `RuntimeHandler` 构造参数（现有可选 opts 对象，`runtime-handler.ts:158`）并列扩展：`rootsProvider: () => string[]`（对齐 `HostFsHandler` 的 `rootsProvider` 注入范式，host-fs-handler.ts:202）与可选 `pathExists: (p: string) => Promise<boolean>`（默认 fs/promises 实现，测试注入用）。
- 新增私有读点选择 `pickRuntimeSpecDir(workspaceId, rootPath?)`（命名避开 spec-sync 已导出的 `resolveSpecDir`，防混淆）：按 D-01@v1 规则返回最终 specDir；四个方法改用它，其余逻辑（spawn 命令、文件读取、filename 预检、containment、大小上限）不变。
- **回退的 catch 边界（显式）**：仅捕获 `root_path` 校验路径上的 `RpcError`（元字符预检 / assertWithinAllowedRoots / `.runtime` 存在性三道任一不过）→ 记日志回退缓存；**workspace_id 白名单（`WORKSPACE_ID_RE`）的 forbidden 抛错路径不在捕获范围**，非法 workspace_id 仍 fail-loud（现状回归）。实现为先做 workspace_id 校验（`specCacheRootFor` 原逻辑），再独立 try/catch root_path 三道校验。
- `daemon.ts`：`_registerRuntimeRpcHandler` 透传 `params.root_path`（非字符串归一 undefined）给四个 handler；`RuntimeHandler` 在类字段构造点（`daemon.ts:784`）注入 `rootsProvider: () => this._effectiveAllowedRoots()`。

### 5.3 frontend（`runtime/page.tsx`）

- user-inputs 渲染截断：`userInputs.length > 50000` 时显示末尾 50000 字符（输入记录为追加式日志，末尾最新；既有产物内容 `slice(0, 10000)` 是头部无提示截断，本处改为**尾部截断并加提示**，属先例的行为增强）+「内容过长，已截断，完整内容见本机 `.sillyspec/.runtime/user-inputs.md`」提示。
- 副标题：「经绑定守护进程实时读取 `.sillyspec/.runtime/` 工作流状态（优先本机仓库，回退同步缓存）。」——两种读点下均不产生误导。

## 6. 安全设计

- **路径防线**：`root_path` 过 `assertWithinAllowedRoots`（`file-rpc.ts:82`，2026-08-20 审计加固版：realpath 展开 + junction/符号链接感知 + 盘符归一 + UNC 拒绝），与 explorer / PolicyEngine 同强度。
- **shell 注入面（Design Grill P1 补强）**：`readProgress` 以 `shell:true` spawn `sillyspec progress dump --spec-dir "<specDir>" --json`，现有唯一注入防线是 workspace_id 的 UUID 白名单（`runtime-handler.ts:48` 注释明示）。本变更让 `root_path`（用户自填 binding 行）进入该命令串，构成新向量——在 Linux/macOS 上含 `"` `&` `;` 等元字符的目录名是合法路径，可先通过 realpath containment 再注入 shell（Windows 文件名禁止这些字符，风险仅在 Unix 系）。**对策（三层，第一层为本变更新增）**：
  1. **元字符黑名单预检**：`root_path` 含任一字符 `"` `'` `` ` `` `$` `&` `|` `;` `<` `>` `(` `)` `%` `^` 换行/回车/NUL → 判为无效 → 回退缓存（与 D-01 回退语义一致，不 fail-loud）。常见路径（含中文、空格）零误伤；Unix 下合法但少见的元字符目录名（如 `foo(1)`）会优雅降级回缓存，非报错。
  2. realpath containment（既有 assertWithinAllowedRoots）：注入目录必须物理存在于 allowed_roots 下。
  3. 鉴权链（既有）：root_path 只来自当前用户自己 binding 行（PUT /my-binding 写入），daemon 归属校验确保 RPC 只达本人 daemon——攻击者只能注入自己的机器，无横向面。
  三层叠加后残余风险：本机自伤（用户在自己机器上构造恶意路径注入自己 daemon），等价于用户本可直写 allowed_roots 下任意文件的能力，无新增边界。
- **读点收敛**：实际读路径固定为 `<specDir>/.runtime/...` 拼接，specDir 只可能是「过了三道校验的 root_path/.sillyspec」或「UUID 白名单约束的缓存目录」二选一；artifact filename 平文件名预检 + resolve containment 主防线不变。
- **攻击面评估**：被入侵的 backend 本就能经 explorer/host_fs RPC 读 allowed_roots 内任意文件，本变更不扩大既有能力边界。

## 7. 兼容与回滚

- 老 daemon（未升级）：忽略 `root_path`，读缓存——即现状行为，页面不劣化。
- 新 daemon + 老 backend：无 `root_path` 参数，读缓存——现状行为。
- 回滚：backend 停发 `root_path` 即整体回到现状，无数据迁移、无 schema 变更。
- daemon 升级走既有版本管理机制（daemon-dist 随 backend 镜像分发）。

## 8. 已知边界（首版接受）

- platform-managed 下平台触发的 scan/gate 仍写缓存 `.runtime/`；当仓库 `.runtime` 存在时该部分不可见。当前 agent 驱动为主的使用模式下仓库数据即最新真相；若未来需要，再做双源 mtime 合并（已记入 Non-Goals）。
- `user-inputs.md` 无读取大小上限（RPC 层）；本机已 1.4MB，uvicorn WS 默认 16MB 内安全。前端截断缓解显示问题，传输上限暂不加（加上限会让数据静默不完整，先观察）。

## 9. 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/runtime/service.py` | 修改 | `_resolve_binding` 返回扩展；四方法 params 加 root_path |
| `backend/app/modules/runtime/tests/test_live_service.py` | 修改 | params 断言 + 改写断言 |
| `backend/app/modules/runtime/tests/test_router.py` | 修改 | 端到端参数透传（如现有 mock 结构允许） |
| `sillyhub-daemon/src/runtime-handler.ts` | 修改 | 读点选择 + rootsProvider 注入 |
| `sillyhub-daemon/src/daemon.ts` | 修改 | `_registerRuntimeRpcHandler` 透传 root_path、注入 roots |
| `sillyhub-daemon/tests/runtime-handler.test.ts` | 修改 | 优先仓库/回退缓存/越界回退/无参数四类用例 |
| `frontend/src/app/(dashboard)/workspaces/[id]/runtime/page.tsx` | 修改 | user-inputs 截断 + 副标题文案 |
| `frontend/src/app/(dashboard)/workspaces/[id]/runtime/page.test.tsx` | 修改 | 截断渲染用例 + 文案断言回归 |

## 10. 测试策略

- **backend**：`test_live_service.py`——四个方法的 RPC params 均含 `root_path` 且值为改写后路径（patch settings 前缀验证改写）；无 binding 仍 404 不变。
- **daemon**：`runtime-handler.test.ts`——①root_path 合法且 `.runtime` 存在 → 读仓库路径；②root_path 含 shell 元字符 → 回退缓存路径；③root_path 越界 → 回退缓存路径不抛 forbidden；④root_path 合法但 `.runtime` 不存在 → 回退缓存；⑤无 root_path → 缓存（现状回归）；⑥workspace_id 非法仍 forbidden（现状回归）。
- **frontend**：现有 page.test.tsx 回归 + 截断渲染用例。
- **全量**：backend `uv run pytest`（runtime 模块 + workspace 相关）、daemon `pnpm vitest run`、frontend `pnpm vitest run` + `tsc --noEmit`。

## 11. 生命周期契约

生命周期契约：无 / 不涉及生命周期契约——本变更仅扩展现有只读 RPC 的可选请求参数与读取位置，不新增或修改任何 session / lease / agent_run / daemon 注册 / 心跳等生命周期事件与状态迁移。

## 12. 自审（Self-Review）

- 契约校验项逐条过：四件套齐、生命周期豁免短语在位、文件变更清单在位、proposal 非目标在位、requirements FR-XX 编号在位。
- 三道校验（元字符 / assert / 存在性）在 D-01、§5.2、§6、FR-02/FR-04、T1/T4 五处表述逐字对齐；catch 边界（workspace_id forbidden 不吞）显式。
- 独立子代理两轮 Design Grill：首轮 P1（shell 注入面）+7 P2 已修订，复审 pass；5 P3 措辞同步已清理，docHash 已重算。
- 已知边界（§8）与 Non-Goals 一致，未混入 tasks。

## 13. 非目标（Non-Goals）

同 proposal.md「非目标 / Non-Goals」：不做双源合并（仓库 `.runtime` 存在时平台触发 scan/gate 写缓存的数据不可见，首版接受）；不改 SpecWorkspace 策略（方案 B 否决）；不给 user-inputs 传输加大小上限（观察期）；不做 runtime 页 UI 重构。

## 14. 约束与风险（Trade-off）

- **约束**：老 daemon 必须无感（忽略新参数）；Windows/Linux/macOS 三平台路径兼容（CLAUDE.md 规则 13）；shell 注入面三层对策（§6）不可裁剪。
- **风险与缓解**：binding root_path 失效 → 回退缓存页面不挂；新老 daemon 混布 → 不一致方向是「修好 vs 现状」无破坏性；大 user-inputs 渲染 → 前端尾部截断 50000 字符；元字符目录名在 Unix 降级回缓存（优雅降级非报错）。
- **Trade-off**：读点选择放 daemon 侧（而非 backend 直传完整 specDir）换取安全校验（allowed_roots）在宿主本地执行、且 backend 不感知 daemon 文件系统布局。
