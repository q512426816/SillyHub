---
plan_level: full
author: qinyi
created_at: 2026-08-23 21:15:00
---

# 实现计划（Plan）— 本地 Agent 会话日志对话化回显（zcode MVP）

## Spike 前置验证

无需 Spike：解析算法与消息形状已在 brainstorm 阶段经两份真实日志文件逐行实证
（含 Grill 独立复证），RPC 注册模式与前端组件导出均经源码锚定，无未验证技术集成。

## Wave 1（并行，无依赖）
- task-01
- task-03

## Wave 2（依赖 Wave 1：task-02←task-01 解析器；task-04←task-03 openapi）
- task-02
- task-04

## Wave 3（依赖 task-04 类型）
- task-05

## Wave 4（依赖全部）
- task-06

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | daemon zcode 解析器（纯函数+fixture 单测） | W1 | P0 | — | FR-01, FR-02, D-001@v1, D-002@v1, D-006@v1 | 统一 offset 对齐合并/段产出/剥离/末行补尾去重/20MB 预算/200 段窗口/before_seq 切片；ESM .js 后缀（CONVENTIONS 13） |
| task-02 | 解析器注册表 + read_agent_log_messages RPC | W2 | P0 | task-01 | FR-02, FR-04, D-001@v1, D-006@v1 | 白名单复用；not_found/forbidden 走既有 throw；status 分层返回；未注册 format→unsupported；RPC 注册点 daemon.ts（TaskCard 核实） |
| task-03 | backend GET /agent-logs/{id}/messages 端点 | W1 | P0 | —（契约来自 design §7，单测 mock RPC 不依赖 task-02 实现） | FR-03, FR-04, D-003@v1, D-006@v1 | 抽 content 端点共享 helper；二进制 409/method-not-found 422/status 200 分层；platform_sync 在 l10n 排除清单 |
| task-04 | pnpm gen:types + 前端 API 封装 | W2 | P0 | task-03 | FR-02, D-001@v1 | openapi.json + api-types.ts 同步提交（规则 21/CONVENTIONS 6）；readAgentLogMessages(entryId, beforeSeq?) |
| task-05 | agent-log-card「查看内容」对话化渲染+回落 | W3 | P0 | task-04 | FR-01, FR-03, FR-05, D-003@v1, D-005@v1, D-006@v1 | 直构段列表复用 tool-renderers（tool_use_id 配对/失配「结果未记录」）；对话/原文切换/加载更早；全场景静默回落 |
| task-06 | 三仓回归 + 真实端到端实证 | W4 | P0 | task-01~05 | 全部 FR | uv run pytest / pnpm vitest / daemon pnpm test+typecheck；真实 zcode 会话验证对话渲染、回落、无 system 泄漏；runtime-evidence 留档 |

## 关键路径

task-03 → task-04 → task-05 → task-06（backend 端点 → 类型 → 渲染 → 实证，四波；
task-01 → task-02 支线在 Wave 2 汇合；Wave 布局按 plan-postcheck 拓扑排序建议自
5 波压缩为 4 波）

## 全局验收标准

1. 三仓测试全绿：backend `uv run pytest`（platform_sync 模块新增测试文件通过，
   既有 content 端点测试零回归）；daemon `pnpm test` + `pnpm typecheck`；frontend
   `pnpm vitest run`（agent-log-card 改写用例通过）
2. 集成冒烟（task-06）：部署环境真实 zcode 日志条目「查看内容」→ 对话流渲染
   （工具卡片可展开、思考折叠、加载更早）；codex 条目 → 回落原文；dsh/cursor →
   409 文案不变；老 daemon 模拟 → 422 回落；全链路无 system 提示词/system-reminder
   泄漏（抽查 DOM）
3. brownfield 兼容：不点新按钮时所有现有行为零变化；旧 content 端点保留可用
4. `git diff --exit-code` gen:types 产物与后端 schema 一致（gen:types:check 通过）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02, task-03, task-04 | 解析在 daemon、backend 零解析透传、前端零格式知识（AC-1/AC-2） |
| D-002@v1 | task-01, task-02 | registry 仅注册 zcode-model-io-jsonl；未注册→unsupported（AC-2 回落分支） |
| D-003@v1 | task-03, task-05 | status≠parsed/HTTP 非 200 一律静默回落原文（AC-2/AC-3） |
| D-004@v1 | task-01, task-03 | 方案 A 四段式落地（AC-1/AC-2） |
| D-005@v1 | task-05, task-06 | 对话化交互对照 prototype（AC-2） |
| D-006@v1 | task-01, task-02, task-03, task-05 | 三裁决：offset 统一对齐/直构渲染/错误双通道（AC-1/AC-2） |
| FR-01 | task-01, task-05 | 对话流渲染 + 无泄漏（AC-2/AC-3） |
| FR-02 | task-01, task-02, task-04 | KB 级归一化消息（AC-1） |
| FR-03 | task-03, task-05 | 全场景回落（AC-2/AC-3） |
| FR-04 | task-02, task-03 | 二进制 409 维持（AC-2） |
| FR-05 | task-01, task-05 | 200 段窗口 + 加载更早（AC-2） |
