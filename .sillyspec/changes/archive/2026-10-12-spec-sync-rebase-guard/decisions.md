---
author: flow-machine-draft
created_at: 2026-10-12T00:42:11.788Z
---
# 决策记录（Decisions）— 2026-10-12-spec-sync-rebase-guard

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：- 最大风险：守卫扩大后，re-base 段内原本「tar 回退能自愈」的异常现在全部上抛人工裁决——但首推已 conflict 的前提下 tar 回退不是自愈而是静默覆盖（NFR-02 明文禁止），所谓自愈面本不存在，上抛是唯一正确语义；真实代价仅为冲突人工处理频次的口径更严。 - 放弃方案 A：仅给 `computeIncrementalOps` 单独套 try/catch（失败时跳过重试、维持首推 conflict 抛出）——粒度更细但留不住 onProgress 回调与未来新增语句的裸奔面，守卫区间再次漂移；整段包裹与「conflict 后不自动覆盖」不变量一一同构。 - 放弃方案 B：重算失败时降级为直接抛首推的 conflict（复用既有 `if (result.conflict) throw`）——与方案 A 同缺陷，且多一条隐式控制流路径；统一转 `SpecPushConflict` 单出口更可测。
