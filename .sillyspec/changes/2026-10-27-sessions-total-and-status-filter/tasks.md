---
author: flow-machine-draft
created_at: 2026-10-27T04:54:27.044Z
---
# 任务注册表（Tasks）— 2026-10-27-sessions-total-and-status-filter

- [x] task-01: 后端 status_counts——read_model 提取 _build_session_filters + 新增分组计数函数 + schema/router 装配（list_agent_sessions 签名不变），验证：test_session_history.py 既有用例零回归
- [x] task-02: 后端 status_group=ongoing 过滤参 + 与 status 互斥 422，验证：新增用例三态命中 / 同传 422 通过
- [ ] task-03: 类型再生成——pnpm gen:types（frontend）+ pnpm -C sillyhub-daemon gen:types + openapi.json 提交面核对
- [ ] task-04: 手机端 MobileSessionList——统计行（status_counts 总和）+ 四 chips（全部/在线/已结束/失败，服务端计数）+ 服务端档切换，验证：mobile-session-list.test.tsx 新用例通过
- [ ] task-05: 手机端默认展示收敛——最新 10 条 ∪ 在线全显 + 「显示全部 N 条」展开，验证：组件测试覆盖在线>10 场景
- [ ] task-06: PC 端 SessionListPanel——「活跃」改「在线」（ongoing 口径）+ 组内默认 10+在线全显，验证：session-list-panel.test.tsx 相关用例通过
- [ ] task-07: 相关测试全跑 + lint 触及文件无新增错误，验证：backend pytest 定向文件 + frontend vitest 两组件测试绿
