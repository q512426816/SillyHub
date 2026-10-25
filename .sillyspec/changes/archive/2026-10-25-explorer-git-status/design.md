---
author: qinyi
created_at: 2026-10-25 19:57:53
generated_by: sillyspec-design-init
scale: large  # 跨 daemon/backend/frontend 三子项目、新增 2 RPC + 2 端点 + DTO schema 变更、约 17 文件；Wave 1（daemon TS/vitest）与 Wave 2（backend py/pytest）测试体系与文件集互不相交可真并行，整体超出单上下文串行吞吐
---

# 设计文档（Design）— 2026-10-25-explorer-git-status

<!-- 引用规范：全文源码位置写仓根相对全路径+行号 -->

## 背景

工作区「文件」页（explorer）与「Git 日志」页目前对工作区的 git 感知是残缺的：

- explorer 树（`frontend/src/components/explorer/file-explorer.tsx:489`）纯文件浏览，节点无任何 git 状态标记——哪个文件被 agent 改了、哪个是新文件、哪个被忽略，树上看不出来；
- Git 日志页的状态条（`frontend/src/components/git-log/git-status-bar.tsx`，来自 2026-08-26-workspace-git-status）只有汇总数字（files_changed/additions/deletions/untracked_count，`backend/app/modules/git_log/schema.py:126` `GitLogDirtyItem`），**没有文件级清单**，ignored 完全未采集，diff 端点仅支持「提交内对比」（`git show <sha> -- <path>`，`sillyhub-daemon/src/host-fs-handler.ts:1567`），没有「工作区未提交改动 vs HEAD」的对比。

用户（平台管理者）的真实场景：agent 在工作区里干活后，需要不借助外部 IDE 一眼看清「动了哪些文件、还没提交什么、具体改了什么」。本变更对齐 IDEA 的文件状态体验：文件树四色着色（新增绿/修改蓝/删除红/忽略灰）+ 修改文件集合树（IDEA 分组）+ 点击文件看工作区 vs 最近一次提交的红绿 diff。

## 设计目标

1. **单一数据源**：着色、修改集合、增删行数徽标共用同一个「改动文件清单」接口（方案 A，D-007），两处界面状态恒一致；
2. **explorer 契约零改动**：文件树目录接口不加字段，状态以平行接口 + 前端 join 方式接入；
3. **三层落点**：daemon 新增 2 个只读平名 RPC（沿用既有安全守卫）、backend 新增 2 个只读端点（复用 git_log 模块绑定解析/降级骨架）、前端组装 2 个新组件 + explorer 着色接入；
4. **IDEA 颜色语义**（D-002）：新增/新文件=绿（success）、修改=蓝（primary）、删除=红+删除线（error）、忽略=灰（muted），仅本变更新功能使用；
5. 全链路只读：不引入任何写操作（不提交、不暂存、不 checkout）。

## 非目标

- 不做平台内 git 提交/暂存/推送（修改集合卡只读展示，无「提交」按钮）；
- 不做实时推送/文件监听（方案 C 已否决，D-009）——状态为拉取式快照，手动刷新或重新进页更新（D-007 故障面）；
- 不改动现有会话「文件变更卡」`FILE_STATUS_META` 的颜色语义（D-002）；
- 不递归采集忽略目录内部文件（D-003，`node_modules/` 只出一行）；
- 不区分 staged/unstaged 暂存分组（D-004，统一「工作区 vs HEAD」口径）；
- 不改变 explorer 树节点点击行为（仍为内容预览，D-005）；
- 不支持 daemon 侧重命名检测（`--no-renames` 口径，rename 呈现为 deleted+added 两条，见 R-04）。

## 拆分判断

