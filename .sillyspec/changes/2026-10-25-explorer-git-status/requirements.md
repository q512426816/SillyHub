---
author: qinyi
created_at: 2026-10-25 19:51:00
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 工作区成员（含管理者） | 对绑定的工作区有 WORKSPACE_READ 权限的平台用户；在「文件」页浏览文件、在「Git 日志」页查看提交历史与当前未提交改动 |
| daemon（宿主机执行器） | 用户本机守护进程，持有工作区 root_path 绑定，执行只读 git 命令采集状态与 diff |
| backend | 平台 API 层，解析成员绑定并转发 RPC，暴露两个新只读端点 |

## 功能需求

### FR-01: explorer 文件树 git 状态着色
Given 用户已绑定本机工作区且 daemon 在线，工作区为 git 仓库
When 用户进入工作区「文件」页
Then 文件树文件名按 git 状态着色——新增/新文件=绿（success）、修改=蓝（primary）、忽略=灰（muted）；含改动的祖先目录名旁显示蓝点；忽略条目（目录整体或单文件）灰色并带「忽略」徽标，目录不递归展开内部文件（D-003）；节点点击行为保持现状（内容预览，D-005）；着色数据与 Git 日志页修改集合同源（同一 dirty-files 接口，D-007）

### FR-02: Git 日志页「工作区更改」修改文件集合卡
Given 同上
When 用户进入工作区「Git 日志」页
Then 在状态条下方展示「工作区更改」卡：按 IDEA 分组（更改 / 未纳入版本管理 / 已忽略聚合）展示改动文件目录树，文件行四色 + 增删行数（untracked 无行数仅徽标，R-06）+ 状态徽标；卡头显示汇总计数、快照时间与手动刷新按钮；刷新失效 `["git-log", wid]` 前缀全部查询（D-001 挂载位置）

### FR-03: 文件级「工作区 vs 最近一次提交」diff 弹窗
Given 用户在「工作区更改」卡点击任一文件行
When 弹窗打开
Then 展示该文件工作区内容与最近一次提交（HEAD）的 unified diff（红删绿增，64KB 截断提示，二进制提示）；基线一律 HEAD 不分暂存组（D-004）；untracked 文件整文件显示为新增（全绿）、已删除文件整文件显示为删除（全红）；弹窗按错误分型降级（422 引导升级 daemon / 404 / 502 / 504）

### FR-04: 后端只读端点与降级
Given 任意持有 WORKSPACE_READ 权限的用户
When 调用 `GET /workspaces/{wid}/git-log/dirty-files` 或 `GET /workspaces/{wid}/git-log/worktree-diff?path=`
Then 正常时返回文件清单（path/status/additions/deletions/binary）+ 忽略聚合条目，或 diff 文本（status/truncated/binary/head_short）；未绑定返回 404、daemon 离线返回 502、daemon 版本过旧（无新平名方法）返回 422、非 git 工作区返回 no_git 空态；权限口径与既有 git-log 四端点一致（D-006 链路复用）

### FR-05: 类型产物同批再生成
Given backend DTO schema 有新增（GitDirtyFilesResponse 等 4 个）
When 本变更收口提交
Then `backend/openapi.json`、`frontend/src/lib/api-types.ts`、`sillyhub-daemon/src/api-types.ts` 三份产物由 `pnpm gen:types` / `pnpm -C sillyhub-daemon gen:types` 同批生成并提交，零手写类型（CLAUDE.md 规则 21 双份义务）

## 非功能需求
- 兼容性：daemon 旧版本新端点 422 降级不阻断 Git 日志页既有功能；explorer 着色查询失败静默降级为现状无色渲染；explorer 既有四端点与 git-log 既有四端点契约零改动；
- 性能：状态采集为一次性 `git status` 族命令（30s RPC 超时），拉取式手动刷新不轮询（D-007）；忽略采集按顶层聚合与忽略文件总量无关（D-003）；
- 安全：daemon 侧沿用 argv 数组 execFile 防注入 + `assertWithinAllowedRoots`/`assertGitPathspec` 守卫；backend 端点 WORKSPACE_READ 门控；
- 跨平台：daemon git 命令与路径处理兼容 Windows/Linux/macOS（POSIX 相对路径契约、quotepath off）。

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02 | 修改集合视图挂 Git 日志页（用户拍板） |
| D-002@v1 | FR-01, FR-02 | IDEA 四色语义仅新功能使用，现有文件变更卡不动（用户拍板） |
| D-003@v2 | FR-01, FR-02 | 忽略条目顶层聚合不递归（v2 措辞收敛：与忽略目录内部文件数无关，散落忽略单文件仍逐条；Grill P2-②） |
| D-004@v1 | FR-03 | diff 基线一律 HEAD、不分暂存、untracked 全绿/deleted 全红（我的判断） |
| D-005@v1 | FR-01 | explorer 树点击行为不变（我的判断，按用户原话字面） |
| D-006@v1 | FR-04 | 沿用 git_log 三层链路与安全守卫，daemon 新增两平名能力（我的判断） |
| D-007@v1 | FR-01, FR-02, FR-03 | 方案 A 平行状态接口 + 前端 join（用户选定） |
| D-008@v1 | FR-01 | 落选方案 B 防复潮条目（explorer 契约零改动即其约束面） |
| D-009@v1 | FR-02 | 落选方案 C 防复潮条目（拉取式快照即其约束面） |
| D-010@v1 | FR-03 | untracked diff 局部 execFile 退出码契约（exit 0/1 均成功；Grill P1-1 修复，我的判断） |
| D-011@v1 | FR-01, FR-02 | porcelain v2 末段 rejoin、u 条目→modified、祖先蓝点不含 ignored（Grill P2-①④，我的判断） |

无剩余未覆盖决策。

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: frontend/src/components/explorer/__tests__/file-explorer-git-status.test.tsx「四色着色/目录蓝点/忽略徽标/晚到变色/点击行为不变」+ file-explorer.test.tsx 既有回归（verify 实测 31 绿）
FR-02: frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx「三分组归属/四色类名/untracked 无行数/卡头计数/刷新 invalidate/降级」（13 绿）+ git-log-page.test.tsx 挂载断言（52 绿）
FR-03: frontend/src/components/git-log/__tests__/worktree-diff-modal.test.tsx「modified 红绿/untracked 全绿/deleted 全红/截断/binary/422-404-502-504 分型降级」（13 绿）+ worktree-diff 分流含 untracked exit 1 成功语义（sillyhub-daemon/tests/host-fs-handler-git-dirty-files.test.tsx WD4，27 用例内）
FR-04: backend/tests/modules/git_log/test_git_log_dirty_files.py「未绑定 404/离线 502/版本旧 422/no_git 404 空态/正常聚合 mock RPC」（18 绿）
FR-05: 不适用：纯产物再生成无单测面——由 task-03（e0b90f0a）三份产物同批核验（openapi.json 双路径 + 前端/daemon api-types 含 4 组新 DTO 零手写）+ verify Step 3 产物在场核对覆盖
