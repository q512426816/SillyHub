# verify target_files 对账：共享文件的 foreign 误判把「已做」判「声明未做」（活跃坑）

- 发现日期：2026-09-09
- 变更：2026-09-09-sessions-file-browser-three-pane（verify --done 被阻断）
- 状态：**活跃坑**（待工具修复）

## 现象

verify `--done` 的 target_files 对账报 `reconcile_missing_declared`（❌ 阻断）：

- task-02 声明 `frontend/src/components/sessions/session-list-panel.tsx` → 判 missing
- task-03 声明 `frontend/src/components/sessions/sessions-portal.tsx` → 判 missing

两文件**确实已按声明修改**（主仓 git status M 在案、diff 与任务卡一致、158 用例绿），但对账口径 actual=「主仓 dirty 集 − foreign 排除集」，两文件被 foreign 集剔除后，declared−actual 恒差 → 永远判「声明未做」。

## 根因（sillyspec v3.28.x，本机 3.28.3+）

`foreign-declared.js` 两层叠加：

1. `collectForeignDeclaredFiles` ②段：**只要 `.sillyspec/changes/<他者变更>/` 目录在（不看进度库活性）**，其 design §6 清单文件即进 foreign 集。多个**已完成但未归档**的旧变更（如 2026-09-03-group-chat-archive-delete 已上线多日）长期占据声明。
2. `filterStaleForeignDeclarations` 的活性判据是「文件在主仓 dirty 集或变更有存活 worktree」——**本变更自己的未提交改动恰好让这些文件留在 dirty 集**，反向把他者陈旧声明喂“活”。

净效果：**当前变更声明并真实修改的文件，只要也被任一未归档旧变更声明过，就在对账中凭空消失**。且 `splitOwnVsForeignDiffFiles` 先查 foreignMap 再归 own，文件双方都声明时判 foreign（own 优先缺失）。

## 修复建议（工具侧）

任一即可：

- A（最小）：`splitOwnVsForeignDiffFiles` 改 **own 优先**——文件出现在当前变更（design §6 / task target_files / quick --files）声明集时不进 foreign；
- B：target_files 对账（reconcileTargetFiles）对 `declared ∩ foreign` 降级为 warning（归属无法归因，提示人工确认），不阻断；
- C：foreign 收集 ②段接入进度库活性（change 已 verify/archive 完成的不算在途），从源头消陈旧声明。

## 绕过口径（当前，不修改声明、不撒谎）

无干净绕过。两条正路：

1. 把已完成未归档的旧变更走 archive 收尾（需变更属主人工确认——CLAUDE.md 流程）；
2. 等工具修复后重跑 `sillyspec run verify --done`（实质验证已全部 PASS，见该变更 verify-result.md；阻断纯属性误判）。

## 关联

- 坑 `verify-reconcile-foreign-wip`（foreign-declared.js 注释里自记的坑）只解决了「他者 WIP 混入本变更 module 命中」方向；本坑是它的对偶面：**本变更文件被他者声明反向误伤**。