三个界面面（着色/修改集合/diff）共享同一批后端数据，是一个功能闭环，不按界面拆变更；也不适用批量模式（任务数 < 10 且无「模板 × 数据」形态）。规模 large 的依据是**执行并行度**而非需求拆分：Wave 1（daemon，TS+vitest）与 Wave 2（backend，py+pytest）文件集与测试栈完全不相交，可真并行；Wave 3/4（前端组装与接入）依赖 Wave 2 的类型生成产物。见「总体方案」Wave 表。

## 总体方案

### Phase 1（Wave 1）：daemon 双指令

`sillyhub-daemon/src/host-fs-handler.ts` 新增两个方法（紧邻 `gitStatus`（:1642）/`gitDiffFile`（:1567）同款形态），`sillyhub-daemon/src/daemon.ts:7801` 附近注册平名 RPC：

- **`git_dirty_files({ root })`**：一次采集三段——① `git status --porcelain=v2 --branch --no-renames --no-show-stash`（`--branch` 供 branch.oid → head_short——verify Reverse Sync 补记：设计初稿命令清单漏该旗标，接口契约要求 head_short 故实现补上；文件行解析：`1` 条目前段字段以单空格分隔、path 与字段区之间以制表符分隔——按行内首个 `\t` 切出 path，含空格安全；path 含 `\t`/换行时 git 自动 C-quote 包裹，quotepath off 不影响该行为；`? <path>` → untracked；`u`（unmerged，冲突）条目按 modified 归类（D-011））；② `git ls-files --others --ignored --exclude-standard --directory`（忽略顶层聚合行，目录带尾 `/` → `is_dir=true`，D-003；注意 `--directory` 只聚合目录，散落的忽略单文件仍逐条出现——忽略条目规模与忽略**目录内部**文件数无关，与散落忽略文件数线性相关）；③ `git diff HEAD --numstat --no-renames`（文件级增删行数，按 path join 到 ①；`-` 二进制行 → `binary=true`、行数 null；untracked 不在 numstat 中 → 行数 null，Grill 实证）。空仓库（`branch.oid (initial)`）→ `empty=true`、files/ignored 空数组。全程 `runCmd` + `GIT_QUOTEPATH_OFF_ARGS` + 30s 读超时，失败不抛（对齐既有五 git 方法的 error 通道）。
- **`git_worktree_diff({ root, path })`**：先 `git status --porcelain=v2 --branch --no-renames -- <path>`（`--branch` 供 head_short，同上补记）单文件判态分流——modified/deleted → `git diff HEAD --unified=3 --no-color -- <path>`（走 `runCmd`，`!ok` → error 通道）；untracked → `git diff --no-index --unified=3 --no-color -- /dev/null <path>`，**该分支不走 `runCmd` 的 ok 通道**——no-index 有差异时 git 约定 exit=1（隐含 `--exit-code` 语义，Grill 实证 git 2.45.1），而 `runCmd` 对任何非零 exit 一律 `ok:false`（`host-fs-handler.ts:570-584`）且 `ExecResult` 不暴露退出码。按 D-010：untracked 分支用**局部 execFile**（对齐 `runGitFetch` 先例 :1661）直接读退出码——exit 0/1 均视为成功（1=有差异，常态）、≥2 或 killed 才 error；stderr 中的 CRLF warning 行不进 error 文案。64KB 截断 + `Binary files` binary 检测对齐 `gitDiffFile`（:1602-1612）。

### Phase 2（Wave 2）：backend 双端点 + 类型生成

`backend/app/modules/git_log/` 三文件扩展 + OpenAPI 再生：

- `router.py`：`GET /workspaces/{wid}/git-log/dirty-files`、`GET /workspaces/{wid}/git-log/worktree-diff?path=`，均 `WORKSPACE_READ` 门控、RPC 超时 30s（对齐既有四端点形态 `router.py:53-114`）；
- `service.py`：`GitLogService.get_dirty_files / get_worktree_diff`，复用 `_resolve_binding`（:472）/`_probe_git_mode`（:509，direct → no_git 空态）/`_send_git_rpc`（:534，daemon 未知方法错误 → 422 `GitLogDaemonTooOld` 降级）；
- `schema.py`：新增 4 个 DTO（见接口定义）；
- **gen:types 双份义务**（CLAUDE.md 规则 21）：`backend/openapi.json` + `frontend/src/lib/api-types.ts`（`pnpm gen:types`）+ `sillyhub-daemon/src/api-types.ts`（`pnpm -C sillyhub-daemon gen:types`）同一变更内生成提交。

