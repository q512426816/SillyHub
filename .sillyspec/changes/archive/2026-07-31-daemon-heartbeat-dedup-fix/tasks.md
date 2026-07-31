---
author: WhaleFall
created_at: 2026-07-30T15:51:14
---

# 任务清单（Tasks）

## Wave 1 — 卡死修复（优先解阻塞）
- task-01: PolicyCache.set 去 resolveRealPath，统一归一口径（runtime-policy.ts）
- task-02: isPathUnderAnyRoot 补 resolveRealPath（target + 每 root，下沉到判定）（path-utils.ts）—— B1 红线
- task-03: _syncAllowedRoots 加短路（daemon.ts）
- task-04: grep 核实所有 PolicyCache.set / isPathUnderAnyRoot 调用点口径一致

## Wave 2 — 重复修复（照搬 thinking）
- task-05: daemon partial flush assistant 带 segmentId（session-manager.ts）
- task-06: daemon _extractCompletedSegments 扩 assistant text block
- task-07: daemon _emitOverrideSignals 扩 emit [ASSISTANT_OVERRIDE]（metadata 不误打 thinking:true，B2）
- task-08: backend _extract_sdk_messages 给 assistant text block 打 segmentId + 识别 [ASSISTANT_OVERRIDE] 删 partial（service.py）
- task-09: daemon interactive 转发 dedup_key 补 seq（daemon.ts + error-classify.ts）

## Wave 3 — 测试 + 实跑验证
- task-10: isPathUnderAnyRoot 路径判定测试（子路径/junction/大小写/不存在/symlink/borrow root）+ 改前改后对照断言
- task-11: PolicyCache 口径统一 + _syncAllowedRoots 短路测试
- task-12: assistant override 删 partial 测试（daemon + backend，对齐 thinking）
- task-13: 实跑验证：daemon >2min online + 回复不重复（#35 场景）
