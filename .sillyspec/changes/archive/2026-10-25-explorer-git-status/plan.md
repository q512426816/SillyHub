---
plan_level: full
execution_mode: main
---

# 实现计划（Plan）— 2026-10-25-explorer-git-status

## Spike 前置验证
无——git 命令旗标合法性（`--no-renames`/`--porcelain=v2`/no-index exit 语义）与降级链路已由 Design Grill 独立评审在本仓实证（review.json X-A~X-E），无剩余技术不确定性。

## Wave 1（并行，无依赖——daemon TS 与 backend py 文件集/测试栈互不相交）
- task-01
- task-02

## Wave 2（依赖 Wave 1 的 task-02）
- task-03

## Wave 3（依赖 Wave 2 的 task-03 类型产物）
- task-04

## Wave 4（依赖 task-04 的 lib 扩展；task-05/07 文件不相交可并行）
- task-05
- task-07

## Wave 5（依赖 task-04 + task-05）
- task-06

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | daemon 双指令实现+注册+解析单测 | W1 | P0 | — | FR-01/02/03, D-006/010/011 | `gitDirtyFiles`+`gitWorktreeDiff`（host-fs-handler.ts）+ 平名注册（daemon.ts）+ `tests/host-fs-handler-git-dirty-files.test.ts` |
| task-02 | backend 双端点+降级测试 | W1 | P0 | — | FR-04, D-006 | schema 4 DTO + service 两方法 + router 两端点 + `tests/modules/git_log/test_git_log_dirty_files.py`（新目录含 __init__.py） |
| task-03 | gen:types 三份产物同批再生成 | W2 | P0 | task-02 | FR-05 | `pnpm gen:types` + `pnpm -C sillyhub-daemon gen:types`；前置 `pnpm exec tsc --version` 健康检查 |
| task-04 | 前端取数层+工作区更改卡+卡片测试 | W3 | P0 | task-03 | FR-02, D-001/002/007 | lib/git-log.ts **一次性扩展**（fetchDirtyFiles + fetchWorktreeDiff + 两 hook + queryKeys——plan-review P2-③ 消歧：fetchWorktreeDiff 归本卡，task-05 不再动 lib）+ file-tree.tsx 导出 `buildFileTree`（更改卡分组树消费；与 task-05 分 Wave 串行共享该文件，合法）+ `worktree-changes-card.tsx` + 卡片测试 |
| task-05 | 文件 diff 弹窗+file-tree 导出+弹窗测试 | W4 | P0 | task-04 | FR-03, D-004/010 | file-tree.tsx 导出 `buildFileTree`/diff 渲染件 + `worktree-diff-modal.tsx`（组件内消费 useGitLogWorktreeDiff 取数+错误分型降级，对齐 scope-file-diff-modal 先例）+ 弹窗测试；related_tests：`__tests__/file-tree.test.tsx`（导出改动回归，plan-review P2-①） |
| task-06 | Git 日志页挂载接线 | W5 | P0 | task-04,05 | FR-02/03 | git-log/page.tsx 挂卡片（GitStatusBar 下）+ 弹窗状态接线 + no_git 空态不堆叠；related_tests：`__tests__/git-log-page.test.tsx`、`__tests__/git-status-bar.test.tsx`（page 结构回归，plan-review P2-①） |
| task-07 | explorer 树四色着色+着色测试+收尾对账 | W4 | P0 | task-04 | FR-01, D-003@v2/005/011 | file-explorer.tsx 渲染期状态映射（Grill P2-③ 实现注意）+ 着色测试；related_tests：`__tests__/file-explorer.test.tsx`（着色回归，plan-review P2-①）；收尾对账显式点名 3 个原型件（plan-review P2-②）：`frontend/src/components/prototype/explorer-git-status-view.tsx`、`frontend/scripts/prototype-build.mjs`、`frontend/prototype-dist/explorer-git-status.html`（重跑 `pnpm prototype:build` 冻结）+ 漂移产物还原 + 验收对照 |