### Phase 3（Wave 3）：前端组装（Git 日志页面）

- `frontend/src/lib/git-log.ts`：`fetchDirtyFiles / fetchWorktreeDiff` + `gitLogQueryKeys.dirtyFiles / .worktreeDiff` + `useGitLogDirtyFiles` hook（对齐现有 fetch/queryKey 模式）；
- 新组件 `worktree-changes-card.tsx`：挂 Git 日志页 `GitStatusBar`（`frontend/src/app/(dashboard)/workspaces/[id]/git-log/page.tsx:190`）之下、提交列表之上。IDEA 三分组树（更改/未纳入版本管理/已忽略聚合），文件行四色 + 增删行数 + 状态徽标（原型 `prototype-explorer-git-status.html` ①）；目录聚合与展开复用 `frontend/src/components/git-log/file-tree.tsx:82` `buildFileTree`（改为导出）；卡头汇总计数 + 快照时间 + 刷新按钮（invalidate `["git-log", wid]` 前缀，自动覆盖新 query）；
- 新组件 `worktree-diff-modal.tsx`：点击文件行打开，复用已导出 `parseUnifiedDiff`（`file-tree.tsx:147`）+ `DiffBody` 同款红绿渲染（导出或复制同构实现），错误分型降级对齐 `frontend/src/components/changes/scope-file-diff-modal.tsx`（422 升级引导/404/502/504）。

### Phase 4（Wave 4）：explorer 着色接入 + 收尾

- `frontend/src/components/explorer/file-explorer.tsx`：explorer 页并行拉 `useGitLogDirtyFiles`，树渲染时按 `path → status` 查色（四色文件名）；含改动的祖先目录名旁蓝点（口径：目录子树内存在 added/modified/deleted/untracked 任一即算，ignored 不算改动，D-011）；忽略条目（`is_dir` 目录整体、`is_dir=false` 单文件）灰 + 「忽略」小徽标；**点击行为不变**（D-005）；
  **实现注意（Grill P2-③）**：现有 `renderTitle` 是模块级纯函数、title 在拉树时已固化进 treeData state（`file-explorer.tsx:121-146`、`:271`）——着色不可沿用固化 title，须改为**渲染期读取状态映射**（title 组件化订阅状态映射，或以 dirty-files 数据为 treeData 的 useMemo 依赖重建），否则晚到的 dirty-files 不会触发已渲染节点变色（时序竞态，实现者追问③的既定答案）；
- explorer 页刷新入口与 `dirty-files` 查询失效联动；
- 原型冻结：`prototype-explorer-git-status.html` 与源码一起 pathspec 提交；`frontend/prototype-dist/` 其余 11 个既有产物因依赖重装产生的重编译漂移 diff 提交前还原（R-05）。

### 测试面（随 Wave 走）

