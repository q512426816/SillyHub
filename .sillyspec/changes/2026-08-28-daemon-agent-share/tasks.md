---
author: qinyi
created_at: 2026-08-28 00:38:14
---

# 任务清单（Tasks）

> plan 阶段写回版（与 plan.md 任务总表同源，11 task）。任务明细蓝图见 tasks/task-NN.md。
> 说明：原骨架 task-09/10（页面两区块）合并为新 task-09（同文件 page.tsx 避免同 Wave 并行冲突），选择器为 task-10，回归确认为 task-11。

- [ ] task-01: grants 数据层——`daemon_runtime_grants` 模型 + Alembic 迁移（建表 NULLS NOT DISTINCT / daemon_borrow_audit 加 grant_id / 存量 shared=true 迁移跳过 daemon_id NULL 行）+ 单测
- [ ] task-02: grants 授权查询——`authorize_pinned_runtime` / `list_machines_shared_to_me` / `resolve_granted_daemon_for_borrow` + 授权矩阵单测 (depends_on: task-01)
- [ ] task-03: 会话钉定校验切换——session/service.py owner-only 扩展为授权判定 + placement 二次复查授权分支 + 交互式借用审计（含 grant_id）+ 单测（只传共享 runtime/未授权 404/停用失效/修改端点 owner-only 回归） (depends_on: task-02)
- [ ] task-04: 平台共享智能体 API——shared-agents CRUD（require_platform_admin，runtime 限管理员自己名下在线/档案 visibility 显式升级/writable_dir ⊆ allowed_roots 校验）+ active 公共端点（grants/router.py 定义，挂载归 task-07）+ 单测 (depends_on: task-01)
- [ ] task-05: create_session platform 档案分支——检测前置到二选一校验之前 + 强制 pinned/cwd/allowed_roots_overlay=[writable_dir] 下推 + allowed_tools 不含 Bash（D-009）+ spike-02 作用域实证（R-09/D-010，per-runtime 误伤则改 session 级 provider）+ 单测（只传共享档案/参数被覆写/停用回退/写限目录内外/Bash 拒绝/管理员普通会话不受限/不写借用审计） (depends_on: task-03, task-04)
- [ ] task-06: 借用回退切 grants——borrow_resolver 数据源切换（语义等价）+ member_runtimes 开关端点同事务双写 grants + queries 薄壳委托 + 借用存量测试全量回归 (depends_on: task-02)
- [ ] task-07: machines/runtimes-page 附加 shared_to_me 装配 + daemon router 挂载 grants 路由 + 单测 (depends_on: task-02, task-04)
- [ ] task-08: gen:types 再生成（backend/openapi.json + frontend api-types.ts 同步提交，CLAUDE.md 规则 21） (depends_on: task-03, task-04, task-05, task-06, task-07)
- [ ] task-09: 前端守护进程页面——「共享给我的」区块（shared-machines-section，仅会话操作）+ 平台共享智能体管理卡（platform-shared-agents-card：创建表单/生效列表/停用）+ 统计计数 + lib/daemon.ts sharedAgents API 封装 + 两组件测试 (depends_on: task-08)
- [ ] task-10: 前端会话选择器——机器候选含共享机器（共享徽标三入口：floating-host + 门户 session-config-bar.tsx + use-daemon-machines.ts 数据源，回退链逻辑不变 D-004@v2）+ 档案选择器共享智能体标识 + session-panel「平台共享」徽标 + 组件测试 (depends_on: task-08)
- [ ] task-11: 回归确认——R-02 沙箱 marker interactive 行为回归 + 写约束集成冒烟（writable_dir 内可写/外拒绝/Bash gate 拒绝，D-009 落地确认）+ 守护进程页面/会话选择器对照原型手工验收 (depends_on: task-09, task-10)
