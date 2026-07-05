---
author: qinyi
created_at: 2026-06-22T15:35:00
change: 2026-06-22-agent-run-pipeline-fix
---

# Requirements: agent-run 调度链路修复

## 功能需求

### P0 — 打通 scan 主链路
- **FR-01 [A1]** Windows daemon 跑 scan 时，agent 拿到的 spec-root 是 Windows 可访问路径（`C:/data/spec-workspaces/<id>`），无 EPERM；backend / daemon / agent 三方见同一物理目录（bind mount 共享）。
- **FR-02 [B1]** scan post-check 检查 spec-root 下真实文档路径（`{specRoot}/docs/<project>/scan/`），项目名与 change 一致，不再报"目录不存在 .sillyspec/docs/frontend/scan/"。
- **FR-03 [B4]** post-check 失败时 `--done` 被拒、CLI exit 非0、stage 状态为 `failed_post_check`、transition 门控拦截下游阶段直到修复。
- **FR-04 [C1]** scan 全程不出现"拒绝删除源码目录的 .sillyspec：检测到真实资产"。

### P1 — 体验与正确性
- **FR-05 [B2]** scan-projects.json 仅含合法项目名（含字母、长度≥2），无纯数字 "0"/"7"；不误建 `projects/0.yaml`。
- **FR-06 [B3]** `sillyspec doctor` / `sillyspec scan` 等顶层命令直接可用（不再"未知命令"）。
- **FR-07 [D1]** [THINKING] 不再逐 token 碎片化（相邻合并为单条展示）。
- **FR-08 [D2]** 同一思考内容只出现一次（无增量段 + 完整段重复）。
- **FR-09 [D3]** 同一 tool 调用只展示一张卡片（含 stdout [TOOL_USE] 与 tool_call JSON 距离超出旧 ±3 窗口的场景）。
- **FR-10 [前端]** timeline turn 分组渲染；thinking 折叠成单行摘要（可展开）；tool 卡片带状态徽标（✓/✗ + 耗时）；channel 着色强化。
- **FR-11 [token]** agent-run 日志面板展示 input/output token 消耗（数据源 `AgentRun.input_tokens/output_tokens`，流式实时更新）。

## 决策引用（全部当前版本 D-xxx@vN）

| 决策 | 覆盖需求 | 状态 |
|---|---|---|
| D-001@v1 A1=bind mount+daemon翻译 | FR-01 | accepted |
| D-002@v1 前端=修bug+优化展示 | FR-07, FR-08, FR-09, FR-10 | accepted |
| D-003@v1 数据迁移可清空 | FR-01（部署步骤） | accepted |
| D-004@v1 sillyspec 跨仓库管理 | FR-02, FR-03, FR-05, FR-06 | accepted |
| D-005@v1 执行策略 P0/P1 | 全部（Wave 划分） | accepted |
| D-006@v1 token 消耗展示 | FR-11 | accepted |

**全部 D-001~D-006 已覆盖，无剩余风险决策。**

## 非功能需求
- **向后兼容**：daemon 未配 `SPEC_ROOT_MAP` 时翻译器跳过不报错；backend claim payload `specRoot` 字段对 daemon 旧版无影响（undefined 时回退 prompt 翻译）；sillyspec scan-docs.yaml 占位符旧值时 workflow.js 回退 cwd 逻辑（本次一并更新 yaml）。
- **无 DB schema 变更**：本变更不动表结构，去重逻辑在应用层（backend submit_messages / 前端 normalize）。
- **可清空重建**：spec-data named volume → bind mount 时，按 CLAUDE.md 规则7 清空旧数据。

## 验收（联调）
用修复后的 sillyspec + SillyHub 对 `myaaa` 重跑一次完整 scan：全程无 EPERM、无 post-check 误报、无 init 残留告警、日志无碎片/重复卡片、最终状态正确（非 completed_with_warnings/failed_post_check 带病推进）。
