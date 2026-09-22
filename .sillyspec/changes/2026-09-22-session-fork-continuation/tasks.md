---
author: qinyi
created_at: 2026-09-22 19:53:00
---
# 任务清单（Tasks）

- [x] task-01: 数据模型迁移——agent_sessions fork 三列+origin='fork'+agent_runs engine_anchor+索引（model.py+alembic+模型单测）
- [x] task-02: 双 spike 定档——pi fork 截断语义实测 + claude resumeSessionAt×forkSession 真机组合验证，结论落 D-008 与 spike-pi-fork.md
- [x] task-03: caps 第 16 键 sessionFork——providers.ts 单源+生成器枚举先例扩展+三端镜像刷新+alignment 升 16 键+缺键 none 兜底（depends_on: task-02）
- [ ] task-04: 轮锚点回填（消费端）——submit_commit.py 从已落库消息 metadata.engineAnchor 取锚分档回填 engine_anchor+单测（depends_on: task-01, task-06；D-011 数据源）
- [ ] task-05: backend fork 服务与契约——fork.py（校验/native·seed 分派/种子体积帽/快照继承）+POST fork 端点+DTO+SessionRead 透出+placement metadata+claim 白名单+gen:types+pytest（depends_on: task-01, task-03）
- [ ] task-06: daemon fork 透传——execPayload 解析+CreateSessionInput 增键+driverOpts 组装+claude driver resumeSessionAt/forkSession+driver-factory 独立转发分支（R-07）+（条件）pi 原生路径+单测（depends_on: task-05）
- [ ] task-07: 前端分叉发起——sessions.ts forkSession API+轮头「从此分叉」三重门控（caps/终态/锚点）+确认弹层档位标注+组件测试（depends_on: task-05）
- [ ] task-08: 谱系溯源 UI——lineage-block 溯源块+谱系面包屑+浮层标题参数化+列表分叉分组徽标+page/dialog 双挂载+组件测试+claude 真机 E2E 验收记录（depends_on: task-06, task-07）
