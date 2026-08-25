---
author: qinyi
created_at: 2026-08-25 21:06:55
scale: large
status: draft
change: 2026-08-25-workspace-git-log
---

# 设计文档（Design）— 工作区 Git 日志视图（类 IDEA Git Log）

## 1. 背景

平台工作区（`workspaces/[id]`）目前只能浏览文件（explorer tab）和方案文档镜像（变更 tab），无法看到代码的提交历史。用户希望在平台上直接看到类 IDEA Git Log 视图：左侧分支拓扑泳道图 + 右侧提交列表（作者/时间/哈希/分支标签），点击提交可看详情与文件级 diff。

前置调研（2026-08-25 explore 阶段）结论：

- 无维护良好且可直接复用的现成组件：`@tomplum/react-git-log` 3.x 要求 React ≥19（本项目 React 18.3 + Next 14.2 装不上），`@gitgraph/react` 已归档且为手动 addCommit 示意图 API，Gitea/GitLab 的提交图均为内嵌实现无 npm 包。**前端自研 SVG 泳道**是用户拍板方案。
- 平台后端目前**没有任何 git log 端点**；工作区源码物理存放在 daemon 宿主机上（backend Docker 容器内路径不可达，`resolve_root_path_for_daemon` 的存在即证据），只读数据链路必须仿 explorer 模块走 daemon host_fs RPC。

## 2. 设计目标

1. 工作区新 tab「Git 日志」：泳道拓扑图 + 提交列表（虚拟滚动），默认全分支（`git log --all`），标注 HEAD/本地分支/远程分支/tag。
2. 点击提交 → 右侧 Drawer：详情（哈希/作者/时间/message 全文）+ **变更文件目录树**（按 `/` 聚合，目录节点聚合 +x/-y）+ 点击叶子文件查看 unified diff。
3. 筛选：**分支过滤**与**作者过滤**。
4. 性能：服务端分页 + react-virtual 虚拟滚动 + 泳道视口重绘 + diff 按需加载。
5. 视觉走 AI-native 三主题 token（blue/ai-native/dark），泳道色板随主题切换亮暗档。
6. 非 git 工作区 / daemon 离线等形态有明确降级提示（复用 explorer 三降级模式）。

## 3. 非目标（不在范围内）

- **任何 git 写操作**：checkout / merge / pull / cherry-pick / rebase 等一律不做（写操作已有 git_gateway（worktree lease 内）与 worktree 模块体系，未来如需另行立项）。
- commit message 全文搜索、按日期区间过滤、blame / 文件历史视图。
- diff 的 side-by-side 双栏模式（第一版只做 unified）。
- 重命名文件的展示简化为「删除 + 新增」两条（`--no-renames`；不做 rename 跟踪标注，Grill CC-16② 裁定接受）。
- 大文件 diff 完整渲染（超限截断，见 R-06）。
- 浅 clone / 部分克隆等仓库级优化。

## 4. 拆分判断

单一功能模块 + 一条数据链路（daemon RPC → backend 模块 → 前端 tab 页），无多角色视图、无跨页面状态流转、模块间耦合紧（同一数据契约），**不拆分**；任务无重复模式（非模板 × 数据），**不走批量模式**。规模 = large（跨 frontend / backend / sillyhub-daemon 三子项目，新增 1 个 backend 模块 + daemon 协议扩展 + 前端新页面，四件套齐全）。

## 5. 总体方案

### 5.1 数据流总览

```
浏览器「Git 日志」tab（react-virtual 列表 + SVG 泳道 + Drawer）
  │ ① GET /api/workspaces/{wid}/git-log/commits?skip&limit&branch&author   （列表+lane）
  │ ② GET /api/workspaces/{wid}/git-log/commits/{sha}                       （详情+文件列表）
  │ ③ GET /api/workspaces/{wid}/git-log/commits/{sha}/diff?path=            （单文件 diff）
  ▼
backend app/modules/git_log/（新模块，仿 explorer）
  绑定解析（MemberBindingResolver）→ resolve_root_path_for_daemon
  → probe_workspace_git_mode（真实三态 git/direct/unknown，service 映射 direct→no_git、
    unknown→按 offline 502 处理）→ 平名 RPC 直连转发（显式超时）
  → pretty 输出解析 + for-each-ref refs 合并 → graph_layout lane 计算
  → 404/403/502/504/422 错误映射（AppError 中文文案）
  ▼
daemon host-fs-handler（宿主机）
  execFile('git', [...]) 只读四命令：
  log --all/--author/--pretty=format(%x00/%x1e 分隔) / for-each-ref / show --numstat / show -- path
```

