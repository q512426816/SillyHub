---
author: qinyi
created_at: 2026-10-30T12:07:20
plan_level: light
execution_mode: main
---
# 轻量计划（Light Plan）：会话配置条待生效高亮 + sessionStorage 持久化

## 来源

brainstorm 已定案（用户三轮裁决，2026-10-30）：暂存能力已全量交付（2026-10-25-session-config-deferred-switch + 2026-10-26-config-staged-all-states），本次补**感知层**——四控件（供应商/模型/思考档位/档案）逐控件待生效高亮（brand 描边+浅底，**无文字角标**，悬停「已记住，将随下一条消息发送时生效」）+ sessionStorage 按会话隔离短期持久化（刷新恢复/关标签页自清/per-tab 隔离）。生效时机维持「随下一条消息」；askuser 答复链路（respondSessionPermission → daemon 同轮回喂）零改动。

## 范围

- frontend/src/components/sessions/session-config-bar.tsx（四控件 pending 高亮态渲染 + title 优先级）
- frontend/src/components/daemon/session-panel/session-panel-page.tsx（stagedConfig+labels 持久化写/恢复/清）
- frontend/src/components/sessions/__tests__/session-config-bar.test.tsx（高亮渲染/消失/存量无高亮用例）
- frontend/src/components/daemon/__tests__/session-panel-staged-list-refresh.test.tsx（持久化写/恢复/不串台/坏数据丢弃用例）
- 已交付随变更提交：frontend/src/components/prototype/session-config-pending-view.tsx、frontend/scripts/prototype-build.mjs（VIEWS 注册）、变更目录 prototype-config-pending.html（登记进 task-01 allowed_paths 一并提交）

## 验收

- FR-01（高亮渲染/取消消失）、FR-02（发送成功清空暂存+清存储，档位失败残留态照写）、FR-03（持久化刷新恢复/切换会话不串台/坏 JSON 静默丢弃）、FR-04（askuser 场景零逻辑改动）、FR-05（既有行为零回归）逐条通过（requirements.md）
- 聚焦测试全绿（上述两测试文件）+ `pnpm exec tsc --noEmit` 无错 + eslint 零新增告警
- 高亮视觉对照原型四态（prototype-config-pending.html）一致

## Review Focus 盲区清单（隐含面）

1. 暂存挂着时会话 ended/机器离线（canSwitch=false）：高亮仍在但控件禁用——title 必须显示禁用原因而非 pending 文案（D-009：禁用态优先）→ task-01 acceptance
2. 思考档位 POST 失败保留暂存的部分清除路径：持久化必须写残留态（labels+thinking_level），刷新后残留一致 → task-02
3. 恢复的暂存值对应供应商/档案可能已被删：不前置校验（D-006），显示名回退 id 原文；发送失败沿用既有保留重试 → task-02
4. mobile 端档案/思考档位控件默认收进「设置」展开态（mobileReveal 门控渲染）——高亮须同样跟随进折叠区，桌面/移动一致 → task-01
5. SSR 预渲染：sessionStorage 访问必须 typeof window 守卫（Next 预渲染阶段无 window），服务端零访问零报错 → task-02

## 覆盖矩阵（decisions.md D-001@v2 ~ D-009 全当前版本）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v2 | task-01 | 高亮类名+title 断言用例（无角标） |
| D-002@v1 | task-02 | 生效语义不变（链路零改动核对） |
| D-003@v1 | （范围声明） | plan 范围仅 page 模式四控件文件 |
| D-004@v1 | task-02 | sessionStorage key 隔离/写/恢复用例 |
| D-005@v1 | task-02 | 坏 JSON 静默丢弃用例 |
| D-006@v1 | task-02 | 恢复不校验有效性（既有发送失败重试承接） |
| D-007@v1 | task-01 | 原型四态对照验收 |
| D-008@v1 | task-02 | askuser 答复链路零改动核对（FR-04） |
| D-009@v1 | task-01 | 禁用态 title 优先级用例 |
