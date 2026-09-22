---
plan_level: full
---

# 实现计划（Plan）— cursor 交互式会话接入

## Spike 前置验证（如需要）

| Spike | 验证内容 | 不通过后果 |
|---|---|---|
| spike-01（=task-01） | cursor stream-json 真实帧结构：system 帧是否带 session_id、result 帧形状/usage 字段名、`--resume <chatId>` 记忆连续性、create-chat 兜底可用性 | 归一化器映射表按实测修正；chatId 来源链重设计（R-01/R-02 解除或升级） |
| spike-02（=task-02） | 不带 `--force --trust` 的 headless 工具行为（被拒/卡死/有审批） | 按 D-003@v1 判定规则落参数并记 D-003@v2；若卡死则强制 --force --trust（与批量一致） |

> 两项 Spike 均依赖环境前置：用户先重新 `cursor-agent login`（本机凭证已过期，三 shell 环境一致复现）。

## Wave 0（前置实测一：帧样本，人工配合）
- task-01

## Wave 1（前置实测二：非 force 探针；与 task-01 分 Wave——两者 allowed_paths 共享 fixtures 目录，同 Wave 并行会互覆，postcheck 硬拦）
- task-02

## Wave 2（daemon 归一化器，依赖 Wave 0）
- task-03

## Wave 3（daemon driver，依赖 Wave 1/2）
- task-04

## Wave 4（daemon 注册点，两项并行无共享文件，依赖 Wave 3）
- task-05
- task-06

## Wave 5（backend + frontend 镜像，两项并行无共享文件，依赖 Wave 4）
- task-07
- task-08

## Wave 6（静态检查与测试，依赖 Wave 5）
- task-09

## Wave 7（真机冒烟，依赖 Wave 6）
- task-10

## Wave 8（文档同步，依赖 Wave 7）
- task-11

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 前置实测——帧样本抓取与 resume 连续性验证 | W0 | P0 | — | FR-05 | 两轮真实对话抓帧落 fixture；验证 A/B/C 三项；结论回填 design 假设 |
| task-02 | 前置实测——非 force 权限行为探针 | W1 | P0 | — | FR-05, D-003@v1 | headless 无 force 探针；判定规则落参数；记 D-003@v2 |
| task-03 | cursor-events.ts 归一化器 + golden 测试 | W2 | P0 | task-01 | FR-03 | 无状态映射表 + fixture 驱动逐字段断言 |
| task-04 | cursor-driver.ts 实现 + 单测 | W3 | P0 | task-02, task-03 | FR-02 | 每轮 respawn + --resume chatId + Windows shim + interrupt 规范通道 |
| task-05 | providers.ts 注册 + registry 测试同步 | W4 | P0 | task-04 | FR-01 | PROVIDER_CAPS.cursor + INTERACTIVE_PROVIDERS.cursor + 键集合断言 |
| task-06 | daemon 注册点收尾（cli 装配 + 持久化白名单） | W4 | P0 | task-04 | FR-04 | cli.ts drivers 装配行 + session-store-persistence VALID_PROVIDERS |
| task-07 | backend 镜像（caps + 守护测试 + DTO Literal） | W5 | P0 | task-05 | FR-01, FR-04, D-004@v1 | provider_caps.py + EXPECTED_PROVIDERS + InteractiveProviderLiteral |
| task-08 | frontend 镜像与白名单 | W5 | P0 | task-05 | FR-01, FR-04 | provider-caps.ts + 两处引擎白名单 |
| task-09 | 静态检查与相关测试 | W6 | P0 | task-05, task-06, task-07, task-08 | FR-06 | typecheck×2 + 相关测试全绿 |
| task-10 | 真机冒烟 | W7 | P0 | task-09 | FR-06 | 手册 §8 清单适配（双轨落库/SSE/usage/resume/interrupt/caps 门控/claude 零回归） |
| task-11 | 文档同步 | W8 | P1 | task-10 | FR-06 | onboarding 手册 §5.4 案例锚 + 实测记录归档 |

## 关键路径

task-01 → task-03 → task-04 → task-05 → task-07 → task-09 → task-10 → task-11（最长串行链；task-02 并入 task-04 前置，Wave 0 两项并行不延长路径）

## 全局验收标准

1. `pnpm -C sillyhub-daemon typecheck` 与 `pnpm -C frontend typecheck` 零错误。
2. 相关测试全绿：`tests/interactive/provider-registry.test.ts`（键集合 `['claude','codex','cursor','pi']`）、新增 `cursor-events.test.ts` / `cursor-driver.test.ts`、backend `test_provider_caps_alignment.py`（EXPECTED_PROVIDERS 已同步）、前端 agent-log normalize 不回归。
3. 真机冒烟通过：Cursor 引擎建会话 → 一轮真实对话双轨落库（`[ASSISTANT]`/`[TOOL_USE]` 文本行 + `metadata_['agent_event']`）+ SSE agent_event 结构化渲染 + usage 实时；第二轮 resume 记忆连续；interrupt 后 AgentRun=failed + error_code='interactive_interrupted'；caps false 项（附件/审批/团队派工）UI 正确隐藏；model_select 开放且 --model 生效；claude 会话零回归。
4. brownfield：未安装 cursor 的环境行为不变（探测 unavailable → 前端不展示）；既有三 provider 零回归。
5. 验收结论由 verify 阶段写入 verify-result.md；task 级验收对照 TaskCard frontmatter acceptance。

## 覆盖矩阵（decisions.md 当前版本）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-03, task-04, task-05 | 归一化器/driver/注册实现形态 = 每轮 respawn + --resume chatId |
| D-002@v1 | task-01~task-11 范围边界 | 无批量层/liveness/凭证配置改动（git diff 验证） |
| D-003@v1 | task-02, task-04 | 实测记录 + D-003@v2 回填 + driver 启动参数定版 |
| D-004@v1 | task-07 | EXPECTED_PROVIDERS 同步 + 守护测试四用例全绿 |
