---
plan_level: full
---

# 实现计划（Plan）— 2026-09-19-tool-report-session-replay

## Spike 前置验证（如需要）

| Spike | 验证内容 | 不通过后果 |
|---|---|---|
| spike-01（并入 task-03） | 只读开真实 `~/.zcode/cli/db/db.sqlite`，核对 message/part data JSON 是否含 usage/turnId 字段 | zcode sqlite 主路径 usage 置 undefined（token 显示「未知」），rollout 文件路径不受影响；不推翻设计（字段可选），结论记 verify-facts |
| spike-02（并入 task-05） | 枚举真实 cursor-agent transcript 的 content 块类型全集（实证样本仅见 text/tool_use），确认 tool_result 落盘形态 | 无 tool_result 落盘则工具调用按「结果未记录」中性徽章渲染（既有先例），不伪造；不推翻设计 |

> 两项 Spike 均为 fixture 事实核对（R-01/R-02），非技术选型验证；设计已含降级路径，Spike 结果只决定走主路径还是降级路径。

## Wave 1（并行，无依赖）
- task-01
- task-10
- task-13

## Wave 2（依赖 Wave 1 的 task-01 契约）
- task-02
- task-03
- task-04
- task-05

## Wave 3（task-06 依赖 Wave 2；task-08 依赖 task-01 契约；两者互不依赖并行）
- task-06
- task-08

## Wave 4（task-07 依赖 Wave 2+3 全部 daemon 实现；task-09 依赖 task-08 类型；两者互不依赖并行）
- task-07
- task-09

## Wave 5（依赖 task-09 适配器 + task-10 时间线扩展）
- task-11

## Wave 6（依赖 task-11）
- task-12

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | daemon 契约扩展（NormalizedLogMessage + totalUsage） | W1 | P0 | — | FR-02, FR-03, D-003, D-004 | 可选字段五项 + sender 枚举；三解析器共用契约 |
| task-10 | turn-timeline 最小扩展（system_event 中性行） | W1 | P0 | — | FR-01, FR-02, D-003 | SessionProcessItem 增 system_event kind；仅回放路径产生 |
| task-13 | cursor IDE 409 提示改善 + 跨仓跟进文档 | W1 | P1 | — | FR-02, FR-04, D-006, D-007 | 前端文案 + docs/sillyspec 记录 sillyspec 仓待办 |
| task-02 | zcode 文件解析器补字段 | W2 | P0 | task-01 | FR-02, FR-03, D-003, D-004, D-005 | 顶层 turnId/model/durationMs + response.usage 附着 + system_event 归一 + totalUsage；连带更新 sillyhub-daemon/tests/agent-log/ 既有形状断言 |
| task-03 | zcode sqlite 读取器补字段（含 spike-01） | W2 | P0 | task-01 | FR-03, D-004, R-01 | fixture 核对 db.sqlite JSON；缺则 undefined + verify-facts |
| task-04 | claude-code 解析器新增 | W2 | P0 | task-01 | FR-02, FR-03, D-003, D-006 | 行过滤/isMeta+注入前缀/tool_result 载体/usage 透传 |
| task-05 | cursor-agent 解析器新增（含 spike-02） | W2 | P0 | task-01 | FR-02, D-005, D-006, R-02 | turn_ended 切轮；tool_result 形态 fixture 核对 |
| task-06 | registry 注册 + host-fs-handler 透传 | W3 | P0 | task-02,04,05 | FR-02 | 两 format 串注册；RPC 原样透传新字段 |
| task-07 | daemon 解析器矩阵单测 | W4 | P0 | task-02,03,04,05,06 | FR-02, FR-03 | 真实日志脱敏 fixture 三 harness + 字段断言 |
| task-08 | 平台 schema + 端点透传 + gen:types | W3 | P0 | task-01 | FR-03, D-004 | 可选字段 + total_usage；openapi.json/api-types.ts 重生成 |
| task-09 | 前端适配器 buildReplayTurns + 单测 | W4 | P0 | task-08 | FR-01, FR-03, D-001, D-004, D-005 | 纯函数：切轮/系统事件/processItems/usage 聚合/未知兜底 |
| task-11 | AgentReplayBody 组件 + 测试 | W5 | P0 | task-09,10 | FR-01, FR-02, FR-04, D-001, D-002 | 主/子分类、加载更早、11 props、折叠条、三态、total_usage |
| task-12 | 挂载切换 + AgentLogSessionBody 退役 | W6 | P0 | task-11 | FR-01, D-001 | session-panel-page :3520 换挂；连带清理 agent-log-card.test.tsx 中 AgentLogSessionBody 专属 describe 块；activated 路径零改动 |

