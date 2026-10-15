# 决策知识 — app-admin-pages

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-unmapped-001@v2 用户确认——页面内容=原看板全部+连接状态
状态：implemented
变更：2026-10-14-admin-server-status
原编号：D-002@v2
锚点：未记录
最近确认：73e881ba5
理由：用户选择「原看板全部+连接状态（推荐）」。决策内容同 v1，确认主体由 AI 推断改为用户亲选。
supersedes：D-002@v1

## D-unmapped-002@v1 页面落位系统管理组末尾，menuKey=server-status
状态：implemented
变更：2026-10-14-admin-server-status
原编号：D-003@v1
锚点：未记录
最近确认：73e881ba5
理由：用户原话"系统管理页面"→ system 组第 6 条（menus 之后、ppm 组之前），menuKey=server-status，label=服务器信息，href=/admin/server-status（absolute，对齐组内 /admin/* 惯例）。放组末尾使 system 组既有声明序索引（users=18/org=19/roles=20）不动，仅 ppm 组索引+1（无测试锚定 ppm 索引）。
故障面：菜单覆盖表若已有同名 menu_key=server-status 的孤儿行会意外复活（核实过 menu_overrides 现存无此 key 才安全）。
退役判据：服务器信息功能下线时同步删菜单条目并重算排序锚。

## D-unmapped-003@v1 实现方案=独立页面（方案 A）
状态：implemented
变更：2026-10-14-admin-server-status
原编号：D-005@v1
锚点：未记录
最近确认：73e881ba5
理由：用户亲选方案 A：系统管理组新增第 6 项菜单「服务器信息」，独立页面 /admin/server-status 展示 CPU/内存/磁盘+四项业务统计+DB/Redis 连接状态，5s 自动刷新；接口同步收紧鉴权。
故障面：菜单注册表新增条目平移 ppm 组声明序索引（共享断言面⑦），须同提交重算 admin/menus 测试锚。
退役判据：页面下线时菜单条目+图标映射+测试锚同步回收。

## D-unmapped-004@v1 落选——并入设置页 Tab（方案 B）
状态：rejected
变更：2026-10-14-admin-server-status
原编号：D-006@v1
锚点：未记录
最近确认：73e881ba5
理由：落选。劣势：设置页语义是平台配置，服务器运行状态混入入口不直观，不符用户"专门的页面"表述；设置页已有 4 个 Tab 再加拥挤。优势（改动面小、不碰菜单注册表）不足以抵消入口语义错位。
否决理由：设置页语义为平台配置，运行状态混入入口不直观且 Tab 拥挤；改动面小的优势不足以抵消语义错位。
复潮条件：若未来系统管理组菜单数量受限或用户改口接受设置页承载，可重议。

## D-unmapped-005@v1 落选——工作区首页挂卡片（方案 C）
状态：rejected
变更：2026-10-14-admin-server-status
原编号：D-007@v1
锚点：未记录
最近确认：73e881ba5
理由：落选。劣势：与 D-001@v2 收紧权限直接冲突（首页全员可见 vs 管理员权限视图，无权限用户只能看降级卡片）；不落系统管理区，不符用户"系统管理页面"原话。
否决理由：与收紧权限决策直接冲突（首页全员可见 vs 管理员视图），且入口不落系统管理区违背用户原话。
复潮条件：若出现"全员可见的运行状态概览"需求（非管理员运维视图），可另立变更重议。
