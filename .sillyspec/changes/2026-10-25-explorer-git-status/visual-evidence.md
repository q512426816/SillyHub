# 渲染对照证据（visual-evidence）

> 2026-10-25-explorer-git-status · execute 阶段落盘。UI 触达面：Git 日志页
> 「工作区更改」卡 + 工作区文件 diff 弹窗 + explorer 树四色着色。
> 证据形态：原型 ↔ 实现对照结论 + 组件测试锚点（单测即行为证据；集成冒烟
> 见 plan.md 全局验收标准 4，留给 verify 阶段 dev 环境实数据截图补强）。

## ① 「工作区更改」卡（原型 prototype-explorer-git-status.html ①）

| 原型要素 | 实现落点（worktree） | 测试锚点 |
|---|---|---|
| 卡头：标题+修改/删除/新文件/忽略计数徽标+快照时间+刷新+折叠 | `frontend/src/components/git-log/worktree-changes-card.tsx`（data-testid=worktree-changes-card / -refresh / -toggle） | worktree-changes-card.test.tsx「卡头汇总计数」用例（2 处修改/1 删除/2 新文件/忽略 2 项） |
| 三分组：更改（含 HEAD 基线说明）/未纳入版本管理/已忽略（顶层聚合） | 同上（data-testid=worktree-group-changed/-untracked/-ignored；基线文案「对比基线：最近一次提交 a9f5fae1」） | 同文件「三分组渲染归属」用例 |
| 文件行四色 + +N/−N + 状态徽标（untracked 无行数仅徽标） | WORKTREE_STATUS_META（D-002 token：text-success/text-primary/text-error line-through/text-muted-foreground） | 同文件「四色类名」「untracked 无行数仅新文件徽标」用例 |
| 忽略行不可点、目录聚合行 | IgnoredRow / StatusTreeRows（buildFileTree 复用） | 同文件忽略行无点击语义断言 |
| 页面挂载：状态条之下、提交列表工具栏之上 | `frontend/src/app/(dashboard)/workspaces/[id]/git-log/page.tsx`（GitStatusBar 之后、degradeCard 之前；no_git 页面门控） | git-log-page.test.tsx「更改卡挂载」三用例（在场/点击弹窗/no_git 不渲染） |

## ② 工作区文件 diff 弹窗（原型 ②）

| 原型要素 | 实现落点 | 测试锚点 |
|---|---|---|
| 弹窗壳（antd Modal，头部状态徽标+文件路径+基线说明） | `frontend/src/components/git-log/worktree-diff-modal.tsx`（data-testid=worktree-diff-path/-status-badge） | worktree-diff-modal.test.tsx「modified 头部徽标+基线 head_short」 |
| 三态：modified 红绿 / untracked 全 + / deleted 全 − | 复用 file-tree.tsx 导出的 parseUnifiedDiff + DiffBody | 同文件三态渲染三用例（data-diff-kind 计数断言） |
| 64KB 截断提示 / 二进制提示不渲染 diff / 竞态空 diff 提示 | truncated 条 + binary 提示 + empty 提示 | 同文件 truncated/binary/空态用例 |
| 错误分型降级（422 引导升级/404 双文案/502/504 带重试） | degradeCopy 按 ApiError.status 分型 | 同文件四降级用例 |

## ③ explorer 树着色（原型 ③）

| 原型要素 | 实现落点 | 测试锚点 |
|---|---|---|
| 文件名四色（D-002 语义 token） | `frontend/src/components/explorer/file-explorer.tsx` GitStatusName（span[data-git-status][title]） | file-explorer-git-status.test.tsx added/untracked 绿 + modified 蓝用例 |
| 含改动祖先目录名旁蓝点（ignored 不贡献，D-011） | 同上 dirtyAncestors 前缀集合（data-testid=git-dirty-dot-*） | 同文件蓝点用例（src/notes 有点、docs/node_modules 无点） |
| 忽略条目灰 + 「忽略」小徽标（不递归，D-003@v2） | 同上 ignoredPaths（目录去尾 / 归一） | 同文件忽略目录/散落文件用例 |
| 点击行为不变（仍内容预览，D-005） | onSelect 链路零改动 | 同文件「点击行为回归」用例（onSelectFile 断言） |
| 晚到 dirty-files 变色（Grill P2-③ 时序） | 渲染期 context 读取（不重建 treeData） | 同文件「晚到变色」用例 |
| 查询失败静默降级无色 | maps=null → context null | 同文件「查询失败」用例 |

## 原型冻结与漂移对账（R-05）

- `pnpm prototype:build` 重编译后 `frontend/prototype-dist/explorer-git-status.html` 与基线字节一致（git diff 为空，同源冻结成立）。
- 其余 11 个 prototype-dist 产物依赖重装漂移已 `git checkout --` 还原至 worktree 基线态，本变更提交面零夹带。
