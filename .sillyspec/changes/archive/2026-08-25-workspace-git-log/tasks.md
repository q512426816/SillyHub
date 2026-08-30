---
author: qinyi
created_at: 2026-08-25 21:24:40
change: 2026-08-25-workspace-git-log
---
# 任务清单（Tasks）

> 任务名唯一真相在本文件；plan.md Wave 段按纯 ID 引用。execute 勾选与 verify 对照都在本文件。

- [x] task-01: daemon host-fs 四只读方法（git_log/git_refs/git_show/git_diff_file）+ daemon.ts 平名注册 + 解析边界单测
- [x] task-02: backend git_log 模块骨架（router/service/schema + main.py 挂载 + 权限门控 + 错误映射 + local.yaml modules 补 git_log 映射）(depends_on: 无)
- [x] task-03: graph_layout lane 计算器纯函数 + 七类拓扑单测（含窗口一致性与 lookahead 退化）(depends_on: 无)
- [x] task-04: backend service 数据链路完整化（平名 RPC 直连/probe 两态/refs 合并/过滤/分页 lookahead/参数校验）+ router 集成测试 (depends_on: task-01,task-02,task-03)
- [x] task-05: pnpm gen:types 再生成 + 前端 lib/git-log.ts hooks（queryKey 工厂 + useQuery + 详情/diff 按需 hook）(depends_on: task-04)
- [x] task-06: 前端页面与组件（TABS 注册/page 骨架/commit-list 虚拟滚动/commit-graph 泳道 SVG/detail Drawer/file-tree 目录树）+ 组件测试 (depends_on: task-05)
- [x] task-07: 主题合规与整链路验收（三主题对照 FRONTEND_PAGE_STYLE §12 + ≥8 泳道辨识度证据 + 真机全链路手测记录）(depends_on: task-06)
