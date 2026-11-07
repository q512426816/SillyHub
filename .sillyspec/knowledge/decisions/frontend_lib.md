# 决策知识 — frontend_lib

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 菜单在线管理采用「前端注册表不动 + 后端覆盖表」架构（方案 A）
状态：implemented
变更：2026-09-18-web-menu-management
锚点：frontend/src/lib/menu-permissions.ts
文件：docs/sillyspec/tests-redomain-from-prefix-doubling.md, frontend/src/app/m/account/page.test.tsx, frontend/src/app/m/account/page.tsx, frontend/src/components/__tests__/app-shell.test.tsx, frontend/src/components/app-shell.tsx, frontend/src/lib/__tests__/logout-storage.test.ts, frontend/src/lib/api.ts, frontend/src/lib/logout-storage.ts
最近确认：d2b380ae2
理由：选方案 A。菜单注册表（有哪些菜单/挂什么权限/分组结构）仍以 `frontend/src/lib/menu-permissions.ts` 为单一数据源；后端仅新增 `menu_overrides` 覆盖表（menu_key 主键 + label_override/sort_order/hidden），前端侧边栏与移动导航合并覆盖渲染。理由：与「菜单跟页面走」既有架构一致（新页面本需发版）、菜单-权限映射保留编译期类型检查（api-types.ts 已生成 Permission 联合类型）、行级审计清晰。否决 B：菜单与页面代码分离引入两处同步漂移风险、权限映射失去类型检查；否决 C：整包覆盖无行级审计、并发最后写赢。
故障面：覆盖端点/拉取故障时导航 fallback——mergeMenus 对拉取失败按空覆盖直通注册表，菜单管理页报错条幅；不影响登录与既有权限显隐
退役判据：若未来出现多客户端共享菜单目录的真实需求（后端全量菜单表），本覆盖表与前端合并层随该迁移一并废弃

## D-001@v1 游标修复方案——before_id 附加参数 + 块内复合过滤（方案 A）
状态：implemented
变更：2026-09-16-logs-cursor-tiebreaker
锚点：未记录
最近确认：b204034fb
理由：A。backend get_agent_session_logs 新增可选 before_id 查询参数，before_id 非空时过滤改 `(ts < before) OR (ts = before AND id < before_id)`，缺省保持现行 `ts <= before` 旧语义；ORDER BY（run 块序 anchor_ts→ts→id）零改动；openapi/gen:types 同步；前端游标升级 (ts,id) 二元组 + pageKey 追加 id 后缀 + loadEarlierOnce 进度判定二元组化
故障面：WHERE 裸 ts 过滤与 run 块序排序键不对齐是既有已接受局限（跨 run 时间交叠时 ts 游标可跳行）——顺序会话（一会话一活跃轮）不受影响，本变更不扩大该局限（复合过滤仅在块内收紧）
退役判据：若未来日志查询改为全局 (ts,id) 序的专用分页端点或换 cursor token 协议，before_id 参数随 before 一并退役