## 关键路径
task-02 → task-03 → task-04 → task-06（4 步，决定最短交付周期；task-01 与该链并行）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）
- 全链路只读：不引入任何写操作（不提交、不暂存、不 checkout）；
- IDEA 颜色语义仅本变更新功能（D-002）：新增绿 `text-success` / 修改蓝 `text-primary` / 删除红+删除线 `text-error line-through` / 忽略灰 `text-muted-foreground`；**不改动** `frontend/src/components/daemon/file-changes/file-changes-card.tsx` 的 FILE_STATUS_META；
- explorer 树节点点击行为不变（仍为内容预览，D-005）；文件级 diff 仅从修改集合卡触发；
- 类型零手写：`backend/openapi.json`、`frontend/src/lib/api-types.ts`、`sillyhub-daemon/src/api-types.ts` 三份产物同批 gen:types 生成并同变更提交（CLAUDE.md 规则 21 双份义务）；
- daemon git 调用一律 execFile argv 数组 + `assertWithinAllowedRoots`/`assertGitPathspec` + `GIT_QUOTEPATH_OFF_ARGS`；新增方法不抛错误（error 通道返回，对齐既有五 git 方法）；
- untracked diff 分支不走 runCmd ok 通道：局部 execFile 读退出码，exit 0/1 均成功、≥2 或 killed 才 error，stderr 的 CRLF warning 不进 error 文案（D-010）；
- porcelain v2 解析：`1` 条目前段单空格分字段、行内首个 `\t` 切出 path；`u` 条目按 modified 归类；ignored 顶层聚合（`--directory`）；祖先蓝点集合不含 ignored（D-011/D-003@v2）；
- 仅跑本变更相关测试，禁止全量测试（规则 0，全量归 CI）；
- UI 与文档中文；代码兼容 Windows/Linux/macOS；
- 提交纪律：Conventional Commits 中文 subject、只提交本变更文件、hook 拦截禁跳过（禁 --no-verify）、提交后核实落库。

## 全局验收标准
1. daemon / backend / 前端三层本变更相关测试全绿；
2. 三份类型产物同批再生成且无手写类型残留；
3. （brownfield）explorer 既有四端点、git-log 既有四端点、会话文件变更卡行为零变化——既有相关测试不破；
4. 集成冒烟：dev 环境下 Git 日志页「工作区更改」卡与 explorer 树着色在本仓工作区实数据可见（组件单测全绿 ≠ 集成正确）；
5. 原型产物与源码同源：`pnpm prototype:build` 重编译 `explorer-git-status.html` diff 为空；`frontend/prototype-dist/` 其余 11 个漂移产物已还原（R-05）。

## Review Focus 盲区清单（隐含面）
| # | 输入/条件 | 合理人预期行为 | 承接落点 |
|---|---|---|---|
| 1 | 文件名含空格+中文（quotepath off）在 porcelain v2 与 numstat 两路采集的 path 解析一致 | 两路 join 按 path 精确命中，行数正确落到同一文件 | task-01（单测含中文+空格路径用例） |
| 2 | detached HEAD 状态下采集（branch.head=(detached)） | dirty-files 正常返回清单、head_short 正常，不误判空仓库 | task-01（单测 detached 用例） |
| 3 | 超大 diff（>64KB）多字节字符在截断边界被切 | truncated=true 且前端显示截断提示，不渲染半行乱码为完整内容 | task-05（弹窗 truncated 提示断言） |
| 4 | no_git 工作区打开 Git 日志页（gitMode=no_git） | 修改集合卡不渲染或空态，与既有 no_git 空态卡不重复堆叠 | task-06（挂载条件断言） |

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| FR-01 | task-01, task-04, task-07 | explorer 着色测试 + 卡片分组测试 + daemon 解析单测 |
| FR-02 | task-01, task-04, task-06 | 卡片渲染/计数/刷新测试 + 页面挂载断言 |
| FR-03 | task-01, task-05, task-06 | diff 分流单测（untracked exit 1 语义）+ 弹窗降级测试 |
| FR-04 | task-02 | 端点降级测试（404/502/422/no_git） |
| FR-05 | task-03 | 三份产物再生成 diff 一致 |
| D-001@v1 | task-04, task-06 | 卡片挂 Git 日志页 |
| D-002@v1 | task-04, task-05, task-07 | 四色类名断言；FILE_STATUS_META 零改动 |
| D-003@v2 | task-01, task-07 | ignored 顶层聚合解析单测 |
| D-004@v1 | task-01, task-05 | HEAD 基线 diff 分流单测 + 弹窗三态渲染 |
| D-005@v1 | task-07 | explorer 点击行为回归断言 |
| D-006@v1 | task-01, task-02 | 平名注册形态 + 绑定/降级复用测试 |
| D-007@v1 | task-01, task-04, task-07 | 单一 dirty-files 数据源被两处消费 |
| D-008@v1 | task-07 | explorer 契约零改动（既有 explorer 测试不破） |
| D-009@v1 | task-04 | 卡片仅手动刷新无轮询 |
| D-010@v1 | task-01 | untracked 分支局部 execFile 退出码单测 |
| D-011@v1 | task-01, task-07 | porcelain 末段 rejoin/u 条目/蓝点口径单测 |
