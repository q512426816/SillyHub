---
title: thin flow done 两个收尾坑——src 未提交不入冻结面且归档后无重冻结入口；提交归属只认半角括号
date: 2026-10-08
status: 活跃（工具缺陷待修；守则可先行）
source: 2026-10-07-assets-patch-scope-audit-fallback 活体——autopilot 单跑 flow done 后发现冻结 patch 只含 9 个并行会话文件+4 个规格件，本变更 4 个 src 文件全部缺席
---

# thin 收尾冻结面 × 提交归属解析两个坑

> 一句话守则：**thin 收口前先把 src 提交掉（提交信息带半角括号变更名
> `(YYYY-MM-DD-<名>)`），再跑 `flow done`；flow done 一旦跑到归档子步，
> 重冻结入口即关闭。**

## 坑一：src 未提交 → 不入冻结面；autopilot 单跑到底 → 归档后无重冻结入口

- `collectFreezeFiles`（flow-parity.js）：共享主仓里**未提交** dirty 交付面
  不入冻结面（无法归属，只警告"三选一：①接受缺口 ②重跑 flow done
  --freeze-dirty ③worktree"）；只有 committed 面与 `.sillyspec/` 本变更目录
  工作树件入冻。
- 但 autopilot/单跑 flow done 会**同一次跑完 patch→…→archive→events 全部
  子步**——警告里的选项②"重跑 flow done --freeze-dirty"在同次归档后已不可
  达（flow done 只认活跃目录 flow-state.yaml，归档即拒收）。
- 实测损失：冻结 change.patch/change-patch.json/scope-audit.* 全部缺本变更
  src，却吸入 baseline..HEAD 窗口内并行会话（ci-sweep 系列）的 9 个已提交
  测试文件。
- 修复路径（协议重入，已验证可用）：
  1. 先 `git commit` 本变更 src（信息带半角括号变更名，见坑二）；
  2. 归档目录 `mv` 回 `.sillyspec/changes/<名>/`；
  3. flow-state.yaml 手工复位 `archive:`/`events:` 两个子步标记为空；
  4. 重跑 `sillyspec flow done --change <名>`——patch 子步的漂移检测
     （detectPatchDrift：freezeHead..HEAD 含本变更交付提交）自动重冻结 +
     隔离旧 review + 重归档。
- 工具侧修复建议：① flow done 在 dirty 警告出现时**不进入 archive 子步**
  （停在半态等 --freeze-dirty/接受缺口 的显式选择）；或 ② 提供 `flow done
  --change <已归档名> --refreeze` 的归档态重入口（漂移机制本就支持重建）。

## 坑二：提交归属解析只认半角括号——全角（）惯例下 drift/归属双失灵

- `parseChangeNamesFromSubject`（foreign-declared.js）正则
  `/\((\d{4}-\d{2}-\d{2}-[A-Za-z0-9._-]+)\)/g` 只匹配**半角** `(...)`。
- 本仓提交惯例（含工具自己输出的示例）常写全角 `（thin 2026-10-07-xxx；…）`
  ——解析为空集 → detectPatchDrift 判无本变更交付（不触发重冻结）、
  buildCommitAttribution 全部落 unknown（归属面失真但不炸）。
- 守则：交付提交信息里变更名一律用**半角括号**尾缀 `(2026-10-08-<名>)`。
- 工具侧修复建议：正则兼容全角括号 `（…）` 与 `（thin <名>…）` 形态。

## 关联

- 上游缺陷（thin 不落快照/厚不冻 patch 的镜像缺口）已由工具双轨统一
  （2026-10-07-unify-close-trace）+ 平台读回退（2026-10-07-assets-patch-
  scope-audit-fallback）收口，记录在 finished/thin-flow-done-no-scope-audit-
  snapshot.md；本文件是收尾链上的两个新坑。