### 5.2 Phase 1 — daemon 侧：host-fs 只读 RPC

`host-fs-handler.ts` 新增四方法，逐一对齐既有方法骨架（`assertWithinAllowedRoots` 白名单守卫 → `runCmd('git', args)` → 失败结构化回传不抛）：

| 方法 | git 命令要点 | 说明 |
|---|---|---|
| `git_log` | `git log [--all \| <branch>] [--author=<v>] -n <count> --date=iso-strict --pretty=format:<见 7.2>` | count 由 backend 传入（= skip + limit + lookahead，见 5.3）；`--all` 与分支过滤互斥 |
| `git_refs` | `git for-each-ref --format=<%(refname)%00%(objectname)%00%(*objectname)%00%(refname:short)> refs/heads refs/remotes refs/tags` + `git rev-parse HEAD` | 分支/远程/tag 装饰 + HEAD；**annotated tag 用 `%(*objectname)`（peeled commit sha）回退映射**——tag 对象的 objectname ≠ commit sha，无 peeled 则回退 objectname |
| `git_show` | `git show <sha> --numstat --no-renames --pretty=format:<同上>` | 详情 + 变更文件列表（numstat 机器可解析，避开 `--stat` 终端宽度问题） |
| `git_diff_file` | `git show <sha> --unified=3 --no-color -- <path>` | 单文件 unified diff；二进制检测（`Binary files` 输出）；64KB 截断（**独立选定的上限**，非对齐 explorer 读文件 10MB 上限——diff 文本按行渲染，64KB 已是浏览器侧的合理量级） |

空仓库边界（CC-17）：`git log` 在无提交仓库 exit 128、`git rev-parse HEAD` 失败——daemon 侧**捕获并转空态结构**（`commits: []` / `head: null` / refs 正常返回空表），不走红通道 error，前端渲染空列表而非报错。

**RPC 通道与命名（CC-02 澄清）**：四方法实现在 `host-fs-handler.ts`（复用其骨架与 `runCmd`），但**不走 `HostFsDelegate` 的 `host_fs.` 前缀降级通道**——在 daemon.ts 注册为**平名方法**（`git_log` / `git_refs` / `git_show` / `git_diff_file`，对齐 explorer 系 `explorer_list_dir` 的平名注册形态）；backend service 经 MemberBindingResolver 解析绑定后直连 RPC（显式超时 + 自持错误映射），offline/timeout 走 502/504 而非静默降级 dict。

安全约束（对齐 git_gateway 拦截面与 explorer containment）：

- sha 白名单正则 `^[0-9a-fA-F]{4,40}$`；branch 值限 `^[A-Za-z0-9][A-Za-z0-9._\-/]*$`（**首字符禁 `-`**，防 git 把 `-n`/`-O` 等当选项劫持语义）且 ≤200 字符；author 限可打印 ASCII+Unicode 字母且 ≤120 字符；path 拒绝 pathspec magic 前缀（`:(` 开头）并沿用 explorer `_join_within_root` 的 join 语义（root+path join 后 containment 断言，backend 预检 + daemon `assertWithinAllowedRoots` 双重校验）；branch/author 只作为**独立 argv** 传 `execFile`（不经 shell，无注入面）；
- 全部只读子命令（log / for-each-ref / show / rev-parse），不落任何状态。

`protocol.ts`/注册表同步加方法名（对齐 daemon.ts 包装 RpcHandler 的既有方式）。

### 5.3 Phase 2 — backend `git_log` 模块 + lane 计算器

