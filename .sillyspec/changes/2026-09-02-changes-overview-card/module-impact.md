---
author: qinyi
created_at: 2026-09-03 08:55:00
---
# 模块影响分析（Module Impact）— 工作台「活跃变更总览」卡片（B'）

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend:daemon-model | 修改+新增 | DaemonInstance（机器表）sillyspec_status JSON nullable 列 + add_machine_sillyspec_status 迁移；None=清除语义（锚 sillyspec_update 权威注释 router.py L307-310 / model.py L106-110） |
| backend:daemon-schema | 修改 | 心跳载荷追加 sillyspec_status 摘要模型 + DaemonMachineRead 机器视图嵌套读取模型 |
| backend:daemon-router/service | 修改 | 心跳落库（null 载荷置 NULL）+ 机器视图端点透出嵌套 sillyspec_status |
| backend:daemon-tests | 修改+新增 | test_machine_sillyspec.py 扩展落库/清除/嵌套读取用例 + 既有心跳消费者回归 |
| sillyhub-daemon:daemon-core | 修改 | 心跳组装段（L77-124 先例）追加 sillyspec_status；sillyspec 运行期管理器注入采集器 |
| sillyhub-daemon:config | 修改 | 采集间隔配置（默认 60s）+ 采集超时常量（复用 runtime-handler SILLYSPEC_TIMEOUT_MS 先例） |
| sillyhub-daemon:tests | 修改+新增 | 三态矩阵全覆盖新测试 + daemon-heartbeat-sillyspec.test.ts 深比较断言更新（L247 toEqual / L342-343 length） |
| frontend:workspace-components | 新增 | changes-overview-card.tsx（健康条/管线/ghost 折叠/冲突区/过滤/占位与过期态）+ 组件测试 |
| frontend:workspace-page | 修改 | /workspaces/[id] page SectionCard 网格挂卡片 + 引导跳变更中心（page.test.tsx 断言可能需更新） |
| frontend:lib-daemon | 修改 | 机器数据读取扩展 sillyspec_status（api-types 生成） |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/migrations/versions/2026xxxx_add_machine_sillyspec_status.py | 新增迁移，task-01 创建（versions 目录属 backend:migrations） |
| backend/openapi.json、frontend/src/lib/api-types.ts | 生成物，task-05 跑 pnpm gen:types 再生成，不手改 |

## 关联任务

task-01/03（backend 数据+接口）、task-02/04（daemon 采集+测试）、task-05/06/07（前端类型/组件/挂载）、task-08（三端集成验收）。

## 更新结果

| 目标 | 操作 | 状态 |
|---|---|---|
| （首版于 plan 审查后生成；execute/verify 阶段更新，archive 终审） | — | — |