- Wave 1：daemon `NEW:sillyhub-daemon/tests/host-fs-handler-git-dirty-files.test.ts`（porcelain v2 状态行→四态映射表驱动、ignored `--directory` 输出解析、numstat 文件行 join、untracked/deleted diff 分流、root 越界拒绝、空仓库空态）；
- Wave 2：backend `NEW:backend/tests/modules/git_log/test_git_log_dirty_files.py`（未绑定 404 / offline 502 / daemon 版本旧 422 / no_git 空态 / 正常聚合 mock RPC）；
- Wave 3：`NEW:frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx`（三分组渲染/四色类名/计数/点击回调）、`NEW:frontend/src/components/git-log/__tests__/worktree-diff-modal.test.tsx`（加载/错误降级/diff 渲染）；
- Wave 4：`NEW:frontend/src/components/explorer/__tests__/file-explorer-git-status.test.tsx`（状态注入后节点类名断言/忽略目录灰/无状态时与现状渲染一致）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/host-fs-handler.ts | 新增 `gitDirtyFiles`/`gitWorktreeDiff` 两方法（§Phase 1 口径），复用 runCmd/守卫/截断常量 |
| 修改 | sillyhub-daemon/src/daemon.ts | 注册 `git_dirty_files`/`git_worktree_diff` 平名 RPC handler（对齐 `daemon.ts:7803` git_status 注册形态） |
| 修改 | sillyhub-daemon/src/api-types.ts | `pnpm -C sillyhub-daemon gen:types` 产物——新 DTO 类型；producer=backend/openapi.json → 生成器归一化 → consumer=daemon 类型引用 |
| 新增 | NEW:sillyhub-daemon/tests/host-fs-handler-git-dirty-files.test.ts | daemon 双指令解析单测（§测试面 Wave 1） |
| 修改 | sillyhub-daemon/tests/host-fs-handler-git-log.test.ts | GL30 平名注册方法集断言 5→7（D-013 执行期触达既有测试——plan 阶段漏标 related_tests，module-impact Wave 1 回填已记录，此处补清单行） |
| 修改 | backend/app/modules/git_log/schema.py | 新增 `GitDirtyFilesResponse`/`GitDirtyFileItem`/`GitIgnoredItem`/`GitWorktreeDiffResponse`；字段数据流：producer=daemon RPC 载荷 → service 归一化（porcelain XY→四态、路径 POSIX 化、空态兜底）→ response_model 序列化 → consumer=前端 api-types 生成类型 |
| 修改 | backend/app/modules/git_log/service.py | `get_dirty_files`/`get_worktree_diff`（绑定解析/probe/错误映射全复用；daemon 未知方法→422） |
| 修改 | backend/app/modules/git_log/router.py | 新增 `GET .../dirty-files`、`GET .../worktree-diff`（WORKSPACE_READ、path 校验复用 `_validate_diff_path`） |
| 修改 | backend/openapi.json | gen:types 产物（schema 变更同步） |
| 新增 | NEW:backend/tests/modules/git_log/test_git_log_dirty_files.py | 端点测试（§测试面 Wave 2） |
| 修改 | frontend/src/lib/api-types.ts | `pnpm gen:types` 产物——前端消费新 DTO |
| 修改 | frontend/src/lib/git-log.ts | `fetchDirtyFiles`/`fetchWorktreeDiff`/queryKeys/`useGitLogDirtyFiles` |
| 新增 | NEW:frontend/src/components/git-log/worktree-changes-card.tsx | 工作区更改卡：三分组树+四色+计数+刷新（原型①） |
| 新增 | NEW:frontend/src/components/git-log/worktree-diff-modal.tsx | 文件 diff 弹窗：三态渲染+错误分型降级（原型②） |
| 修改 | frontend/src/components/git-log/file-tree.tsx | 导出 `buildFileTree`（:82）与 diff 行渲染件供修改集合复用（现为文件内私有） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/git-log/page.tsx | GitStatusBar（:190）下挂载 `WorktreeChangesCard` + 弹窗状态接线 |
| 修改 | frontend/src/components/explorer/file-explorer.tsx | 树节点四色着色 + 目录蓝点 + 忽略灰徽标（点击行为不变，D-005） |
| 新增 | NEW:frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx | 卡片渲染/分组/四色/点击测试 |
| 新增 | NEW:frontend/src/components/git-log/__tests__/worktree-diff-modal.test.tsx | 弹窗加载/降级/渲染测试 |
| 新增 | NEW:frontend/src/components/explorer/__tests__/file-explorer-git-status.test.tsx | explorer 着色 join 测试 |
| 修改 | frontend/src/components/prototype/explorer-git-status-view.tsx | 原型视图源码（brainstorm 已落盘，批准即冻结） |
| 修改 | frontend/scripts/prototype-build.mjs | VIEWS 数组登记原型视图（brainstorm 已落盘） |
| 新增 | NEW:frontend/prototype-dist/explorer-git-status.html | 原型编译产物（真码管线产物，禁止手改；批准即冻结） |