**模块四件套**（router/service/schema/tests）+ 纯函数 `graph_layout.py`，service 层完全照抄 explorer 的链路形态：

绑定解析用 `MemberBindingResolver.resolve_member_binding_or_none`（只看当前用户绑定行，不借 `resolve_daemon_instance_for_workspace`）；路径经 `resolve_root_path_for_daemon` 改写后随 RPC 下发；`probe_workspace_git_mode` 探测结果在 service 层映射——probe 真实返回 `git / direct / unknown`（delegate.py 现行契约），本模块响应的 `git_mode` 字段只暴露两态：`git`（含 worktree 检出，worktree 下 git log 正常）与 `no_git`（probe=direct 映射）；probe=unknown（传输失败）并入 offline→502 错误映射，不进 `git_mode` 枚举；`no_git` 时前端渲染空态卡（不是报错）；RPC 显式超时（log 30s / show 30s / diff 30s，常量对齐 explorer 风格）；错误映射：未绑定→404 / daemon not_found→404 / forbidden→403 / offline→502 / timeout→504 / method_not_found→422（daemon 版本过旧）。

**lane 计算器（核心算法，`graph_layout.py` 纯函数）**

- 输入：按 git log 输出序（新→旧）的 commit 列表（含 `parents`）；
- 输出：每个 commit 的 `lane` 编号 + 每条父边的 `edges: [{to_index, to_lane, kind: straight|curve}]`；
- 算法参考 Gitea `modules/git/graph`：维护活跃 lane 槽位集合（有序），当前 commit 命中某槽 → 输出该槽 lane；分叉（parent 不在活跃槽）→ 取最左空闲槽；merge（多 parent）→ 各 parent 依序找槽，可复用已活跃槽；槽内最后一条引用离开后回收（回收后可被更晚的分叉复用，保证 lane 编号紧凑）；
- **确定性**：同一输入前缀必产出同一 lane 分配（无随机/依赖集合遍历序的实现，槽位用有序结构）。

**跨页 lane 一致性（关键设计决策，D-004）**：daemon **不用** `--skip`；backend 每页都让 daemon 从 HEAD 拉 `skip + limit + lookahead` 条（lookahead=50），backend 对**全前缀**做确定性 lane 计算后，只返回 `[skip, skip+limit)` 窗口及其后 lookahead 内可见的边。任意页的 lane 与全量计算一致。代价：深翻页 O(skip)，用 skip 上限 2000 + `-n` 硬上限兜底（R-02）。

**lookahead 不足的退化行为（CC-03，明文化）**：merge commit 的第二父边在拓扑序中可落后数百条——当窗口内某 commit 的父边目标落在 lookahead（50 条）之外时，该边**不绘制**（泳道在该行下方自然截断，无出界短线）；追加下一页时，前页指向本页的长边因响应只含窗口内 commit 的边而同样不绘制（页边界处视觉截断是**接受的退化**，非 bug）。lane 编号一致性不受影响（前缀确定性计算独立于边可见性）。该退化行为有专项测试用例（§5.5）。

**作者/分支过滤**：过滤参数透传 daemon 侧 `git log` 参数（`--author` / 用 `<branch>` 替代 `--all`）；过滤后结果集外的 parent 不产生边（泳道自然简化，IDEA 同样处理）；lane 始终基于实际返回结果集计算。

### 5.4 Phase 3 — 前端

