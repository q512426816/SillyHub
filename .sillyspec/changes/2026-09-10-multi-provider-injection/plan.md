---
author: qinyi
created_at: 2026-09-10 23:10:00
plan_level: full
---

# 实现计划（Plan）— 多供应商注入

> Step 1 分类锚点：full——7 task / 跨 daemon+backend+frontend / 无表结构变更但跨进程注入链 + 真实 CLI 冒烟。
> D-008 时序已满足：review-dispatch-platform-fixes 实现已落 main（4726893a5，PiCredentialInjector + schema pi 实证）。
> decisions 当前版本：D-001~D-012 全 accepted（无 superseded/unresolved）。

## Spike 前置验证

已前置完成（brainstorm 阶段，spike/spike-report.md 为唯一事实源）：三 CLI 注入面实测定案（D-002/D-003/D-004）；无剩余技术不确定性——W5 冒烟是验收性复验非探索。

## Wave 1（codex 写盘器）

- task-01

## Wave 2（pi 写盘器，共享测试目录与 task-01 串行）

- task-02

## Wave 3（接线分派，独占 daemon.ts/task-runner.ts）

- task-03

## Wave 4（热切换，共享 daemon.ts 与 W3 串行）

- task-04

## Wave 5（backend 词表与禁配）

- task-05

## Wave 6（前端表单 + gen:types）

- task-06

## Wave 7（冒烟收尾）

- task-07

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | codex-settings.ts 写盘器 + 单测 | W1 | P0 | — | FR-01, D-003/D-005/D-011/D-012 | per-form 映射两形态/保守合并/wire_api=responses/失败跳过含 env（Plan 约束 3）；golden=spike a2b |
| task-02 | pi-settings.ts 写盘器 + 单测 | W2 | P0 | task-01 | FR-02, D-004/D-008/D-011 | 三文件官方形状/api="openai-completions"/preserve unknown/base_url 门控；Promise<void>（Plan 约束 1）；失败策略同 task-01（记 error 跳过含 PI env 注入，design 约束 3 双覆盖）；golden=spike b1 |
| task-03 | 两接线点分派 + applyClaudeSettings 守卫 | W3 | P0 | task-01, task-02 | FR-01, FR-02 | daemon.ts:7920 一带 + task-runner.ts:526-533；kind 守卫（design 接口段） |
| task-04 | 热切换按会话重写 + per-session 目录生命周期 | W4 | P0 | task-03 | FR-03, D-009/D-011 | PROVIDER_CONFIG_CHANGED 处理器扩展 + 目录创建/清理接入既有会话清理 |
| task-05 | schema codex 词表 + pi×openai_chat 禁配 | W5 | P0 | — | FR-04, D-012 | 仅 Create 一处 + Update 侧 service 层（Plan 约束 2，文件清单补 service.py）；**连带翻转 test_llm_provider_pi_kind.py:54-56 既有用例**（现断言 codex 抛 ValidationError，加词表后翻转为接受） |
| task-06 | 前端表单 + gen:types 联动 | W6 | P1 | task-05 | FR-05 | codex 选项/pi 端点字段/openai_chat 禁选（Plan 约束 4） |
| task-07 | 真实 CLI 冒烟 + 模块文档 | W7 | P0 | task-03, task-04, task-05, task-06 | FR-06, R-02 | mock 端点三条（codex/pi/litellm 通道）+ api-types 零漂移 + 文档 |

## 关键路径

task-01 → task-02 → task-03 → task-04 → task-07（写盘器→接线→热切换→冒烟主链，全串行防 daemon.ts/task-runner.ts 并行覆盖）；task-05/06 支链（W5/W6），gen:types 收口在 task-06。

## 全局验收标准

1. daemon：pnpm vitest run tests/codex-settings.test.ts tests/pi-settings.test.ts + 既有 credential-injector/spawn-env 回归全绿
2. backend：uv run pytest app/modules/llm_provider -q（codex 词表 + 禁配 422 用例）
3. frontend：pnpm vitest run llm-providers 相关 + pnpm exec tsc --noEmit
4. 门禁：daemon pnpm typecheck + gen:types:check 零漂移；backend ruff+mypy 定向
5. golden：写盘产物与 spike 证据（a2b-config.toml/b1-models.json）逐字段一致
6. 兼容三态：provider_config absent / per-form 必需字段缺失 / 写盘失败——各态行为有测试锁定
7. 冒烟：mock 端点三条端到端（codex /v1/responses 命中含 Bearer；pi /v1/chat/completions 命中；litellm 通道一条）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001 范围 | 全部 | 全 AC |
| D-002 spike 前置 | 全部 | golden 依据 |
| D-003 codex 三路 | task-01 | AC-5 |
| D-004 pi 注入面 | task-02 | AC-5 |
| D-005 载体=文件 | task-01, task-02 | AC-5 |
| D-006 litellm Responses | task-07 | AC-7 |
| D-007 cursor 排除 | 范围 | — |
| D-008 并行分层 | task-02, task-05 | AC-1/2（pi 词表衔接 4726893a5） |
| D-009 热切换尽力 | task-04 | AC-4 |
| D-010 设计确认 | 全部 | — |
| D-011 per-session | task-03, task-04 | AC-4/6 |
| D-012 门槛 per-form | task-01, task-05 | AC-6 |
