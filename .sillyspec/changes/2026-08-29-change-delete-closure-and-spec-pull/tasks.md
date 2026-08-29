---
author: qinyi
created_at: 2026-08-29 11:46:17
change: 2026-08-29-change-delete-closure-and-spec-pull
scale: large
---

# 任务 — 变更中心删除闭环、文档拉取与进行中可见性

> 任务唯一真相源（plan 阶段展开，15 个 task）。task-13/14 为跨仓任务（sillyspec 仓，任务卡片 repo: sillyspec，local.yaml repos 已注册）。设计依据见 design.md（17 节）。

- [ ] task-01: alembic migration 两列 + ORM 字段（platform_deleted / hidden）(depends_on: —)
- [ ] task-02: apply_ops 空目录清理 + platform_deleted 拦截（add/rename 拒、delete 放行）+ _write_spec_root 落盘级前缀排除 (depends_on: task-01)
- [ ] task-03: scoped 定向删除 + 删除环/_apply_parsed deleted 三点豁免 + progress 联动删 + rename 限定 scope + 红测改写 (depends_on: task-01, task-02)
- [ ] task-04: _ensure_change_row 双层拒收 + progress 409 change_deleted + CLI 墓碑写路径处理 (depends_on: task-01)
- [ ] task-05: quicklog apply 期对账（缺失 ql_id 置 hidden）+ merge_entries 过滤 (depends_on: task-01)
- [ ] task-06: soft_delete_change_dir + DELETE /changes/{cid}（组合权限）+ 服务顺序 + 审计 + 权限矩阵测试 (depends_on: task-02, task-04)
- [ ] task-07: 前端删除入口（DeleteChangeConfirm + 操作列 + 详情危险按钮 + 移动端 + deleteChange + gen:types）(depends_on: task-06)
- [ ] task-08: GET /changes/-/spec-bundle（前置注册 + 鉴权矩阵）+ X-Spec-Version 头 + PLATFORM-BUNDLE.json (depends_on: —)
- [ ] task-09: 前端「下载文档包」按钮（blob 范式 + 快照文案）(depends_on: task-08)
- [ ] task-10: daemon 兼容回归（bundle 新增元数据后 pullSpecBundle/spec_version 判定） (depends_on: task-08)
- [ ] task-11: backend 活动投影（ChangeSummary + last_pushed_at + enrich 顺带取值 + 两态单测）(depends_on: —)
- [ ] task-12: frontend 活动徽标（真值表三态 + ISO_LIKE_RE 防御解析 + 详情页最后信号）(depends_on: task-11)
- [ ] task-13: 【跨仓 sillyspec】X1 墓碑上报 + X3 步骤开始上报 + X4 任务边界 triggerSync (depends_on: task-04)
- [ ] task-14: 【跨仓 sillyspec】X2 pullSpecBundle + 顶层 pull 命令注册 (depends_on: task-08)
- [ ] task-15: 收尾：模块文档 + ROADMAP + 知识库决策提炼 + docs/sillyspec 回执 (depends_on: task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11, task-12, task-13, task-14)
