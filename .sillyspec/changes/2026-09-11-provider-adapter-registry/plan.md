---
plan_level: full
---

# 实现计划（Plan）

## Spike 前置验证
无需 Spike——全部技术事实经 Grill 实证（ProviderDescriptor 现五要素/注入器无状态可懒构/createDriver 全惰性零副作用/词表可 grep/前端消费点 import 形态）；生成脚本零依赖解析有对齐测试先例。

## Wave 1（契约基座）
- task-01

## Wave 2（依赖 Wave 1；三 task 文件集不相交可并行）
- task-02
- task-03
- task-04

## Wave 3（依赖 Wave 2）
- task-05

## Wave 4（依赖 Wave 1/2/4 产物）
- task-06

## Wave 5（全链回归）
- task-07

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | ProviderAdapter 聚合契约（四新字段+writer 接口+satisfies+caps 第 10 键） | W1 | P0 | — | FR-01, D-003@v2 | providers.ts 原地扩展；writer 接口五要素同文件定义 |
| task-02 | 派生改造（REGISTRY 惰性派生+写盘分派 writer 化） | W2 | P0 | task-01 | FR-02 | 导出面与失败语义不变，矩阵测试锁零漂移 |
| task-03 | 硬编码收口六处 | W2 | P0 | task-01 | FR-03 | daemon×3 + persistence×2 + session-manager×1 |
| task-04 | caps 生成脚本+三端产物+对齐测试 9→10 | W2 | P0 | task-01 | FR-04 | 零依赖解析+响亮失败+幂等 |
| task-05 | 前端白名单派生（产物化） | W3 | P0 | task-04 | FR-04 | 消费点 import 不变 |
| task-06 | 冒烟制度化+守护测试 | W4 | P0 | task-01, task-02, task-04 | FR-05 | 全词表表驱动+smokeSuite 校验+幂等重跑断言 |
| task-07 | 全量回归+防遗漏演示验证 | W5 | P0 | task-01..06 | 全 FR | 含「抽走声明→tsc 红」验证记录 |

## 关键路径
task-01 → task-02/04 → task-05/06 → task-07

## 全局验收标准
1. daemon 修改相关套件全绿（typecheck + provider-adapter-registry 新守护 + 既有 pi/codex-settings、file-dispatch、reload 矩阵、smoke integ、session-recovery、cli-injection、config-changed-handler 等）；不跑全量（CLAUDE.md 规则 0）
2. frontend：gen:types 全流程回归 + tsc 0 错 + config-bar/caps 两套件全绿
3. backend：provider_caps 对齐测试（10 键）通过（uv run pytest 该文件）
4. 行为零漂移：既有测试唯一改动=键集合 9→10 联动两处（backend 对齐测试 + daemon provider-registry.test.ts nineKeys）
5. 六处硬编码字面量 grep 归零验证
6. 防遗漏演示：临时注释聚合表一份声明 → tsc 编译红（验证后还原，记录输出）

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01/03/06/07 | satisfies 编译红演示 + 六处 grep 归零 + 守护测试 |
| D-002@v1 | task-04/05 | 幂等重跑断言 + 三端对齐测试 |
| D-003@v2 | task-01/02 | providers.ts 聚合表 + 派生导出面不变 |
| FR-01 | task-01, task-07 | satisfies + 抽走声明演示 |
| FR-02 | task-02, task-07 | 矩阵测试零漂移全绿 |
| FR-03 | task-03, task-07 | 六处元数据化 + 既有测试 |
| FR-04 | task-04/05, task-07 | 生成产物 + 白名单派生 + 对齐 10 键 |
| FR-05 | task-06 | 全词表表驱动 + smokeSuite 守护 |