- `workspace-tabs.tsx` TABS 加 `{ key: 'git-log', label: 'Git 日志', path: '/git-log' }`（三字段形态对齐现有 15 项条目；图标 GitBranch）；
- `workspaces/[id]/git-log/page.tsx`：PageHeader（标题 + 副标题工作区名/已加载 N 条——**不显示仓库提交总数**，避免为此增加 `rev-list --count` 第 5 个 RPC）+ 工具栏（**分支下拉**（数据源 = 响应 top-level `branches[]`，git_refs 全量）+ **作者文本输入框**（回车触发，git `--author` 前缀/子串匹配语义；不做作者下拉——候选列表随分页窗口漂移，无稳定数据源）+ 刷新）+ 卡片列表，页面骨架对齐 explorer page（三降级错误卡同款）；
- 列表主体：左侧**泳道 SVG**（绝对定位覆盖行左列，随 react-virtual 可视区 ± overscan 重绘；commit 圆点按 lane 取色板，HEAD 虚线环）+ 行内容（message / 作者 / 短哈希 / refs 标签 / 时间）；
- 点击行 → 右侧 Drawer：详情 + **变更文件目录树**（`git show --numstat` 平铺路径前端按 `/` 聚合，参考 `change-file-tree.tsx` 的树交互模式；目录节点聚合 +x/-y；叶子点击展开 diff，diff 按需请求 ③）；
- `lib/git-log.ts`：api-types 生成类型 + queryKey 工厂 + useQuery hooks（skip/limit/branch/author 入 key，天然缓存）；
- `pnpm gen:types` 重新生成 `api-types.ts` 并同步提交 `backend/openapi.json`（CLAUDE.md 规则 21）；
- 主题：全部颜色走 `themes.ts` 消费链（CSS 变量 / brand-* / semantic token）；泳道 lane 色板为固定区分色数组（primary/accent/success/warning/error 系），三主题各配亮暗档；**tab 内禁用 `md:` 等视口响应式前缀**（知识库既有坑）；文字可选中、行 hover 走 brand-50 底。

### 5.5 Phase 4 — 测试

- backend `graph_layout` 纯函数单测：线性链 / 分叉 / 合并 / 分叉+合并复合 / 槽回收复用 / 跨页窗口截取一致性 / **父边目标超出 lookahead 的退化（边不绘制且 lane 不变）** 七类拓扑用例；
- backend router 集成测试：mock daemon RPC 响应（正常列表 / 非 git / daemon 离线 / 超时 / method_not_found 旧版 daemon / sha 非法 / path 越界）；
- daemon：`git_log` pretty 解析单测（中文 message、含引号、多行 body、%x1e 记录分隔）、`git_diff_file` 截断与二进制分支；
- 前端：泳道组件渲染（lane/edges → path 断言）、文件树聚合函数单测；vitest（frontend 现有栈）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/host-fs-handler.ts` | +4 只读方法 git_log / git_refs / git_show / git_diff_file（平名注册，见 §5.2 CC-02 澄清；**不新增 HostFsDelegate 方法**——backend service 直连 RPC 通道）。数据流：producer=git 子进程 stdout → 本模块解析（%x00 字段 / %x1e 记录分隔 → 结构化对象；tag peeled 回退）→ RpcHandler 返回 → consumer=backend git_log service |
| 修改 | `sillyhub-daemon/src/daemon.ts` | 平名方法注册（对齐 explorer 系 `explorer_list_dir` 注册形态，4 行） |
| 新增 | `backend/app/modules/git_log/__init__.py` | 包初始化 |
| 新增 | `backend/app/modules/git_log/router.py` | 三 GET 端点（§7.1），`prefix="/workspaces/{workspace_id}/git-log"`，`require_permission(Permission.WORKSPACE_READ)` 门控（对齐 explorer/router.py） |
| 新增 | `backend/app/modules/git_log/service.py` | 绑定解析 + probe 三态 + RPC 转发（显式超时常量）+ 解析合并 + 错误映射（模块本地 AppError 子类，对齐 explorer/service.py） |
| 新增 | `backend/app/modules/git_log/schema.py` | Pydantic 响应模型（§7.4）。数据流：producer=service 组装（含 lane/edges/refs 合并）→ FastAPI JSON → consumer=前端 api-types 生成类型 |
| 新增 | `backend/app/modules/git_log/graph_layout.py` | lane 计算器纯函数（§7.3），无 IO 依赖 |
| 新增 | `backend/app/modules/git_log/tests/test_graph_layout.py` | 六类拓扑单测 |
| 新增 | `backend/app/modules/git_log/tests/test_router.py` | 集成测试（mock daemon RPC 七分支） |
| 修改 | `backend/app/main.py` | include_router 一行（对齐既有挂载约定） |
| 修改 | `frontend/src/components/workspace-tabs.tsx` | TABS 加 git-log 项 |
| 新增 | `frontend/src/app/(dashboard)/workspaces/[id]/git-log/page.tsx` | 页面骨架（PageHeader + 工具栏 + 列表卡片 + 三降级卡） |
| 新增 | `frontend/src/components/git-log/commit-graph.tsx` | 泳道 SVG 渲染（lane 色板 + 视口重绘） |
| 新增 | `frontend/src/components/git-log/commit-list.tsx` | 虚拟滚动列表（react-virtual） |
| 新增 | `frontend/src/components/git-log/commit-detail-drawer.tsx` | 详情 Drawer（含 diff 展开态） |
| 新增 | `frontend/src/components/git-log/file-tree.tsx` | 变更文件目录树（平铺路径聚合 + +x/-y） |
| 新增 | `frontend/src/lib/git-log.ts` | queryKey 工厂 + useQuery hooks（类型全部引自 api-types） |
| 再生成 | `frontend/src/lib/api-types.ts` + `backend/openapi.json` | `pnpm gen:types` 产物随本变更提交（规则 21） |
| 新增 | `frontend/src/components/git-log/__tests__/` | 泳道渲染 + 文件树聚合测试 |

## 7. 接口定义

### 7.1 HTTP 端点（backend git_log/router.py）

| 端点 | 权限 | 参数 | 响应 |
|---|---|---|---|
| `GET /api/workspaces/{wid}/git-log/commits` | `WORKSPACE_READ` | `skip:int=0`（上限 2000）、`limit:int=100`（上限 200）、`branch:str=""`（空=全部分支）、`author:str=""` | `GitLogCommitsResponse` |
| `GET /api/workspaces/{wid}/git-log/commits/{sha}` | `WORKSPACE_READ` | path: sha | `GitLogCommitDetailResponse` |
| `GET /api/workspaces/{wid}/git-log/commits/{sha}/diff` | `WORKSPACE_READ` | query: `path`（必填） | `GitLogDiffResponse` |

### 7.2 daemon RPC 契约（host_fs 方法）

```
git_log({root, branch?, author?, count})
  → { commits: [{hash, short, parents[], author_name, author_email,
                 author_date, committer_date, message}],
      truncated: bool, error: string|null }
  # git log [--all|<branch>] [--author=<v>] -n <count> --date=iso-strict
  #   --pretty=format:%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%B%x1e

