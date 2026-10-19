---
author: flow-machine-draft
created_at: 2026-10-16T12:55:44.420Z
---
# 决策记录（Decisions）— 2026-10-16-daemon-pull-antiresurrect

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- 最大风险：**误抑制**（用户删除后又在秒级窗口手工恢复同名文件，pull_start 现算的抑制集会把 bundle 版本挡掉）——与 CLI 同构接受（窗口极窄，且有 restoreDeleted/env 显式恢复通道兜底）。 - 次风险：manifest 长期失真（如历史版本缓存含已不在同步面的路径）导致抑制面偏大——已用 `isUploadExcludedPath` 同口径过滤 + 「删除上行成功自然衰减」收敛；且只影响 pull 恢复面，不损伤任何现存文件。 - 首版缺口（独立评审 P2 实证，已修复）：首版只读 manifest、落地重建不并回被抑制行——delete op 生成条件「缓存有/盘面无」随重建断裂，抑制只活一个 pull 周期，第二次自动 pull 复活照旧。修复：落地重建时并回被抑制行（FR-04 持久性语义），新增第二次 pull 持久性测试断言。 - 试过但放弃：①改 `extractTar` 加 skip 参数（侵入面大、in-place 兜底仍需补刀）→ 放弃，改为解包后对命中路径 rm（两路径统一、签名不动）；②在 `hasUnsyncedLocalChanges` 加删除检测（pending/mtime 信号反推）→ 放弃，删除检测本质需要基线快照，重复造 manifest 已有的能力且动既有判定函数风险更高；③照搬 CLI 在 rm 前读基线文件的形态 → 放弃，daemon 的 manifest 缓存已是等价基线且生命周期管理（pull/push 双点回写）更完备。
