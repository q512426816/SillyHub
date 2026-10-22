---
author: zcode-agent
created_at: 2026-10-22T11:17:23.094Z
---
# 任务注册表（Tasks）— 2026-10-22-file-changes-card-fix

- [x] task-01: daemon 文件清单改 status ∪ git diff --name-status（含轮内 commit）+ numstat 补行数——验证：新增 commit 夹具测试绿
- [x] task-02: daemon 分阶段降级（numstat/name-status 超时保留清单）+ 慢盘自适应预算 + env 覆盖——验证：partial 保留清单与预算解析测试绿
- [x] task-03: daemon 编辑调用次数（工具名重复保留）+ 未跟踪/删除状态保留——验证：定向单测绿
- [x] task-04: 前端视图模型补 status/行级可信标记、notice 按 reason+耗时、编辑次数取真实调用数——验证：turn-file-changes 用例绿
- [x] task-05: 卡片渲染状态徽标、删除行不可点、未跟踪/mtime 破折号、notice 态共享工作区提示、头部文案——验证：file-changes-card 用例绿
- [x] task-06: 跑 daemon 与前端定向测试面，修正既有断言/回归——验证：两条测试命令全绿
- [x] task-07: 同步 daemon/frontend 模块文档——验证：文档与实现一致
