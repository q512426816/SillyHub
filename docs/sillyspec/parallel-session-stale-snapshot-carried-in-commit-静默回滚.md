# 并行会话旧分叉工作副本被整体夹带提交 → 静默回滚 main 已落地功能

- **状态**:活跃坑(已恢复 + 已加钉子测试防护,但工具/流程层未根治)
- **事故时点**:2026-09-26 07:26(commit `304eba982`)
- **发现时点**:2026-09-26 下午,用户报「变更详情页右下角项目资产消失、轻量变更标签不见了」
- **恢复变更**:`.sillyspec/changes/archive/2026-09-26-change-detail-restore-assets/`

## 现象

main 上一个主题为 daemon 遥测(thin 2026-09-26-daemon-hits-periodic-upload)的提交
`304eba982`,夹带了对变更详情页 `page.tsx` 的大改,把 9/25 当天已归档落地的三处功能
**静默回滚**:

| 被回滚内容 | 原落地 commit |
|---|---|
| aside 挂载 `ChangeAssetsCard`(沉淀资产卡,即用户说的"右下角项目资产") | `a7eca0727` |
| `STATUS_BADGE.thin` 品牌紫「轻量变更」徽章 + quick 存量口径 | `01a9dfcbd` |
| `ScopeAuditCommandCard` 的 `archived` 降级指路传参 | `9cb48847d` |

后端 `/changes/{cid}/assets` 端点与组件文件全程未被删,只有页面挂载层被覆盖——
线上现象是"卡片消失"而非"接口报错",更难察觉。

## 根因

1. **共享主仓 + 并行会话**:两条会话线在同一工作目录各自改代码。r18-full
   (observation events)线的会话基于 9/25 下午资产卡落地**之前**的分叉点写
   `page.tsx`(在其上完成观测事件卡换装)。
2. **提交时整体夹带**:daemon-hits 会话收口提交时,把工作目录里 r18-full 线的在途
   文件(`page.tsx`、platform_sync 重构、migration、新组件)一并 `git add` 进了与
   主题无关的 daemon 提交。
3. **旧分叉覆盖即回滚**:夹带的 `page.tsx` 不含 main 上后来落地的三处功能,整文件
   覆盖后等价于回滚——`git commit` 无冲突,CI 的聚焦测试也没覆盖挂载面,绿灯通过。

证据:`git diff 516cf7926(r18-full 线归档提交,至今不在 main 历史) 304eba982 --
page.tsx` 为**空**(逐字节一致)——304eba982 的页面文件就是并行线的旧版快照。

## 防护(已做)

- **页面级钉子测试** `page-restore-assets.test.tsx`(4 用例):断言资产卡/观测事件卡
  并存挂载、thin 徽章精确文本、archived 传参两派生。下次任何提交删挂载会被聚焦
  测试拦下,而不是等线上用户发现。
- 提交前 `git diff --stat` 审一眼:凡「提交里出现与变更主题无关的文件」,先逐文件
  归因再落(与 01a9dfcbd 时代 `guard-b-thin-flow.patch` 的 hunk 隔离是同一类问题
  的更重形态——那次靠 patch 隔离躲过,这次整文件夹带没躲过)。

## 待工具/流程根治(坑未闭合)

- sillyspec thin 收口(`flow done`)只对账 baseline..HEAD 的提交面,不感知「提交里的
  文件与本变更 input 声明的触达域无关」——夹带文件若无危险特征不会触发评审。
  可改进方向:flow done 冻结面生成时对**未在 tasks/requirements 提及的交付文件**
  出 advisory(类似现有「未登记模块图的交付目录」提示,已有先例可循)。
- 并行会话各自的工作目录隔离(会话专属 worktree)是结构性解法,`flow start` 输出里
  已提示「会话专属 worktree 自动并入」,但共享主仓场景仍靠自觉。
