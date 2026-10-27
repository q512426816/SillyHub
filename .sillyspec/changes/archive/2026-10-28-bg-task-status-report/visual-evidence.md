---
author: qinyi
created_at: 2026-10-28 11:20:00
---

# 渲染对照证据（Visual Evidence）— 2026-10-28-bg-task-status-report

> 本变更为状态信号链（daemon→backend→frontend），无新增布局/视觉改动；UI 触达=活动条目状态翻转（既有条目的终态显示，非新渲染面）。执行环境无真机截图通道，以「改动点 × 预期效果 × 测试锚」文字对照落盘；平台实测全链路归 verify（NFR-03）。

## 逐卡对照表

| 卡 | 用户痛点 | 改动 | 预期效果 | 测试锚 |
|---|---|---|---|---|
| task-02 | 完成信号被忽略 | 解析器识别 task-notification 产附着字段（D-004）+批量提取 | daemon 能读出终态四字段 | parse-task-notification.test 7 用例（实录 fixture+多块+失配） |
| task-03 | 信号传不到平台 | 独立扫描环（D-006：60s 末 64KB 提取+快照 diff+首扫基线）+HubClient notifyBgTaskFinal | 终态分钟级上报平台 | agent-log/session-manager 185 用例零回归+tsc 0 |
| task-04 | 平台无接收面 | 新端点 bg-task-final（DTO 三值枚举+越权校验+纯发布 D-005） | 信号进 Redis→SSE 推前端 | test_session_bg_task_final 6 用例（401/404/422/200 三态 payload 逐字） |
| task-05 | 条目永挂运行中 | SSE 信封+onBgTaskFinal→失效 agent logs 查询重拉 | 终态到达→活动数据刷新→条目状态自然翻转 | session-panel-variant+m-session-chat 回归 16 用例 |
| task-06 | 空闲期无提示（FR-04） | D-007 范围收缩：延后（启动事件源缺失，另立变更） | 本轮不交付（见决策记录） | decisions.md D-007 |
| task-07 | 类型债 | openapi+双端 api-types 同提交（闸门⑨） | 类型同步零漂移 | pre-push ci-fast-gate（api-types 漂移×2） |

## desktop/旧版兼容锚

- 旧 daemon 无 bg_task_final 事件：前端回调不触发、条目维持现状（不误翻不报错）。
- 未知事件 kind：SSE 信封词表扩展向后兼容（既有消费方忽略）。
- 越权上报：非 runtime owner 404 零发布（测试断言）。

## 平台实测清单（verify 阶段 NFR-03）

1. 部署后启动一个后台任务（如打包）→ 观察完成后 ≤2 分钟平台活动条目是否翻转为终态。
2. 旧数据会话抽查：无终态事件时条目维持现状（零回归）。