## D-002@v1 实现架构=方案 A（注册表直读 + 指令通道复用）
状态：implemented
变更：2026-10-09-tombstone-conflict-root-fix
锚点：未记录
文件：backend/app/modules/change/service.py, backend/app/modules/change/tests/test_delete_change.py, backend/app/modules/daemon/protocol.py, backend/app/modules/daemon/router/__init__.py, backend/app/modules/daemon/router/machines.py, backend/app/modules/daemon/tests/test_sillyspec_platform_commands.py, backend/app/modules/daemon/ws_hub.py, backend/openapi.json, frontend/src/components/changes/__tests__/platform-sync-section.test.tsx, frontend/src/components/changes/platform-sync-section.tsx, frontend/src/lib/api-types.ts, frontend/src/lib/daemon/machines.ts, frontend/src/lib/provider-caps.ts, sillyhub-daemon/src/api-types.ts, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/protocol.ts, sillyhub-daemon/src/sillyspec-manager.ts, sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts
最近确认：2f6d52515
理由：用户选方案 A（推荐）。②前端从 backend `spec_conflicts` 注册表直读 platform_deleted（`_upsert_sync_conflict` 已把 details_json.platform_deleted 落库，daemon 心跳链路零改动）；③平台删除变更入口复用 resolve/ghost_cleanup 指令通道新增 `tombstone_cleanup` action，回执走既有 `sillyspec_command_result`。拒 B（backend 注册表已有同样数据，心跳 model→openapi→api-types→前端四层透传属重复建设，且 daemon 不发版前端上不了）；拒 C（CLI 自动动用户目录违反 SpecPushConflict 人工拍板语义——spec-sync.ts:259 钉死注释；daemon 自动同步链路不经 CLI，覆盖不全）。
故障面：②依赖 daemon 上报的冲突与注册表行的时间差（心跳 15s + 采集 ≤75s，前端以注册表为准展示墓碑详情）；③旧 daemon 静默忽略指令（150s 超时回显恢复，与 resolve/ghost_cleanup 同款既有兜底）。
退役判据：若未来冲突展示统一收敛到单一数据源（注册表），②的直读即终态；若指令通道升级为推送制，③的轮询复用段随之迁移。

## D-001@v1 新建独立部署记录模块，不动现有发布审批流
状态：implemented
变更：2026-10-14-deploy-release-notes
锚点：未记录
最近确认：01c45807a
理由：用户裁决：新建独立模块。现有 release 审批流是人工单据流（bundle change_ids、approve、deploy、rollback），与「agent 部署后自动生成部署变化记录」是两个概念；并存不合并
故障面：侧边栏出现两个"发布"语义菜单（现有「发布」+ 新「部署记录」），需靠菜单命名区分（「发布记录」vs「发布」）
退役判据：若现有 release 审批流确认废弃下线，可将两域合并

## D-002@v1 顶层一级菜单，平台级聚合视图
状态：implemented
变更：2026-10-14-deploy-release-notes
锚点：未记录
最近确认：01c45807a
理由：用户裁决：顶层一级菜单（像「智能体会话」/agent-profiles 那样 absolute href、不进工作区），统一看所有部署记录
故障面：菜单注册表增删条目平移声明序索引，需同步重算 admin/menus 测试锚（共享断言面⑦，scripts/check-assertion-surfaces.py 门禁）
退役判据：若未来要求按工作区隔离查看，再评估降级为工作区菜单

## D-003@v1 基础版记录内容
状态：implemented
变更：2026-10-14-deploy-release-notes
锚点：未记录
最近确认：01c45807a
理由：用户裁决：基础版——部署时间、序号/版本标识、commit 范围（上次部署→本次，含提交列表）、agent 规整的变化总结（md 渲染展示）、部署结果（成功/失败）。不含部署日志摘要/健康检查/回滚按钮

## D-004@v1 方案D——agent 写 md 文件 + 平台读文件渲染（用户改提，取代 API 上报）
状态：implemented
变更：2026-10-14-deploy-release-notes
锚点：未记录
最近确认：01c45807a
理由：用户裁决原话「skill步骤 加 agent 写 md 文件不行吗？平台直接读md，每次发布生成一个新 md」：skill 末尾 agent 在仓库 docs/releases/ 写一个新 md（frontmatter 放元数据 + 正文放变化总结）；平台后端只读扫描该目录，解析 frontmatter + 渲染正文，不建表、不做写端点
故障面：① 依赖容器挂载能读到宿主仓库（平台与项目不在同一宿主机时读不到——当前本机部署场景成立）；② frontmatter 写坏（yaml 解析失败）需容错跳过或标记异常；③ 记录目录是约定，agent 忘写就缺记录（同方案A固有劣势）
退役判据：若出现多机部署/平台与项目分离部署，读不到文件，届时升级为 API 上报 + 落库
