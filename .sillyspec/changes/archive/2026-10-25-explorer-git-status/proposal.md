---
author: qinyi
created_at: 2026-10-25 19:51:00
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机

平台上 agent 在工作区里干活，管理者需要不借助外部 IDE 一眼看清「agent 动了哪些文件、还没提交什么、具体改了什么」。现有工作区「文件」页与「Git 日志」页对 git 的感知残缺：文件树无状态标记，状态条只有汇总数字无文件清单，也没有「工作区未提交改动 vs 最近一次提交」的对比能力。本变更对齐 IDEA 的文件状态体验（用户提供的参照截图），把「看改动、看对比」收进平台内完成。

## 关键问题

1. **看不见状态**：explorer 文件树（`frontend/src/components/explorer/file-explorer.tsx:489`）纯文件浏览，改了哪个文件、哪个是新增、哪个被忽略，界面零提示；
2. **看得见数字看不见文件**：Git 日志页状态条只有 files_changed/additions/deletions/untracked_count 汇总（`backend/app/modules/git_log/schema.py:126`），无文件级清单，ignored 完全未采集；
3. **对比断档**：现有 diff 端点仅支持「提交内对比」（`git show <sha>`，`sillyhub-daemon/src/host-fs-handler.ts:1567`），未提交改动无法在平台内看红绿对比。

## 变更范围

按已确认的方案 A（平行状态接口 + 前端 join，D-007）三层落地：

- **daemon**：新增 `git_dirty_files`（改动文件清单 + 忽略顶层聚合）与 `git_worktree_diff`（工作区单文件 vs HEAD）两个只读平名 RPC，沿用既有安全守卫与不抛错误约定；
- **backend**：git_log 模块新增 `GET .../dirty-files`、`GET .../worktree-diff` 两个只读端点（WORKSPACE_READ），复用绑定解析/probe/降级骨架；schema 变更同批 `pnpm gen:types` 双份（frontend + daemon）；
- **frontend**：Git 日志页新增「工作区更改」卡（IDEA 三分组树 + 四色 + 点击看 diff 弹窗）；explorer「文件」页树按同一份状态清单四色着色（点击行为不变）。

真码原型已生成并经用户确认：`.sillyspec/changes/2026-10-25-explorer-git-status/prototype-explorer-git-status.html`（源 `frontend/src/components/prototype/explorer-git-status-view.tsx`）。

## 不在范围内（显式清单）

- 不做平台内 git 提交/暂存/推送（修改集合卡纯只读，无提交按钮）；
- 不做实时推送/文件监听（方案 C 已否决，D-009）——状态为拉取式快照；
- 不改动现有会话「文件变更卡」颜色语义（D-002，全局统一另立变更）；
- 不递归采集忽略目录内部文件（D-003）；
- 不区分 staged/unstaged 暂存分组（D-004）；
- 不改变 explorer 树节点点击行为（D-005）；
- 不做 daemon 侧重命名检测（`--no-renames` 口径，R-04）。

## 成功标准（可验证）

- Git 日志页「工作区更改」卡展示改动文件三分组树（更改/未纳入版本管理/已忽略聚合），文件名按 IDEA 四色着色（新增绿/修改蓝/删除红删除线/忽略灰），行尾显示增删行数与状态徽标；
- 点击卡片中任一文件行，弹窗展示该文件「工作区 vs 最近一次提交」的 unified diff；modified 红绿对比、untracked 全绿、deleted 全红；超过 64KB 截断提示；二进制文件提示不渲染 diff；
- explorer「文件」页树文件名按同一份状态清单着色，含改动的目录名旁有蓝点，忽略条目灰色并带「忽略」徽标；点击文件行为仍为内容预览；
- daemon 旧版本（无新 RPC）时新卡渲染 422 降级卡引导升级，既有提交历史功能零影响；未绑定 404 / daemon 离线 502 / 非 git 工作区 no_git 空态均正确降级；
- `backend/openapi.json`、`frontend/src/lib/api-types.ts`、`sillyhub-daemon/src/api-types.ts` 三份类型产物同批再生成并提交，无手写类型；
- 三层测试全绿：daemon 解析单测、backend 端点降级测试、前端组件与 explorer 着色测试（仅跑本变更相关测试，全量留给 CI）。
