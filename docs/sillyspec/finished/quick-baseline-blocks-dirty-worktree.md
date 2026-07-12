# quick baseline 守卫在脏工作区硬拦 step3（待工具修复）

> 记录时间：2026-07-12
> 性质：SillySpec 工具坑（活跃，待工具修复）
> 触发场景：ql-20260712-001-fix-kill-zombie（P0 修两个僵尸 bug）

## 现象
工作区存在大量**预存脏文件**（本次会话开始时 git status 就有 60 个：archive 模块删除、workspace fixtures、daemon session 改动、migration、png、docs 等，**均非本次 quick 产生**）时，`sillyspec run quick --done` 在 step3「暂存和更新记录」被 baseline 守卫硬性拦截：

- 报「覆盖 baseline 文件」列出几十个预存改动
- 报「新增文件（需 --allow-new）」列出几十个预存新增（含 .png、docs、migration、fixtures 等）
- 提示「请恢复/拆分这些变更，或重新运行 quick 并显式声明范围」
- `quick 已停止`，--done 失败

## 已尝试（均无效）
对 step3 `--done` 依次尝试，单独与组合均仍 blocked：
- `--files <本次 4 个文件>`（显式声明本次范围）
- `--force-baseline`（允许覆盖 baseline）
- `--allow-new`（允许新增）
- `--confirm`（接受审计结果）
- `--skip-approval`（跳过校验门）

## 根因猜测
quick step1 启动时输出了「🛡️ quick 变更边界已记录: 60 个已有脏文件」，说明 baseline **知道**这些是预存脏文件。但 step3 审计时仍把**全部工作区差异**（含 baseline 已记录的预存脏文件）当作「本次 quick 违规」报。`--files` 显式声明本次范围也未被审计逻辑采纳。即 **baseline 审计不区分「本次 quick 改动」与「预存脏文件」**，且无视 `--files` 边界声明。

## 影响
- 代码改动本身已完成验证（pytest 588 passed / mypy Success / ruff 全过），功能与质量不受影响
- quick 流程无法 `--done` step3，会话卡在进度 2/3
- QUICKLOG 仍可手动维护（已记录「已完成 + 结果段」）

## 当前绕过
**无有效 CLI 绕过**。本次实际处理：代码保留在主工作区，QUICKLOG 手动标记完成 + 结果，待用户决定 commit 或清理工作区后重跑收尾。

## 建议（工具侧）
baseline 审计应：
1. 尊重 step1 记录的「已有脏文件」边界，将其从违规列表排除；
2. 尊重 `--files` 声明的本次范围，只对「本次 quick 实际新增/覆盖的文件」报错；
3. `--force-baseline --allow-new --confirm` 组合应能强制通过（当前完全失效）。

## 关联
- 本次改动：`backend/app/modules/daemon/lease_service.py`、`backend/app/modules/agent/control.py` + 2 测试（P0-1 修 interactive kill 僵尸、P0-2 修 MissionControl.cancel 造僵尸）
- 审计文档：`docs/agent-platform-deep-audit-2026-07-12.md` 第 3 节发现 1/4 + P0-1/P0-2
