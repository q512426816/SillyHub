# 决策知识 — frontend_app

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 : 会话轮次导航 = 桌面常驻左栏 + 移动端收 ⋯ 菜单抽屉
状态：implemented
变更：2026-09-08-session-turn-nav
锚点：`frontend/src/components/daemon/session-panel/session-panel-page.tsx`
最近确认：fd96ae48
理由：ZCode 式导航用户定案；桌面常驻（刻度轨仅 ~30px 不占聊天宽度），mobile 触屏无 hover 走 ⋯ 菜单抽屉行式列表（点击即跳），dialog 宿主不挂载。

## D-002@v1 : 目录覆盖全部历史轮次（runs 补全 + 点击循环加载定位）
状态：implemented
变更：2026-09-08-session-turn-nav
锚点：`frontend/src/components/daemon/session-panel/session-panel-page.tsx`
最近确认：fd96ae48
理由：高轮次回顾是核心痛点，仅已加载轮次不解决；未加载轮次由 runsMeta 补全为空心刻度，点击时复用触顶翻页链循环加载（≤8 页、suppress 触顶自动加载）到命中再 scrollIntoView。

## D-004@v1 : 目录数据 = 前端拼装（displayTurns + runsMeta），零后端改动
状态：implemented
变更：2026-09-08-session-turn-nav
锚点：`frontend/src/components/daemon/session-panel/session-panel-page.tsx`
最近确认：fd96ae48
理由：runsMeta（attach/每轮完成已全量拉刷）+ displayTurns 信息足够拼目录；方案 C（后端摘要端点）引新契约 YAGNI 拒绝、方案 B（仅已加载）违 D-002 排除；runs 接口无 prompt 字段，未加载条目 v1 元数据+点击回填（D-005）。

## D-006@v1 : 悬浮窗归 desktop variant 分支（Grill 修正，D-007 后零改动复用刻度轨）
状态：implemented
变更：2026-09-08-session-turn-nav
锚点：`frontend/src/components/daemon/session-panel/index.tsx`
最近确认：fd96ae48
理由：floating-session-host 不传 variant → index.tsx 默认 desktop，mobile ⋯ 菜单守卫在其不渲染；修正后的刻度轨仅 ~30px 宽，悬浮窗直接复用 desktop 形态无需折叠或特殊处理。

## D-001@v1 菜单在线管理采用「前端注册表不动 + 后端覆盖表」架构（方案 A）
状态：implemented
变更：2026-09-18-web-menu-management
锚点：未记录
最近确认：d2b380ae2
理由：选方案 A。菜单注册表（有哪些菜单/挂什么权限/分组结构）仍以 `frontend/src/lib/menu-permissions.ts` 为单一数据源；后端仅新增 `menu_overrides` 覆盖表（menu_key 主键 + label_override/sort_order/hidden），前端侧边栏与移动导航合并覆盖渲染。理由：与「菜单跟页面走」既有架构一致（新页面本需发版）、菜单-权限映射保留编译期类型检查（api-types.ts 已生成 Permission 联合类型）、行级审计清晰。否决 B：菜单与页面代码分离引入两处同步漂移风险、权限映射失去类型检查；否决 C：整包覆盖无行级审计、并发最后写赢。
故障面：覆盖端点/拉取故障时导航 fallback——mergeMenus 对拉取失败按空覆盖直通注册表，菜单管理页报错条幅；不影响登录与既有权限显隐
退役判据：若未来出现多客户端共享菜单目录的真实需求（后端全量菜单表），本覆盖表与前端合并层随该迁移一并废弃
