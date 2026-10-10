# 已归档变更被远端 merge 复活 + CLI 误注册幽灵行（2026-10-10 实证）

## 现象
- `2026-10-09-attachment-inline-reference` 已于 10-09 22:55 完整归档（提交 eeb818a13：verify PASS、
  skip-apply 留痕、时间线齐全，且已推送 origin/main）。
- 10-10 08:34/08:42 两次 `Merge branch 'main'`（a43ce8b89 / 527482182）后，
  `.sillyspec/changes/2026-10-09-attachment-inline-reference/` 活跃路径重新出现**旧版四件套**
  （决策止 v1、module-impact 仍是 TODO 骨架、无 verify 工件）——merge 对侧分支基于归档前状态。
- `sillyspec next` 按目录产物推断把它列为「task 全勾，待验证」；
  随后 `sillyspec run verify --change <名>` 在进度库**新建行**（id 19937，verify in-progress）
  并把幽灵态推到平台（platform 侧也变 verify/active）。

## 定性
两环节叠加：
1. **git 层**：远端分支落后含归档删除提交的历史，merge 把已删除文件带回
   （对侧对同名文件有改动时 merge 不按「删除优先」收敛）。
2. **CLI 层**：
   - `run verify` 见活跃目录存在即自动注册新进度行，不校验「同名 archive 目录已存在」；
   - `doctor` 无「active 目录与 archive 目录同名」的幽灵复活探测器，
     反而给出 `--align-execute-progress`（会错误地给幽灵补 execute 戳）。

## 处置（2026-10-10，提交 2e598f5b7）
1. 递归 diff 活跃 vs 归档目录，证实归档侧为超集（v2/v3 决策、终版 module-impact）零信息损失；
2. `git rm -r` 幽灵活跃目录并提交；
3. 进度库按既有归档终态模板手工收口（对照正常归档行形态）：
   `changes.status='archived' / current_stage='archive'`，stages 全 pending 唯 archive completed，
   删除误注册产生的 verify steps。

## 工具侧改进建议（待 sillyspec 修复后移入 finished/）
- `run <stage> --change` 注册前查同名 `changes/archive/<名>/` 存在即拒绝并提示幽灵复活；
- `doctor` 增加「active×archive 同名」检测项并给出清理建议（勿建议 align）；
- merge 后建议人工核对 `.sillyspec/changes/` 与 `changes/archive/` 无同名目录。

## 复发判据
本仓多机/多会话并行 + 频繁 merge 远端时，任何已归档变更的活跃路径旧文件都可能被带回。
merge 后跑 `sillyspec next` 若出现「已归档过的变更名」即命中本坑。
