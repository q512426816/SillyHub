---
author: qinyi
created_at: 2026-09-02 21:26:25
---

# 任务清单（Tasks）

> 注册表唯一真相（execute 从本文件解析任务，按 plan.md Wave 引用分组）；Wave/依赖/覆盖见 plan.md 任务总表。

- [x] task-01: backend 数据层——Machine.sillyspec_status JSON 列 + add_machine_sillyspec_status 迁移 + 心跳载荷/机器视图嵌套 schema（None=清除语义）(depends_on: 无)
- [x] task-02: daemon 采集与上报——config 采集间隔(60s)/超时常量 + 采集器（execFile spawn 主仓根 + 三态降级矩阵 + 32KB 预算截断/计数降级）+ 心跳组装追加 sillyspec_status (depends_on: 无)
- [ ] task-03: backend 接口层——心跳落库（null 载荷置 NULL）+ 机器视图端点透出嵌套 sillyspec_status + 单测（含既有心跳消费者回归）(depends_on: task-01)
- [ ] task-04: daemon 测试——三态矩阵全覆盖（成功/null 能力缺失/瞬态失败保留快照）+ 超限截断降级用例（fixture 容忍 readable/command）+ 更新既有 daemon-heartbeat-sillyspec.test.ts 深比较断言（心跳 body toEqual 与载荷参数 length 追加字段后必破）(depends_on: task-02)
- [ ] task-05: 前端类型链——pnpm gen:types（node_modules 健康预检）→ api-types.ts + openapi.json + lib/daemon.ts 机器数据读取扩展 (depends_on: task-03)
- [ ] task-06: 前端卡片——changes-overview-card.tsx（健康条/变更行管线/ghost 折叠/冲突区/过滤/占位与过期态）+ 组件测试 (depends_on: task-05)
- [ ] task-07: 工作台挂载——/workspaces/[id] page SectionCard 网格挂卡片 + 引导跳变更中心 (depends_on: task-06)
- [ ] task-08: 三端集成验收——卡片数据与同刻 CLI 直连一致 + null 占位/数据过期标记实测（integration-critical 证据）(depends_on: task-07)

---

<!-- 外来条目保留（非本变更内容，原文件残留的 quick 任务行，勿删）：
- [ ] ql-20260902-022-1ac4 群聊运行徽标实时性+URL 深链+头部工具栏（合并收口）
-->