## 关键路径
task-01 → task-02 → task-06 → task-08 → task-09 → task-11 → task-12（契约→解析器→注册透传→schema/types→适配器→组件→挂载）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）

- 新字段全部可选——老 daemon 不返回即缺省，前端显示「未知」/缺省行为；`422 HTTP_422_AGENT_LOG_UNSUPPORTED` 与 `unsupported`/`parse_error`/`too_large` 回落语义逐字保留（不弹错框、原文回落）。
- token 缺失显示「未知」，不显示 0、不伪造；累计必须由 daemon 返回（窗口化下前端求和必算少）；ctx 口径 = 该轮最后一次调用 inputTokens（zcode inputTokens 已含 cacheRead）。
- 仅真人输入渲染用户气泡；系统事件中性行不复用用户气泡样式，不复用「执行中」假运行语义；不伪造 CLI 命令文本。
- 不动已激活路径：turn_count>0 的 tool_report 会话与 chat 会话零改动；上报/归属链路零改动；平台库零表结构变更（messages「读即弃不落库」维持）。
- 回退路径：AgentReplayBody 挂载分支单独一行（session-panel-page.tsx:3520），revert 单提交粒度。
- UI 和文档默认中文；前端样式双主题铁律（brand-* 语义阶、不硬编码 hex，见 CLAUDE.md 规则 20/21）。
- 前端接口类型必须从后端 OpenAPI 生成（pnpm gen:types），禁止手写；gen:types 前确认前端 node_modules 健康（CLAUDE.md 规则 21）。
- 禁止跑全量测试，仅跑本次修改相关的测试（CLAUDE.md 规则 0）。
- 子代理回写输入残留（execution「无关内容混入」防线）：解析器 fixture 禁带真实用户路径/业务内容，统一脱敏占位。

## 全局验收标准

1. 所有新增单测通过（daemon vitest / frontend vitest / backend pytest 相关文件），相关既有测试不回归（不跑全量）。
2. 集成冒烟（人工/脚本）：本地起 daemon + backend + frontend，打开实证样本会话（137ddfff 同构数据）——主体为会话时间线、系统事件中性行、每轮 token、工作会话折叠条、触顶加载更早可用。
3. brownfield：老 daemon 模拟（缺字段/422）回放显示「未知」与既有回落，不报错；activated 会话与 chat 会话渲染零变化。
4. `pnpm gen:types` 产物提交（openapi.json + api-types.ts 同步，无手写类型）。

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-09, task-11, task-12 | AC-2（TurnTimeline 真组件主体） |
| D-002@v1 | task-11 | AC-2（主/子分类 + 折叠条） |
| D-003@v1 | task-01, task-02, task-04, task-05, task-10 | AC-2/AC-1（system_event 归一与中性行） |
| D-004@v1 | task-01, task-02, task-03, task-08, task-09 | AC-2/AC-4（token 四层 + totalUsage） |
| D-005@v1 | task-02, task-05, task-09 | AC-2（turnId/turn_ended/user 切轮） |
| D-006@v1 | task-04, task-05, task-06, task-13 | AC-1（解析器矩阵 + 409 文案 + 跨仓记录） |
| D-007@v1 | task-13, task-11 | AC-2/AC-3（三态提示；L3 未越界） |
| D-008@v1 | 全部 task（方案 A 路线） | AC-2 |
