---
author: WhaleFall
created_at: 2026-06-04 13:44:54
---

# Proposal: 修正 Agent 驱动变更中心流程闭环

## 动机

agent-driven-change-center 变更已实现基础 human_gate 机制（字段、Review Gate API、Gate 面板），但状态机存在多处断点导致主流程无法闭环。用户无法完成从"新建需求"到"归档"的完整链路。

## 关键问题

1. **Gate 时机错误**：`transition()` 进入 propose/plan/verify/archive 时立刻设置 `need_xxx`，但此时 Agent 还在跑阶段。用户看到"请确认四件套"时四件套根本没生成。
2. **同阶段重跑不合法**：`proposal_review("revise")` 尝试 `propose→propose`，但 TRANSITIONS 没有自环边，会被状态机拦截返回 InvalidTransition。
3. **human-test pass 直接 archive**：跳过了归档确认门禁，用户没有机会在归档前做最终检查。
4. **归档确认按钮复用 test_pass**：前端 `need_archive_confirm` 按钮错误调用 `humanTest(pass)`，但后端要求 `verify+need_human_test` 才能调用，导致 400 错误。
5. **前端 Gate 面板不传 comment**：所有 review API 都接受 comment 参数，但前端只有按钮没有输入框。
6. **旧 UI 残留**：详情页仍引用 `ready_for_dev`、`accepted` 等已删除的 stage，可能导致渲染异常。

## 变更范围

### 后端
- 修改 `resolve_human_gate()` 全返回 none，新增 `complete_stage()` 统一入口
- 新增 `rerun_stage()` 处理同阶段重跑
- TRANSITIONS 加 `verify→propose` 回退边
- 修正 `proposal_review` / `plan_review` / `human_test` 三个 API
- 新增 `archive-confirm` API

### 前端
- Gate 面板加 comment textarea
- 修 `need_archive_confirm` 按钮调 `archiveConfirm` API
- 清理 `ready_for_dev` / `accepted` 等旧状态残留

## 不在范围内

- AgentRun 列表与日志增强（task-21/22 原设计）
- verify 自动修复多轮可视化
- 文档确认状态（generated/reviewing/approved/needs_revision）扩展
- 多人协同评审
- 附件上传
- 复杂文档版本 diff

## 成功标准

1. 进入 propose 时 `human_gate=none`，propose 完成后 `human_gate=need_proposal_review`
2. proposal revise 能带意见重跑 propose，不报 InvalidTransition
3. plan replan 能带意见重跑 plan，不报 InvalidTransition
4. human-test pass 进入 `archive+need_archive_confirm`，不直接 dispatch archive
5. human-test bug 触发 quick
6. human-test doc_mismatch 回到 propose
7. archive-confirm 能触发 archive Agent
8. 前端 Gate 面板能填写并提交 comment
9. 前端不再引用 `ready_for_dev` / `accepted`
