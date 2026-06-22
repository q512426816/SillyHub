---
author: qinyi
created_at: 2026-06-22T15:35:00
change: 2026-06-22-agent-run-pipeline-fix
---

# Tasks: agent-run 调度链路修复

> 仅列任务名 + 归属 + 依赖。实现细节在 plan 阶段展开为 Wave/Task。

## P0 — 打通 scan 主链路
- **T01** [A1][SillyHub] docker-compose spec-data 改 bind mount + `.env.example` 加 `SPEC_DATA_HOST_DIR`
- **T02** [A1][SillyHub] daemon 激活 `SPEC_ROOT_MAP`（config.ts / 启动配置注入翻译映射）
- **T03** [A1][SillyHub] backend `_build_claim_payload` interactive 分支补 specRoot/runtimeRoot 透传
- **T04** [B1][sillyspec] `workflow.js` checkOutput/_checkWorkflow 走 specBase
- **T05** [B1][sillyspec] `scan-docs.yaml` outputs.path 占位符 + `run.js` 渲染替换 + 项目名统一用 change.project
- **T06** [B4][sillyspec] `run.js` scan post-check 失败分支补 return + completed 标记推迟 + 平台模式 exit(1)
- **T07** [B4][sillyspec] `stage-contract.js` transition 加 failed_post_check 门控 + workflow post_check anyFailed 阻断
- **T08** [C1][SillyHub] `context_builder.build_scan_bundle` 平台模式跳过 init 步骤

## P1 — 体验与正确性
- **T09** [B2][sillyspec] `sanitizeProjectName` 字母校验 + 正则收紧（只解析列表段 / token 以字母开头）
- **T10** [B3][sillyspec] `index.js` 顶层命令别名（doctor/scan/status/quick/explore 转发 runCommand）
- **T11** [D1/D2][SillyHub] daemon `session-manager` partial/完整去重（thinking segment id）
- **T12** [D1/D2][SillyHub] backend `_extract_sdk_messages` 完整 message 与 partial 去重
- **T13** [D3][SillyHub] 源头 tool_call JSON 补 `tool_use_id`（task-runner.ts + service.py）
- **T14** [D3][前端] `normalize.ts` tool_use 全局配对 + thinking 跨断点去重
- **T15** [前端] `agent-log-viewer.tsx` turn 分组渲染 + thinking 折叠 + `tool-renderers.tsx` 卡片状态徽标
- **T16** [token][前端] `agent-run-panel`/`agent-log-viewer` 展示 input/output tokens（读 AgentRun，确认 `agent.ts` API 返回字段）

## 联调验证
- **T17** sillyspec `npm link` 全局生效 + 对 `myaaa` 重跑完整 scan 端到端验证（对照 requirements.md 验收）

## 依赖关系（plan 阶段细化）
- T04→T05（同 B1，路径基础在前）
- T01→T02→T03（A1 三层，bind mount 先于翻译先于 payload）
- T11→T12→T14（日志去重：daemon→backend→前端）
- T13→T14（tool_use_id 源头先于前端配对）
- T01~T08（P0）→ T17 联调；T09~T16（P1）可与 P0 后段并行

## 决策引用
- **D-001@v1**（A1=bind mount+daemon翻译）→ T01, T02, T03
- **D-002@v1**（前端=修bug+优化展示）→ T11, T12, T13, T14, T15, T16
- **D-003@v1**（数据迁移可清空）→ T01
- **D-004@v1**（sillyspec 跨仓库管理）→ T04, T05, T06, T07, T09, T10
- **D-005@v1**（执行策略 P0/P1）→ 全部任务分层（T01~T08 / T09~T16）
- **D-006@v1**（token 消耗展示）→ T16
