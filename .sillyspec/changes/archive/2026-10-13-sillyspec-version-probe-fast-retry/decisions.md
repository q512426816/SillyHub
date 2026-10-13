---
author: flow-machine-draft
created_at: 2026-10-13T15:17:14.501Z
---
# 决策记录（Decisions）— 2026-10-13-sillyspec-version-probe-fast-retry

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：version 确实不存在（真未安装）的机器上，每 120s 白跑一次 `sillyspec --version`（最坏 30s 超时等待）。代价评估：单次只读命令 + 失败即返回，120s 一次的频率与第四循环（1h）相比可忽略；且第四循环的 `checkAndUpgrade` 在未安装场景本会触发安装路径，重探成功反而是其前置数据修复——不做退避（对数/上限封顶）是为保持实现最小，若实测有噪音再加指数退避。 试过放弃的方案：①「注册期失败后前 N 分钟密集重试（定时器阵列）」——需要引入 setTimeout 生命周期管理（stop 清理、重启残留），与 manager 现有「零自有定时器除 deferred 复查外」的形态冲突，复杂度不成比例；②「心跳对 version 未知态每拍探测（不限频）」——15s 一拍 × 30s 超时最坏叠加连发 spawn，且真未安装机器上永久每拍探测，噪音不可接受；③「backend/前端区分『探测失败』与『未安装』（新列 sillyspec_version_probe_failed）」——三端协议+DB 迁移，超出 thin 范围，且本变更（2 分钟自愈）已把假「未安装」的存活期压到用户基本无感，不引入该区分的收益已不成立。