> 说明：本仓为单 monorepo（backend/frontend/sillyhub-daemon 同仓），无需分仓段。`frontend/src/lib/explorer.ts` 不在清单——explorer 页直接消费 `lib/git-log.ts` 的 hook，数据源统一。

## 接口定义

### daemon 平名 RPC（新增 2 个，只读）

```ts
// git_dirty_files：改动文件清单 + 忽略顶层聚合（一次采集，D-007 单一数据源）
git_dirty_files({ root: string }) => {
  head_short: string | null;          // HEAD 前 8 位；空仓库 null
  empty: boolean;                     // 空仓库（无 HEAD）→ files/ignored 均空数组
  files: Array<{
    path: string;                     // 仓库相对 POSIX 路径（quotepath off）
    status: "added" | "modified" | "deleted" | "untracked";
    additions: number | null;         // numstat 行数；二进制/untracked → null
    deletions: number | null;
    binary: boolean;
  }>;
  ignored: Array<{ path: string; is_dir: boolean }>;  // 顶层聚合（D-003），目录 path 带尾 "/"
  error: string | null;               // 不抛错误约定（对齐既有五 git 方法）
};

// git_worktree_diff：单文件「工作区 vs HEAD」对比（untracked 分流 no-index）
git_worktree_diff({ root: string, path: string }) => {
  status: "modified" | "added" | "deleted";
  head_short: string | null;
  diff: string;                       // unified diff（--unified=3 --no-color）
  truncated: boolean;                 // 超 64KB 字节截断（对齐 gitDiffFile :1604）
  binary: boolean;                    // stdout 含 "Binary files"
  error: string | null;
};
```

porcelain v2 → 四态映射（`--no-renames` 统一口径，Grill 实证 rename 拆 D+A 两条兼容）：`1` 条目（XY 两态字符）含 `D` → deleted；含 `A` → added；其余 → modified；`?` 条目 → untracked；`u`（unmerged，合并冲突）条目 → modified 归类（D-011，四态不扩冲突态，测试用例覆盖）。untracked 的 additions/deletions 恒为 null（numstat 不覆盖，R-06/Grill 实证）。

**explorer 树删除文件说明**（Grill P2-⑤）：explorer 树是 fs 扫描树，已删除文件不在树上——「删除红」仅在 Git 日志页修改集合卡出现，explorer 树图例不含删除色。

### backend 端点（新增 2 个，只读，WORKSPACE_READ）

```
GET /workspaces/{workspace_id}/git-log/dirty-files
  → 200 GitDirtyFilesResponse {
      git_mode: "git" | "no_git",     // probe direct → no_git 空态（复用 _probe_git_mode :509）
      head_short: string | null,
      empty: boolean,
      files: GitDirtyFileItem[],      // { path, status, additions, deletions, binary }
      ignored: GitIgnoredItem[],      // { path, is_dir }
    }
  → 404 未绑定（GitLogNotBound）/ 502 daemon 离线 / 422 daemon 版本过旧（新错误映射）/ 504 超时

GET /workspaces/{workspace_id}/git-log/worktree-diff?path=<仓库相对路径>
  → 200 GitWorktreeDiffResponse { status, head_short, diff, truncated, binary }
  → 错误码同上；path 校验复用 _validate_diff_path；no_git 工作区 → 404「不是 Git 仓库」（verify Reverse Sync 补记：响应模型无 git_mode 字段无法表达 no_git 空态，对齐 get_commit_detail 先例，测试 test_worktree_diff_no_git_404 锚定）
```