git_refs({root})
  → { refs: [{name, short, sha, kind: branch|remote|tag}], head: string|null, error }
  # for-each-ref format 含 %(*objectname)（peeled）：tag 的 sha 取 peeled commit 回退 objectname

git_show({root, sha})
  → { commit: {同上单条字段}, files: [{path, add, del, binary}], error }

git_diff_file({root, sha, path})
  → { diff: string, truncated: bool, binary: bool, error }
```

空仓库形态（CC-17）：`git_log` / `git_refs` 对无提交仓库返回 `{commits: [], refs: [], head: null}` 空态结构（daemon 捕获 exit 128 转空态），不走红通道。

### 7.3 lane 计算器（graph_layout.py）

```python
def compute_lanes(commits: Sequence[CommitRef]) -> list[CommitLayout]
# CommitRef  = {index, hash, parents: list[str]}          # 新→旧序，parents 为全长哈希
# CommitLayout = {index, lane: int,
#                 edges: list[Edge]}                       # 只含目标在结果集内的父边
# Edge = {to_index: int, to_lane: int, kind: Literal["straight", "curve"]}
# 确定性：同一输入前缀 → 同一输出；窗口截取（skip/limit）不影响前缀 lane 分配
```

### 7.4 数据结构（schema.py，映射 api-types）

```
GitLogCommitsResponse:
  git_mode: "git" | "no_git"        # probe 真实三态（git/direct/unknown）的 service 映射：
                                    #   direct→no_git；unknown→offline 502，不入此枚举
  commits: [ {seq, hash, short, parents[], message, author_name, author_email,
              author_date, lane, edges[{to_seq, to_lane, kind}],
              refs[{name, kind: branch|remote|tag|head}]} ]
  # seq = 全局绝对序（skip + 窗口内偏移），追加页 SVG y 坐标与边目标均以 seq 为基准
  branches: [{name, kind: branch|remote}]   # top-level 全量分支列表（git_refs 结果），
                                            # 供工具栏分支下拉（CC-07），与窗口无关
  head: string|null
  has_more: bool
  total_in_window: int        # 本次实际返回条数（过滤后可能 < limit）

