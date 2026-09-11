---
plan_level: full
---

# 实现计划（Plan）— 2026-09-11-agent-log-attribution-refactor

## Wave 1（并行，无依赖；跨仓混合：task-01 sillyspec / task-03、task-05 main）
- task-01
- task-03
- task-05

## Wave 2（依赖 Wave 1）
- task-02
- task-04

## Wave 3（依赖 Wave 2；跨仓集成冒烟）
- task-06

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | CLI 锚定器 + own 打标收敛 + 双向互斥 + 推送收敛（sillyspec 仓） | W1 | P0 | — | FR-01, FR-02, FR-04, FR-06 / D-001@v1, D-006@v2, D-007@v1, D-008@v1 | agent-session-log.js 单文件实现锚定器（zcode 读 db.sqlite + parent_id 链 + 回退链）、own 豁免 MAX_PER_HARNESS、合并循环仅 own 写 ctx（quick↔change 双向清空）、push payload=留底∩own |
| task-02 | CLI 测试 + 协议文档更新（sillyspec 仓） | W2 | P0 | task-01 | FR-07 / D-006@v2, D-007@v1, D-008@v1 | test/agent-session-log.test.mjs 用例（锚定命中/失败兜底/子代理链/双向互斥镜像/推送范围/keep-prev）；protocol.md §1/§3/会话化上下文改写 |
| task-03 | backend ctx-owner 两级 find 归属解析 + quick 优先分组 | W1 | P0 | — | FR-03 / D-002@v1, D-003@v1 | service.py 归属段重写：分组 ctx=quick_id or change_key；两级 find（links join 链 → aggregation_key 兜底）→ find-or-create（aggregation_key="{ctx}"，title="本地 · {ctx}"）；空 ctx 单桶不变；R7 重试保留 |
| task-04 | backend 归属解析测试 | W2 | P0 | task-03 | FR-02, FR-03 | hub 登记后同 ctx 跨 harness 挂接/两级 find 兜底/无主建桶/空桶不变/幂等重推/时间过滤回归/**旧双键 payload（同 entry 带 change_key+quick_id）断言落 quick 桶（AC-4 过渡期证据，审查 F-1）** |
| task-05 | backend 存量清理数据迁移 | W1 | P1 | — | FR-05 / D-004@v2 | 四条清理（归属列置 NULL + tool_report 软删 + 两张 links 全表清空），downgrade no-op，docstring 写明执行时机（CLI 升级后一次性运维） |
| task-06 | 跨仓集成冒烟（真 CLI 推送 × 真平台归属） | W3 | P0 | task-01, task-02, task-03, task-04, task-05 | FR-01~FR-06 全链 | 本机起 backend + 真 sillyspec run（zcode env）推送，断言：own-only 落库、同变更跨 harness 挂接、quick 落 quick 桶、无 ctx 单桶；迁移在开发库演练一轮 |

## 关键路径
task-01 → task-02 → task-06（CLI 实现链最长；task-03→04 支路与 task-06 汇合）

## 全局验收标准
1. sillyspec 仓测试全绿（锚定/互斥/推送范围用例，含 quick↔change 双向镜像断言）
2. backend 相关测试全绿（归属解析各分支；不跑全量，仅本模块关联用例）
3. 集成冒烟：未跑 sillyspec 的本地窗口日志不再出现在任何平台会话；平台 pi 会话 + 本地 zcode 同变更挂接成立；quick 执行落 quick 聚合会话
4. （brownfield）旧 CLI × 新 backend 过渡期行为符合 design 兼容策略节（无 4xx、错配不扩大）
5. 迁移在开发库演练通过且 downgrade no-op 验证

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-06 | AC-1/AC-3 |
| D-002@v1 | task-03, task-04, task-06 | AC-2/AC-3 |
| D-003@v1 | task-03, task-04 | AC-2 |
| D-004@v2 | task-05, task-06 | AC-5 |
| D-005@v1 | task-03（无 schema 变更约束） | AC-2 |
| D-006@v2 | task-01, task-02, task-03 | AC-1/AC-3 |
| D-007@v1 | task-01, task-06 | AC-1/AC-3 |
| D-008@v1 | task-01, task-02 | AC-1 |
| D-009@v1 | task-03（否决约束：不加 harness 拦截） | AC-3 |
| D-010@v1 | —（否决记录） | — |
| D-011@v1 | —（否决记录） | — |
