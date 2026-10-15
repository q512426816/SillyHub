# 决策知识 — frontend_lib

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 菜单在线管理采用「前端注册表不动 + 后端覆盖表」架构（方案 A）
状态：implemented
变更：2026-09-18-web-menu-management
锚点：未记录
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

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-07-provider-agent-kinds-followup
锚点：未记录
最近确认：fcefa0890fbce6927826cf9e1fff813f0ed642e9
理由：最大风险：FR-01 修复后 `agent_kinds` 键出现在所有编辑提交 body 里，既有表单/apiformat 测试若存在对 PATCH body 的全量精确匹配断言（toEqual）会因新增键挂掉——处置：跑定向测试，按新契约补断言键（补字段属契约演进，非改测试凑绿）。试过放弃：①schema 层禁 null（`agent_kinds: list[...]` 去掉 `| None`）——把契约上合法的显式 null 变成 422，第三方调用方行为被动变化，且与同 DTO 其它 nullable 字段风格不一致；②前端映射器发 `agent_kinds: v.agent_kinds ?? null`——引入 null 与缺省两种「不动」歧义表达，无收益。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-menu-permissions-page-audit
锚点：未记录
最近确认：efb2d687031517958ef5e09ff49c697137b6363f
理由：最大风险：可见性放宽面（workspace:read 持有者见组件菜单等）——评估可接受，这些用户对页面真实可用，且菜单可见≠数据可见（端点仍按鉴权矩阵）。次要：audit 卡保留零消费的 platform:audit:read 可能继续误导——保留理由是不删存量 key（存量角色已勾配置依赖它维持可见），其死目录属性在代码注释中言明。 试过但放弃的方案：① 移除各卡上零消费的既有 key（component:read / platform:audit:read / task:approve）——放弃：会让这些 key 在勾选器不可配（彻底死掉），且存量角色可见性可能缩；本变更聚焦补齐而非清理，死目录清理应走独立变更评审。② 后端把 component:read 接进列表端点鉴权——放弃：动后端鉴权影响存量角色（developer 只有 workspace:read+task:run_agent，会 403），远超本变更诉求。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-rbac-dead-permissions-cleanup
锚点：未记录
最近确认：765f4e7b684aa63c7d98653aa6b3e89af1057321
理由：最大风险：线上（crrcdt）存量角色持有死键的行被删——零功能影响（无端点消费），角色列表显示权限数变少属预期收敛；PPM 角色不涉任何删除键（PPM 18 键全保留）。次要风险：种子迁移编辑只影响新环境（已应用环境不重跑），存量靠清理迁移收敛，两路径已在 ppm-permission-simplify 先例验证。 试过但放弃的方案：① 给 code:* / tool:* 接消费端点（代码评审流 / 工具 RBAC 门控）——放弃：属新功能立项不是清理，且会话 canUseTool 审批已是现行机制；② 只隐藏不删（卡片摘掉、枚举保留）——放弃：枚举残留仍进 OpenAPI 契约与角色校验域，"配了没用"的混乱只是换个形态；③ 顺带删 PermissionGroup（后端零消费）——放弃：与权限键删除耦合扩散测试面，留待独立清理。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-sessions-menu-permissions
锚点：未记录
最近确认：086033da03918b7d38e93ce425e9e555073e43e6
理由：最大风险：可见性放宽面超预期（如某些仅持 runtime:admin 的运维角色会新增看到会话菜单）——评估为可接受，因为页面本就是这些权限的主消费面，且菜单可见≠数据可见（会话列表后端仍按 user_id 隔离、写操作仍按权限矩阵）。次要风险：runtime:admin 同时挂在 runtimes 菜单（config 组「守护进程运行时管理」）与 sessions 菜单（名不同：守护进程机器查看），勾选器两卡控制同一 key、计数联动——change:approve 双卡先例同形态，非新问题。 试过但放弃的方案：① 后端新增 agent_session:* 细分权限族（create/update/delete…）替代 task:run_agent——放弃：动鉴权矩阵影响全部 daemon 端点与既有角色，远超「菜单补齐」诉求；② 勾选器增加「未挂菜单权限」兜底桶——放弃：改组件语义面大，且把权限挂到正确的菜单卡片本身就是本来的建模意图。

## D-002@v1 实现架构=方案 A（注册表直读 + 指令通道复用）
状态：implemented
变更：2026-10-09-tombstone-conflict-root-fix
锚点：未记录
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

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-logout-localstorage-user-data-cleanup
锚点：未记录
最近确认：ccda8969cfb2db1ac3a0d30524b938011b5d04a3
理由：最大风险：前缀注册表漏掉未来新增的用户域键（枚举式固有的漏网风险——与上变更放弃方案 A 同型）。缓解：键清单集中一处且有本测试钉住存量 6 前缀，新增键时注册表是唯一需要动的地方；已知取舍是接受「未来键需自觉登记」而非引入命名空间强约束（改造全部读写点收益/成本倒挂）。放弃方案 B：统一用户域键命名空间前缀（如 `sillyhub:user.*`）——需改 6 个文件的全部读写点+旧键迁移清理，收益只是「前缀扫描永不漏」，且改键会导致现有用户草稿/未读状态丢失，不值；放弃方案 C：在 logout-storage 里顺带清 session persist 键——session store 的 clear() 已负责（persist 落盘空值），双份清理引入「谁是真的清空者」歧义，不碰。

## D-unmapped-013@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-15-assets-graph-narrow-typecheck
原编号：D-001@v1
锚点：未记录
最近确认：521896de37666e5ddf6af4a00875769d02917025
理由：最大风险：未来 TS 升级改变 `in` 收窄行为，使守卫显得冗余——守卫语义自包含（谓词显式声明判定结果），行为不随编译器版本漂移，可接受且可随时简化。已试并放弃的方案：① 探断链污点用标注洗净（`const dataA2: GraphQueryOut["data"] = dataA`）——探针实测仍 TS2339，推断链污点标注洗不掉；② 组件内 `as GraphNeighborsData` 断言——绕过判型丢类型安全，违反仓库禁手写类型精神；③ 把组件收窄重构成 page.tsx 同款参数化路径——扩大爆炸半径，page.tsx 现路径编译健康，不动。

## D-unmapped-007@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-15-fix-ci-red
原编号：D-001@v1
锚点：未记录
最近确认：cdaae4dcadefb5c2ff6896f34021ff4c0d9504c6
理由：最大风险：CI 的 daemon 测试/构建消费新类型暴露未知类型错——已本地跑 `pnpm -C sillyhub-daemon typecheck` 零错兜住。试过但放弃：无（未尝试其它方案，直接对齐是既定成功标准）。
