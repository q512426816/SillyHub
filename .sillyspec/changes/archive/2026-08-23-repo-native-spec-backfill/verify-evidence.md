---
author: qinyi
created_at: 2026-08-23 22:35:00
---

# 现场验证证据（verify-evidence）— 修复 repo-native spec 回灌断链

> task-05 现场端到端验证记录（Wave 4，2026-08-23 22:29-22:35 本地实测）。正式 verify 阶段复核本文件。

## 1. 指针再中毒复查 ✅

```
$ ls /Users/qinyi/SillyHub/.sillyspec-platform*
/Users/qinyi/SillyHub/.sillyspec-platform-cleaned      # 仅 HUB-12 保护 marker
```

主仓无 .sillyspec-platform.json / .sillyspec-platform-managed（21:15 清理后未再中毒；活跃平台会话期间未重跑旧 scan 模板）。工具仓提交 2c35ab2 后 CLI 3.27.3 已具备写入拦截兜底（writePlatformPointer 单点收口）。

## 2. CLI 生效态 ✅

```
$ sillyspec --version
3.27.3
```

- task-04 冒烟 b（tmp fixture 自指指针）：`⚠️ 检测到自指平台指针（repo-native junction 回环，specRoot 指回本地 .sillyspec），已忽略并按本地模式运行` + exit 0。
- task-04 冒烟 c（--spec-dir 真外部目录）：平台/外部模式保持，exit 0。
- task-04 冒烟 d：全局安装源码 isSelfReferentialSpecRoot/isPlatformMode 均为 function。

## 3. 本地变更上行平台（断链修复主验证）✅ 决定性证据

```
$ curl -H "Authorization: Bearer shpsync_…" http://localhost:8000/api/changes/-/spec-manifest
服务器 manifest 总文件数: 4140 | 本变更命中: 13
changes/2026-08-23-repo-native-spec-backfill/decisions.md  v2
…/design.md v3 …/plan.md v3 …/tasks.md v7（每次勾选实时上行）…
…/tasks/task-01.md v2 … task-05.md v2 全部 13 文件在服务器权威清单
```

- 上行通道：CLI 内置 sync（local.yaml platform 段 shpsync_ token + resolve-by-root-path 归属 workspace de24ed7c），零平台参数本地模式。
- 变更中心数据源（backend reparse 读服务器镜像）已含本变更全部产物——proposal 成功标准 1 达成（本变更自身即活体样本）。

## 4. 平台会话 junction 回灌链路 ✅（不回归）

```
$ ls -la ~/.sillyhub/daemon/specs/de24ed7c-…-2021d6
lrwxr-xr-x … -> /Users/qinyi/SillyHub/.sillyspec        # junction 健在
$ curl http://localhost:8000/api/health
{"status":"ok","db":"ok","redis":"ok", …}
```

- daemon junction（repo-native D-005）未受本次改动影响；会话结束 postSpecSync 整树回灌链路无代码改动（D-003@v1 daemon 零改动约束达成）。
- 会话级回灌触发留待既有活跃平台会话自然结束观测（constraints：不新建破坏性会话）。

## 5. backend 模板部署说明（非阻断）

task-01 代码在 worktree 分支 sillyspec/2026-08-23-repo-native-spec-backfill，apply 回 main + backend 重启后生效（运行中 backend commit_sha=0a632e28 不含本改动）。repo-native scan 模板行为已由 26 项单测覆盖（三策略快照断言），现场生效态抽查归 verify 阶段（apply 后）。

## 结论

成功标准 1 ✅（manifest 13 文件实证）/ 2 ✅（3.27.3 冒烟 + 现场指针干净）/ 3 ✅（platform-managed/repo-mirrored 逐字节快照断言 + 外部目录平台模式冒烟）。验收口径全项达成，待 verify 阶段正式复核。
