---
plan_level: full
author: qinyi
created_at: 2026-09-20 22:10:00
---

# 实现计划（Plan）— 2026-09-20-knowledge-effect-panel

## Wave 1（并行，无依赖）
- task-01
- task-02

## Wave 2（依赖前序 Wave）
- task-03

## Wave 3（依赖前序 Wave）
- task-04

## Wave 4（依赖前序 Wave）
- task-05

## Wave 5（依赖前序 Wave）
- task-06

## Wave 6（依赖前序 Wave）
- task-07

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | backend 数据底座：knowledge_hits migration（uq+ix+daemon_local_id）+ 模型 + HitsService（ingest_batch 五型白名单/sha256/ON CONFLICT；stats 四指标+趋势+次/任务榜+条目计数，slug 双端归一）+ 两端点（POST hits/batch 照 postSpecSync 鉴权先例带 daemon_local_id；GET stats KNOWLEDGE_READ，字面量先于通配）+ parser 条目全集 helper（## 小节/D-xxx/FR-xxx 解析+slug 生成+INDEX 排除+fr zone） | W1 | P0 | — | FR-01(服务端半), FR-02, FR-03, FR-05, FR-06, D-002@v3, D-004@v2, D-007, D-008@v3 | 测试：ingest 幂等重报/坏行/五型；stats 指标复算（slug 对齐）；路由序 |
| task-02 | daemon hits 上报：knowledge-hits-upload 模块（读 spec 目录 .runtime/knowledge-hits.jsonl、offset 家目录状态文件、完整行断点、≤2000 行分批）+ spec-sync postSpecSync 汇聚点挂 best-effort 钩子 | W1 | P0 | — | FR-01(daemon 半), D-003@v1, D-007 | daemon 面全量回归（4306 基线）；不阻塞同步主流程 |
| task-03 | backend 联调与门面：service.list 透传文件级 use_count + gen:types（HitsBatch/Stats DTO）+ openapi 提交 | W2 | P0 | task-01, task-02 | FR-06 | 类型债清零 |
| task-04 | frontend 运营仪表盘：ops-dashboard（四指标卡+死条目抽屉+使用率榜全量（%格式：<10%两位小数/≥10%一位小数））+ getKnowledgeStats 封装 + 页面挂载 + 三态（无数据/加载/错误） | W3 | P0 | task-03 | FR-02, FR-03, D-009 | 组件测试：指标渲染/抽屉/榜排序/空态 |
| task-05 | frontend 统一渲染器：entry-card-list（手册小节卡条目级徽标/决策 FR 结构化卡状态徽标取代链互跳防复潮/INDEX 导航卡/generated 单卡/原文 tab）+ fr zone（前端 ZONE_GROUPS「需求规则」组）+ 页面双 tab 分发接入 | W4 | P0 | task-03, task-04 | FR-04, FR-05, FR-06, D-004@v2, D-005 | 组件测试三形态+knowledge-page 适配 |
| task-06 | 端到端验证：本地 dev 栈或服务器——hits 上行全量落库重报幂等（grep 计数不变）/stats 指标对拍手工复算/四卡渲染/卡片流三形态/fr zone/老 daemon 零影响 | W5 | P0 | task-04, task-05 | 全 FR | 证据落 evidence/ |
| task-07 | 模块文档增量（knowledge/spec_workspace/daemon 卡）+ daemon+knowledge 面回归 + 原型对照复核 | W6 | P1 | task-06 | 全 D | 文档与实现一致 |

## 关键路径
task-01 → task-03 → task-04 → task-05 → task-06 → task-07（task-02 与 task-01 并行后汇于 task-03 联调）

## 全局验收标准
1. 单测全绿：backend knowledge 面（新增 ingest/stats/helper 用例）+ daemon 面全量（4306 基线零回归）+ frontend knowledge 组件+页面
2. 集成冒烟（task-06）：本仓真实 hits（2597 行）上行落库后**重报全量计数不变**（D-007 幂等实证）；覆盖率/死条目/密度/次任务榜四指标与手工复算一致（slug 归一化生效——手册条目命中非零）；卡片流三形态渲染+互跳+原文 tab；fr zone 出现
3. brownfield：未升级 daemon 不上报零影响（stats 空态）；既有 knowledge 端点行为零回归
4. gen:types 产物随变更提交无手写类型

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01~07 | 全局 AC-2 |
| D-002@v3 | task-01, task-02 | AC-2（五型白名单+{inject,fr-inject} 计数） |
| D-003@v1 | task-02 | AC-2（daemon 豁免通道，CLI 零改动） |
| D-004@v2 | task-05 | AC-2（三形态卡片流） |
| D-005@v1 | task-01, task-05 | AC-2（fr zone） |
| D-006@v2 | 全部 | 方案 A 整体 |
| D-007@v1 | task-01, task-02 | AC-2（重报幂等） |
| D-008@v3 | task-01, task-04 | AC-2（次/任务榜+%格式） |
| D-009@v1 | task-04 | AC-2（四指标卡） |
