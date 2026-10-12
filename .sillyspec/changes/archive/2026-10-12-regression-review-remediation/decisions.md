---
author: flow-machine-draft
created_at: 2026-10-12T02:37:59.576Z
---
# 决策记录（Decisions）— 2026-10-12-regression-review-remediation

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：- 风险：移除机器白名单后，linked_repos 对「失陷 backend 下发任意存在路径」的防线回落到与会话路径相同的信任模型（backend 绑定 vouch + 存在性检查）——这是 ql-20260831-006 已裁决的平台信任边界，本变更是恢复一致性而非新增暴露；残余面（lease/spec-sync 路径同样信任 backend rootPath）在此一并留档为已知边界。 - 放弃方案 A：保留白名单但 forbidden 降级为结果体 skipped——同步仍然不做（功能回归未修复），只是把 5xx 变安静失败，更难排障。 - 放弃方案 B：机器主人把工作区根手工加入 allowed_roots 作为上线前提——把配置负担转嫁用户且与 ql-20260831-006「不该拦截」的裁决直接相悖。 - 放弃方案 C：num_turns/duration_ms 保持裸 typeof（危害止于单轮 NULL）——与同函数另两字段口径统一是一行事，成本两行。