### 前端契约

```ts
// frontend/src/lib/git-log.ts 追加
fetchDirtyFiles(workspaceId: string): Promise<GitDirtyFilesResponse>;
fetchWorktreeDiff(workspaceId: string, path: string): Promise<GitWorktreeDiffResponse>;
gitLogQueryKeys.dirtyFiles(workspaceId: string);   // ["git-log", wid, "dirty-files"]
gitLogQueryKeys.worktreeDiff(workspaceId, path);   // ["git-log", wid, "worktree-diff", path]
useGitLogDirtyFiles(workspaceId): { data, isPending, isError, error, refetch };

// 新组件
<WorktreeChangesCard workspaceId={string} onOpenFile={(path: string, status: DirtyFileStatus) => void} />
<WorktreeDiffModal workspaceId={string} path={string | null} status={DirtyFileStatus | null} open={boolean} onClose={() => void} />
```

## 生命周期契约表

生命周期契约：无/N/A——本变更为只读查询链路（HTTP 请求 → backend RPC → daemon 一次性 execFile），不引入会话/租约/agent_run/状态机事件，无长驻进程与外部资源持有（两指令均为单次 execFile、30s 超时自灭）。

## 数据模型

无数据库表/字段变更（纯只读查询，零持久化）。对外 DTO 变更见「接口定义」，随 `pnpm gen:types` 双份同步（frontend + daemon）。

## 兼容策略（brownfield 必填）

