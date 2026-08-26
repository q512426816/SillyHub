---
author: qinyi
created_at: 2026-08-26 21:58:10
change: 2026-08-26-workspace-git-status
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 工作区成员（开发者） | 有 WORKSPACE_READ 权限，在 Git 日志页/会话页查看工作区 git 健康状态 |
| daemon（宿主机） | 执行 fetch + status + diff 采集（只读 + 网络同步） |
| platform backend | 复用 git_log 模块链路组装 GitLogStatusResponse |

## 功能需求

### FR-01: Git 状态数据端点
覆盖决策：D-002@v1
Given 工作区为 git 仓库且用户已绑定在线 daemon
When GET /api/workspaces/{wid}/git-log/status
Then 返回 branch/detached/upstream/ahead/behind/dirty{files_changed,additions,deletions,untracked_count}/head_short/empty/fetch{performed,error}/synced_at/git_mode；WORKSPACE_READ 门控；no_git 空态 200；离线 502/超时 504/旧版 422 与既有映射一致

### FR-02: 自动 fetch 与降级
覆盖决策：D-001@v1
Given 打开任一挂载页
When useGitLogStatus 触发（staleTime 60s，两页共享缓存）
Then daemon 侧先 git fetch --quiet（15s 超时）；成功→ahead/behind 为新鲜值且 fetch.performed=true；超时→fetch_timeout；失败→fetch_failed；无 remote（git remote 预检为空）→no_remote 不执行 fetch；任一失败不阻断其余字段，behind 返回 stale 值 + 前端黄条"无法连接远程，显示上次同步数据"

### FR-03: 未提交改动统计
Given 工作区有未提交改动
When 采集 git diff HEAD --numstat --no-renames
Then additions/deletions 为行数汇总（staged+unstaged 合并），files_changed ≡ numstat 行数（单源；index-only 差异声明排除），binary 行计文件不计行数；untracked 数来自 porcelain "? " 条目

### FR-04: 状态条双形态展示
覆盖决策：D-003@v1
Given Git 日志页打开
When 状态条渲染（variant=full）
Then 分支徽标（⎇）+ 跟踪名 + ↑N 未推送 + ↓N 远程新提交 + 改动 +A/−D（N 文件）+ 未跟踪 N + "已同步 · HH:MM"
Given 会话页打开且 scope.kind=workspace
When 状态条渲染（variant=compact，PageHeader actions 槽）
Then 分支/↑/↓/+− 紧凑展示（Tooltip 展开细节）；change/quicklog/platform scope 不挂载
Given 加载中 / fetch 失败
Then 骨架文案 / 黄条（full）或 ⚠（compact）

### FR-05: 边界形态
Given 无 upstream（本地新分支）→ 无 ↑↓（ahead/behind null）
Given detached HEAD → 分支徽标显示 head_short + "游离头指针"提示
Given 空仓库（branch.oid='(initial)'）→ empty=true 全空态提示
Given 非 git 工作区 → git_mode=no_git 空态卡（沿用既有）

### FR-06: 只读与安全
覆盖决策：D-002@v1
Given 全链路
Then 本地零写操作（fetch 为网络同步）；root 唯一入参（零新增注入面）；全部 argv 独立经 execFile；无 DB 写入

### FR-07: 主题与缓存合规
覆盖决策：D-003@v1
Given 三主题任一
Then 状态条颜色全走 themes.ts 消费链（brand 徽标/accent ↑/warning ↓与黄条/success +/error −）零硬编码 hex；两页 60s 内共享缓存只触发一次远程 fetch（测试断言双实例单请求）；>60s 窗口聚焦重取属预期

## 非功能需求

- 兼容性：既有端点/schema/组件零改动；旧 daemon → 422 提示升级；回退 = 移除两处挂载
- 可测试：daemon 解析/降级单测（含 porcelain v2 六类实测形态）、backend 六分支集成测试、前端双形态+缓存组件测试
- UI 中文；tab 内无视口响应式前缀；gen:types 两产物随变更提交

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR |
|---|---|
| D-001@v1 | FR-02 |
| D-002@v1 | FR-01, FR-06 |
| D-003@v1 | FR-04, FR-07 |
