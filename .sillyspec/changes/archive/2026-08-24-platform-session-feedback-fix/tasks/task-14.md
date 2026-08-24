---
id: task-14
title: 'End-to-end validation of plan/bash/askuser minimize in real session'
title_zh: '端到端验证 plan/bash/askuser 最小化在真实会话中可用'
author: 'qinyi'
created_at: 2026-08-24 11:07:30
priority: P0
task_type: verification
depends_on:
  - task-01
  - task-02
  - task-03
  - task-04
  - task-05
  - task-06
  - task-07
  - task-08
  - task-09
  - task-10
  - task-11
  - task-12
  - task-13
blocks: []
requirement_ids: [FR-01, FR-02, FR-04]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths:
  - .sillyspec/changes/2026-08-24-platform-session-feedback-fix/prototype-platform-session-feedback.html
  - .sillyspec/changes/2026-08-24-platform-session-feedback-fix/e2e-report.md
goal: >
  在本地完整环境（backend + daemon + frontend + redis/postgres）中跑一次真实会话，
  验证 plan 模式强确认、Bash 命令实时反馈、askuser 弹窗最小化三项功能在端到端链路中真正可用，
  并产出 e2e 验证报告。
implementation:
  - 启动依赖：`make dev-up` 拉起 postgres 与 redis。
  - 启动服务：终端 1 `make backend-run`；终端 2 `make frontend-run`；本地 daemon 连接后端并 claim 一个 lease。
  - 新建或复用一个 platform session，触发一次 plan skill / EnterPlanMode 调用，
    确认前端在 2 秒内渲染 PlanApprovalCard，且选择「确认/修改/取消」后决策经后端回传到 daemon。
  - 在同一会话中触发一次 Bash tool_use（例如 `ls -la` 或 `sleep 2 && echo ok`），
    确认 BashProgressCard 显示 running 状态、实时追加 stdout/stderr chunk、最终显示 completed/failed 与退出码。
  - 触发一次 askuser / permission_request，点击最小化按钮，确认弹窗收缩为右下角浮动胶囊并显示未决角标；
    点击胶囊还原后，弹窗状态与输入内容保持；再提交决策验证流程正常。
  - 使用浏览器 DevTools Network/SSE 面板检查 agent_session:{id} 通道事件顺序，
    确认无异常断连、无 console error。
  - 将验证结果、环境版本、异常与截图路径写入 e2e-report.md。
acceptance:
  - PlanApprovalCard 在 plan_mode_entered 事件到达后 2 秒内渲染，且用户决策能回传 daemon。
  - BashProgressCard 完整展示命令、running/completed/failed 状态、至少一段 stdout/stderr 输出及退出码。
  - askuser / permission 弹窗可最小化为浮动胶囊，还原后状态不丢失，决策提交成功。
  - 端到端会话过程中 SSE 无断连，浏览器 console 无 error 级别的异常。
verify:
  - make dev-up
  - make backend-run
  - make frontend-run
  - 本地 daemon 启动并 claim lease
  - 浏览器真实会话走查 + DevTools SSE/Network 检查
  - 输出 .sillyspec/changes/2026-08-24-platform-session-feedback-fix/e2e-report.md
constraints:
  - 本 task 只验证不修复；若发现 bug，记录到 e2e-report.md 并视严重程度开新 quick/change 处理，禁止在 e2e 阶段热修代码。
  - 允许重置开发/测试数据，不追求历史会话兼容。
  - e2e 报告必须包含复现步骤、环境版本、通过/不通过项、截图或日志路径。
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