- **daemon 旧版本**：无 `git_dirty_files`/`git_worktree_diff` 平名方法 → daemon ws RPC 层返回 `method_not_found` code，backend 现有 `_map_remote_error` 按码分派直接映射 `GitLogDaemonTooOld` 422（`backend/app/modules/git_log/service.py:453-457`，Grill P1-2 已核验：判定依据是 daemon_code 字符串非 method 白名单，**无需改映射代码**）；前端渲染对齐 git-log 页既有 422 降级卡（`git-log/page.tsx:159`），提交历史等既有功能零影响；
- **未绑定/离线/非 git 工作区**：404/502/no_git 空态三降级形态与现有 git-log 端点逐字对齐；explorer 页着色查询失败时静默降级为现状（无色），不阻断文件浏览；
- **不改变的 API**：explorer 四端点、git-log 既有四端点、`GitLogDirtyItem` 汇总结构、会话「文件变更卡」组件均零改动；
- **回退路径**：新端点与新组件相互独立，前端摘除挂载点即完全回退；daemon 新指令仅追加不修改既有方法。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | daemon 旧版本无新平名方法，dirty-files 全挂 | P1 | backend 未知方法错误显式映射 422 + 前端 422 降级卡（对齐 git-log 既有形态）；发版指引：daemon 与 backend 同批部署 |
| R-02 | 大仓库（十万文件级）`git status` 耗时数秒 | P1 | 30s RPC 超时 + 拉取式手动刷新（不轮询，D-007）；实测超限再评估 daemon 侧缓存 |
| R-03 | 文件名特殊字符/中文/Unicode 转义 | P2 | 沿用 `GIT_QUOTEPATH_OFF_ARGS` + POSIX 相对路径契约；单测覆盖中文路径用例 |
| R-04 | 重命名文件被拆为 deleted+added 两条（`--no-renames` 口径） | P2 | 文档与本表明示；接受：平台场景 rename 罕见，拆分语义仍正确；复潮条件：用户反馈 rename 语义缺失 |
| R-05 | `frontend/prototype-dist/` 既有 11 个产物因依赖重装产生重编译漂移 diff | P2 | 本变更提交范围只含 `explorer-git-status.html` 新产物；其余漂移文件提交前 `git checkout --` 还原 |
| R-06 | untracked 文件无增删行数（numstat 不覆盖） | P2 | 契约明示 null，前端仅显示「新文件」徽标；复潮条件：用户反馈需要行数时 daemon 逐文件统计 |
| R-07 | 非功能生命周期面 | P2 | 无长驻进程/外部资源：两指令均为一次性 execFile（30s 超时自灭），无 watcher/句柄/子进程残留——显式留痕 |
| R-08 | 组合约束推演 | P2 | D-003（忽略聚合）与 D-004（HEAD 基线）作用在不同数据面互不约束；D-007（拉取式）与 R-02 组合自洽（刷新即重采）；无组合死锁格 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | §总体方案 Phase 3（修改集合挂 Git 日志页）；FR-02 | 已覆盖 |
| D-002@v1 | §设计目标 4；§Phase 3 四色映射；FR-01/FR-02 | 已覆盖 |
| D-003@v2 | §Phase 1 ignored `--directory` 聚合（措辞收敛：与忽略目录内部文件数无关，散落忽略单文件仍逐条）；§接口定义 ignored 字段；FR-01 | 已覆盖（v2 supersedes v1，Grill P2-②） |
| D-004@v1 | §Phase 1 diff 分流（untracked no-index）；§非目标不分暂存；FR-03 | 已覆盖 |
| D-005@v1 | §Phase 4 explorer 点击行为不变；§非目标；FR-01 边界 | 已覆盖 |
| D-006@v1 | §Phase 1/2 链路与安全守卫复用；§兼容策略降级映射；FR-01/02/03 | 已覆盖 |
| D-007@v1 | §总体方案全局（方案 A 落地）；§接口定义单一数据源；FR-01/02/03 | 已覆盖 |
| D-008@v1 | §非目标（explorer 契约零改动）；R-05 关联产物面 | 已覆盖（rejected 防复潮） |
| D-009@v1 | §非目标（不推送不监听）；R-07 生命周期面 | 已覆盖（rejected 防复潮） |
| D-010@v1 | §Phase 1 git_worktree_diff untracked 分支局部 execFile 退出码契约；FR-03 | 已覆盖（Grill P1-1 修复） |
| D-011@v1 | §接口定义 porcelain 末段 rejoin + u 条目→modified + 祖先蓝点口径；§Phase 4 蓝点；测试面 Wave 1 用例覆盖；FR-01/FR-02 | 已覆盖（Grill P2-①④） |

决策台账详见 `decisions.md`（D-001~D-009 九字段齐全）；无未解决决策。落选方案 D-008/D-009 的否决理由与复潮条件已按防复潮通道要求独立成条。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期豁免/数据模型/兼容策略/风险登记/决策追踪）
- [x] frontmatter 字段齐全（author/created_at/scale=large 含 Wave 证据）
- [x] 引用所有当前版本 D-xxx@vN（D-001~D-009 + Grill 增补 D-010/D-011/D-003@v2，追踪表 11 行全覆盖）
- [x] 生命周期关键词（daemon）出现 → 已写紧邻豁免短语「生命周期契约：无/N-A」格式合规（无/N/A）
- [x] UI 原型分级：必须生成档——真码管线产物 `prototype-explorer-git-status.html` 已落变更目录（源 `frontend/src/components/prototype/explorer-git-status-view.tsx`，`pnpm prototype:build` 编译，素材来源：token 源 `frontend/src/styles/themes.ts` 经 tailwind 语义类、树形态先例 `frontend/src/components/git-log/file-tree.tsx`、demo chrome `frontend/src/components/prototype/demo-chrome.tsx`），用户已确认
- [x] 无「⚠️ 自审存疑」残留——唯一不确定点（daemon 测试目录命名惯例）已按 NEW: 前缀登记，plan 阶段按既有测试文件命名惯例校正
- [x] 文件清单 NEW: 前缀 8 处、既有路径均为仓根相对正斜杠、对外字段行已标 producer→consumer 数据流
