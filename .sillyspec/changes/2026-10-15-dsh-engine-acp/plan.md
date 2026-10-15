---
plan_level: light
execution_mode: main  # dispatch=子代理派发（判据见「执行模式声明」；缺省 main 直写——R7/R8 对撞实证）。本变更任务顺序依赖为主、单会话可吞吐，按实质回判 main（design frontmatter 规模注记一致）
---

# 轻量计划（Light Plan）：dsh 引擎接入（阶段 1 单聊）

> plan_level=light 理由（客观规模信号说明）：15 文件中 4 个为生成物镜像（caps×2 + api-types×2）、5 个为新建测试/冒烟，源码实质修改面 6 文件；8 任务为单链顺序依赖（01→02→03→04→{05,06}→07→08），无真并行 Wave 需求、单会话上下文可吞吐（execution_mode=main）——按 plan step2 判据（跨端/多文件/顺序依赖不构成 full）维持 light；独立评审已按 S2 档执行（brainstorm Grill 两轮 + plan review 一轮，均 pass）。

## 来源
brainstorm 四件套（proposal/design/requirements/tasks，2026-10-15）：dsh 作为第 4 个交互引擎，走官方 `--profile acp`（ACP v1 stdio JSON-RPC）接入，自研驱动复用 adapters/json-rpc.ts 基建；模型路由 per-session DSH_HOME patch + apiKeyEnv；顺手统一群附件门控 caps 口径。设计经 S2 独立 Grill 两轮（阻断项已修复，pass/pass）。

## 范围
- sillyhub-daemon：NEW dsh-acp-driver.ts / dsh-acp-events.ts / dsh-settings.ts + 对应测试；修改 providers.ts（caps+注册）、agent-detector.ts（第 13 项）、version.ts（MIN_VERSIONS [0,2,1]）；gen-provider-caps.mjs 镜像刷新
- backend：schema.py InteractiveProviderLiteral 加 "dsh"；group/service/messages.py 附件门控 caps 口径；NEW test_group_attachment_gate.py；gen:types（frontend + daemon 双义务）
- frontend：session-list-panel.tsx SESSION_ENGINE_OPTIONS 加 dsh + provider-caps.ts 镜像
- 详见 design.md 文件变更清单（14 条）

## 验收
- FR-01~FR-08 全过（requirements.md GWT 条目）：探测/版本门警告、单聊全链路（创建→流式落库→渲染）、打断、审批代答三态、模型路由接管与回落、caps 三端镜像、群附件门控新口径逐引擎断言、前端单聊选项
- 聚焦测试全绿：daemon（驱动/归一化/注册快照/探测）、backend（Literal/门控）、frontend（快照）；现有引擎零回归（provider-registry 守护测试不动）
- 端到端冒烟（本机装 dsh ≥0.2.1 实测；CI 无 dsh 走 skip 留痕）
- CLAUDE.md 规则 21：api-types.ts + openapi.json 与 schema 同变更提交

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01 | FR-01：探测项注册 + SILLYHUB_DSH_PATH 覆盖优先级测试 |
| D-002@v1 | task-01, task-03 | FR-01 版本门警告不硬拒；FR-02 握手失败结构化错误测试 |
| D-003@v1 | task-02, task-03 | FR-02 / FR-03 / FR-04：自研驱动事件映射/代答桥单测 |
| D-004@v1 | （rejected 登记） | 零新 npm 依赖——daemon package.json 依赖面不变（package.json diff 为证） |
| D-005@v1 | （rejected 登记） | 批处理层不动——src/adapters/index.ts 无 diff |

FR 覆盖对照：FR-01（task-01 探测与版本门）、FR-02（task-03 驱动全链路 + task-05 枚举）、FR-03（task-03 interrupt）、FR-04（task-03 代答桥）、FR-05（task-04 模型路由 patch 写入）、FR-06（task-04 caps 三端镜像）、FR-07（task-06 群附件门控两处统一）、FR-08（task-07 前端选项）、端到端收口（task-08 冒烟）。
