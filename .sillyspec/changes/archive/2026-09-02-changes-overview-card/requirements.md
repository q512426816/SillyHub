---
author: qinyi
created_at: 2026-09-02 21:26:25
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台管理员 | 工作台查看各仓 SillySpec 健康度，发现 ghost/冲突后去 CLI 处理 |
| Agent 会话 | （间接受益）其 change 进度被总览透出，滞留更早被发现 |
| daemon | 采集 progress envelope 并随心跳上报 |
| backend | 落库与 API 透出 |

## 功能需求

- FR-01 工作台「活跃变更总览」卡片：健康条（活跃/ghost/冲突计数 + envelope ok/warnings/errors）、变更行（stage_label 徽标 + 6 点主管线 + steps 进度 + last_active 相对时间）、ghost 折叠组（默认折叠 + 清理指引）、冲突区（spec 树/进度类型徽标 + resolve 指引）、全部/需关注过滤 tab。原型 v2 为视觉基准。
- FR-02 daemon 周期采集：默认 60s（可配置），spawn `node <sillyspec-bin> progress show --json`，cwd=workspace.root_path 主仓根固定锚定（规则 22），execFile 数组形参（跨平台）。
- FR-03 三态降级矩阵：①成功→新快照；②能力缺失（ENOENT/无 --json，warn 一次后同类静默）→上报 null；③瞬态失败（超时复用 SILLYSPEC_TIMEOUT_MS 先例/非零退出）→保留上次快照（前端显示数据过期标记）。
- FR-04 心跳载荷摘要 sillyspec_status：32KB 自设预算；changes 截断 N=50（透传 name/ghost/current_stage/stage_label/last_active/steps）；超预算降级纯计数；envelope 的 readable/command 字段容忍但不透传。
- FR-05 backend 落库：Machine.sillyspec_status JSON 列（None=清除语义，对齐 sillyspec_update 权威注释 router.py L307-310 / model.py L106-110）；null 载荷置 NULL；新迁移；机器视图嵌套透出。
- FR-06 机器维度分组：每台 daemon=其绑定 workspace 的一组健康数据；前端按机器/工作区选择数据源；多仓=多机器各自上报（零仓级路由）。
- FR-07 类型同步：backend schema 变更后 `pnpm gen:types` 再生成 api-types.ts + openapi.json（node_modules 健康预检）。

## 非功能需求

- NFR-01 回归安全：心跳新增字段对既有消费者零破坏（Pydantic 忽略未知字段，用例覆盖验证）。
- NFR-02 跨平台：Windows/Linux/macOS（spawn 路径空格、execFile 形参、无 shell 依赖）。
- NFR-03 样式合规：FRONTEND_PAGE_STYLE §0.5 双主题 brand-* 语义阶、antd Badge/Tag、SectionCard 宿主、空值 —。