GitLogCommitDetailResponse:
  {hash, short, parents[], message, author_name, author_email,
   author_date, committer_date, refs[],
   files: [{path, add, del, binary}]}

GitLogDiffResponse:
  {diff: string, truncated: bool, binary: bool}
```

refs 合并发生在 backend service：`git_refs` 结果按 sha 映射进 commits；HEAD 同时写入对应 commit 的 `refs[]`（kind=head）与顶层 `head` 字段。

## 7.5 生命周期契约表

生命周期契约：无（N/A——本变更为**无状态只读查询**，不新增 session / lease / agent_run / 状态机流转；经 daemon host_fs RPC 的请求-响应一次性完成，无租约、心跳、claim 语义。文中出现的 "daemon" 仅指既有 RPC 通道复用，不涉其生命周期事件）。

## 8. 数据模型

无表结构变更：git_log 为纯只读查询模块，不新增/修改任何 SQLModel 模型与 Alembic 迁移。

## 9. 兼容策略

- 全新模块 + 新端点，不触碰任何现有 API / 表结构 / 前端路由行为；未部署新 daemon 的环境调用新端点 → `method_not_found` → 422「daemon 版本过旧，请升级」（对齐 explorer 既有文案形态），属可预期降级而非故障。
- daemon 四新方法均为独立分支，不影响既有十方法行为；旧 backend 调用旧方法零变化。
- 回退路径：整模块可独立禁用（main.py 去掉 include_router + 前端 TABS 去掉一项即回退），无数据残留。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 参数注入面（sha / path / branch / author 到宿主机 git 命令） | P0 | sha 正则白名单；branch `^[A-Za-z0-9._\-/]+$`；author 长度+可打印校验；全部独立 argv 经 execFile（无 shell）；path 走 backend containment 预检 + daemon allowed_roots 双重校验 |
| R-02 | 大仓库深翻页 O(skip) 性能（全前缀 lane 计算方案） | P1 | skip 硬上限 2000 + `-n` 上限；`has_more=false` 截断；UI 引导用分支/作者过滤代替深翻页 |
| R-03 | git pretty 输出解析边界（中文 message / 引号 / 多行 body / `%` 字面量） | P1 | `%x00` 字段分隔 + `%x1e` 记录分隔，不按行切；六类边界单测；解析失败条目跳过并计数（不整页失败） |
| R-04 | 非 git 工作区 / daemon 离线 / 旧版 daemon | P2 | `probe_workspace_git_mode` 三态入 `git_mode` 字段渲染空态卡；offline→502 / timeout→504 / method_not_found→422（explorer 同款映射与文案） |
| R-05 | 前端泳道渲染性能（长列表 + 大量 SVG path） | P2 | react-virtual 行虚拟化；SVG 只绘可视区 ± overscan 的边与点；edges 预计算无需前端算布局 |
| R-06 | 大 diff / 二进制文件拖垮页面 | P2 | 64KB 截断（`truncated` 标记）+ binary 检测直接提示「二进制文件」；diff 展开时才请求 |
| R-07 | 跨页 lane 断线 / 页间不一致 | P1 | 确定性算法 + 全前缀计算 + lookahead=50（§5.3）；跨页窗口一致性专项单测 |
| R-08 | 实现与原型视觉偏差 / 主题漏适配 | P2 | 原型 `prototype-workspace-git-log.html` 已确认；execute 时按 FRONTEND_PAGE_STYLE.md §12 清单逐项对照；泳道色板三主题各配亮暗档 |

## 11. 决策追踪

| 决策 ID | 内容 | 覆盖位置 |
|---|---|---|
| D-001@v1 | 前端自研 SVG 泳道，禁止引入第三方 git 图组件 | §5.4 / §3 非目标 |
| D-002@v1 | 数据链路走方案 A：新 backend git_log 模块 + daemon host-fs 只读 RPC（否决 explorer 扩展 / backend 直跑） | §5.1–5.3 |
| D-003@v1 | 第一版严格只读，含 diff 详情；git 写操作不立项 | §3 非目标 |
| D-004@v1 | lane 坐标后端计算、前端纯渲染；跨页一致性用全前缀确定性计算（非 --skip / 非 cursor） | §5.3 / §7.3 |
| D-005@v1 | 作者过滤 + 变更文件目录树 + 性能强化（用户确认补充） | §2 目标 2/3 / §5.3 / §5.4 |
| D-006@v1 | Design Grill 修正合订：RPC 平名直连（不新增 delegate）/ git_mode 两态映射 / lookahead 退化行为明文化 / 不显示提交总数 / 作者改文本输入（CC-01/02/03/06/07 等 17 项裁定） | §5.2 / §5.3 / §5.4 / §7.2 / §7.4 |

无未解决决策（Unresolved Blockers 空）；D-002 未经推翻（§6 delegate 行属笔误修正，D-002 原意即 explorer 直连同构）。

## 12. 自审（Self-Review）

- [x] 章节齐全：背景/目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约（豁免声明）/数据模型/兼容策略/风险登记/决策追踪/自审 全部在场；
- [x] frontmatter 含 author / created_at（秒级）/ scale=large；
- [x] 生命周期关键词（daemon）命中 → 已在 §7.5 紧邻位置写明「生命周期契约：无（N/A…）」豁免声明；
- [x] 文件变更清单含新增对外字段（RPC 契约 / HTTP 响应）→ 已按 producer→consumer 标注数据流（§6 首行与 schema 行）；
- [x] UI 原型已生成且达「必须生成」级（新增页面）：`prototype-workspace-git-log.html`；
- [x] 用户三点补充（作者筛选 / 文件树 / 性能）均已落入目标与方案（D-005）；
- [x] 接口与既有模式对齐：权限门控 / 错误映射 / 超时常量 / RPC 平名注册逐条对照 explorer 与 host-fs 现行代码（Design Grill CC-11/12/13 查证属实）；
- [x] 无 DB 变更声明（§8）与回退路径（§9）明确。

**Design Grill 修正记录（2026-08-25，独立子代理审查 17 项交叉点，3 P1 + P2 全部吸收）**：CC-01 git_mode 对齐 probe 真实三态并映射两态（§5.1/§5.3/§7.4）；CC-02 删除 delegate 通道改 RPC 平名直连（§5.2/§6）；CC-03 lookahead 退化行为明文化 + 第七类测试用例（§5.3/§5.5）；CC-04 tag peeled 映射（§5.2/§7.2）；CC-05 64KB 为独立选定上限（§5.2）；CC-06 不显示总数（§5.4）；CC-07 branches[] 下拉数据源 + 作者文本输入（§5.4/§7.4）；CC-08 TABS path 字段（§5.4）；CC-09 branch 正则禁首 `-` + pathspec magic 拒绝（§5.2）；CC-10 seq 全局绝对序定义（§7.4）；CC-16② --no-renames 入非目标（§3）；CC-17 空仓库空态契约（§7.2）。

⚠️ 遗留存疑（低风险，不阻塞 plan）：

1. 原型中变更文件列表为平铺演示 + 副标题含总数文案，与设计（树形 / 已加载 N 条）滞后——原型作视觉基准不重绘，execute 以 design 为准；
2. lane 色板固定 5 色循环复用，超 5 并发分支同色相邻 lane 的可辨识性——execute 验收时补 ≥8 泳道视图作辨识度证据，不辨识再扩色板。
