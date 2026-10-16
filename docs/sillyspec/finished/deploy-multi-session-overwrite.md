# 多会话共享生产部署无合流保障——分叉分支打包覆盖 main 修复（功能回退事故）

> 记录时间：2026-10-16 · 来源：2026-10-15-server-logs-dockerfile-fix 生产回退事故
> 状态：活跃坑（约定绕过=基于 main HEAD 打包，待流程化）

## 现象

上午刚修复并部署验证通过的「服务器日志容器内可写」（main 提交 7eaa1dd03，镜像 commit 9d40341aa），中午被另一次部署**静默回退**：生产运行版本变为 f62065e2f（另一会话从其**分叉分支**打包，分叉点 d495d6766 早于修复提交），新容器 `/data/logs` 不存在 → 页面日志卡再次「尚未生成」。

两个会话都「正常部署」，结果互相覆盖——用户侧只看到功能时好时坏。

## 根因

1. build-and-save.sh 的镜像内容 = **打包时的工作区快照**（Dockerfile `COPY . .`），各会话从自己 worktree/分支打包 → 镜像=各自分支代码；
2. 打包脚本不校验「打包源是否为 main/是否落后 main」，deploy skill 也没有部署登记/互斥；
3. 分叉分支不包含 main 上的修复（反向亦然）——部署即回退。

## 影响

- 已修复功能在生产被回退且无告警（页面只表现为"又坏了"，根因在部署层不在代码层）；
- 排查成本高（需对比镜像 commit、git 分叉点、镜像 Dockerfile 内容）。

## 绕过（当前约定）

1. **打包部署前先确认 `git log origin/main..HEAD` 为空且工作区相对 main 干净**（或直接基于 main HEAD）；
2. 部署后核对 `curl /api/health` 的 commit_sha 与预期一致——不一致说明被别人覆盖；
3. 发现覆盖后用 main HEAD 重新打包恢复（本次处置路径）。

## 修复建议

1. build-and-save.sh 开头加校验：当前 HEAD 不在 main 线（`git merge-base --is-ancestor HEAD main` 失败）或落后 origin/main 时告警确认；
2. 部署互斥/登记：写 `deploy/.last-deploy`（commit_sha+会话+时间），load-and-up 前对比提示；
3. 长期：生产部署收敛到统一入口（CI 或指定会话），杜绝多会话各自打包。

## 处置记录（2026-10-16）——部署并流校验闸已落，坑关闭

- **修复已实施并归档**：本仓变更 `2026-10-16-deploy-convergence-guard`（task-01/02/03 全勾，提交 d581d40b4）——`build-and-save.sh` 打包前新增「部署并流校验」[0/5] 闸：非 main 分支打包 exit 1（需 `ALLOW_NON_MAIN_DEPLOY=1` 显式放行）、应用目录脏工作区 exit 1（需 `ALLOW_DIRTY_DEPLOY=1`）、打包源分支 + sha 打印留痕；deploy-to-server skill 新增「部署并流校验」节（互覆事故背景 / 部署后 commit_sha 核对 / 被覆盖识别与恢复）。
- **与坑文建议对账**：建议 1（打包前校验 main 线）已落——分支名硬闸比「告警确认」更强，但未做「落后 origin/main」检测（stale main 仍可打包，靠部署后 commit_sha 核对兜）；建议 2 的部署登记（`.last-deploy`）未自动化，以 skill 纪律面（部署后核对 + 被覆盖识别与恢复）落地；建议 3（生产部署收敛统一入口）属长期项未实施——多会话各自打包在闸门拦截下风险已收窄，收敛决策留后续。
