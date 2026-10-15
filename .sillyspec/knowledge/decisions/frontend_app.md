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
锚点：frontend/src/lib/menu-permissions.ts
最近确认：d2b380ae2
理由：选方案 A。菜单注册表（有哪些菜单/挂什么权限/分组结构）仍以 `frontend/src/lib/menu-permissions.ts` 为单一数据源；后端仅新增 `menu_overrides` 覆盖表（menu_key 主键 + label_override/sort_order/hidden），前端侧边栏与移动导航合并覆盖渲染。理由：与「菜单跟页面走」既有架构一致（新页面本需发版）、菜单-权限映射保留编译期类型检查（api-types.ts 已生成 Permission 联合类型）、行级审计清晰。否决 B：菜单与页面代码分离引入两处同步漂移风险、权限映射失去类型检查；否决 C：整包覆盖无行级审计、并发最后写赢。
故障面：覆盖端点/拉取故障时导航 fallback——mergeMenus 对拉取失败按空覆盖直通注册表，菜单管理页报错条幅；不影响登录与既有权限显隐
退役判据：若未来出现多客户端共享菜单目录的真实需求（后端全量菜单表），本覆盖表与前端合并层随该迁移一并废弃

## D-003@v1 实现方案选 C——CardMarkdown 薄壳渲染 + 卡片视觉重构
状态：implemented
变更：2026-09-23-md-card-render
锚点：未记录
最近确认：322c55edd
理由：用户看完三方案原型（prototype-card-render.html 三 tab 对比，演示数据为 conventions.md 真实内容）后选定方案 C——含 B 的全部渲染能力（CardMarkdown 薄壳：MarkdownText compact + 表格横向滚动 + 字号对齐）+ 卡片视觉重构（卡片头品牌色条与 brand-50 底、小节标题 brand-700、锚点复制图标、frontmatter 元信息条、表头品牌色卡片化）。
故障面：①视觉重构触及卡片 DOM 结构，现有锚点定位（data-entry-anchor + scrollIntoView）与条目级 🔥 徽标渲染需回归验证；②frontmatter 元信息条新增解析依赖——无 frontmatter 的文件须优雅降级（不显示元信息条，不炸卡片）；③双主题（blue/ai-native）下品牌色条与表头色需经 brand-* 语义阶取值，禁硬编码 hex（FRONTEND_PAGE_STYLE §0.5 铁律）。
退役判据：若后续知识库/扫描文档页整体改版（如换卡片布局系统），本视觉规范随页面基线一并重估。

## D-001@v1 对齐范围 = 变更中心列表页 + 详情页的功能补齐
状态：implemented
变更：2026-09-16-mobile-changes-parity
锚点：未记录
最近确认：d33092ea3
理由：变更中心在 PC 端由两个路由承载——列表页 `/workspaces/[id]/changes`（含 quicklog tab）与详情页 `/workspaces/[id]/changes/[cid]`；移动端对应 `/m/workspaces/[id]/changes` 与 `/m/workspaces/[id]/changes/[cid]`。对齐范围为这两对页面。

## D-002@v1 任务看板 / 任务执行页维持桌面引导，不在本次对齐
状态：implemented
变更：2026-09-16-mobile-changes-parity
锚点：未记录
最近确认：d33092ea3
理由：不移植。原变更 2026-08-26-mobile-workspace-page D-002 已明确将任务域裁剪出移动端核心版，移动详情页保留「任务区桌面引导条」；任务看板+执行页是独立大块功能（非列表/详情的信息呈现），用户指令针对「变更中心内容」，未点名任务域。
故障面：用户若预期任务看板也上手机端，本决策遗漏该预期——汇报中显式列为可否决项

## D-005@v1 实现方案 = 方案 A「既有组件复用挂载 + 移动壳适配」
状态：implemented
变更：2026-09-16-mobile-changes-parity
锚点：未记录
最近确认：d33092ea3
理由：选方案 A。三案对比：A=PC 既有卡组件（ChangeUsageCard/ChangeLastSignal/ScopeAuditCommandCard/ChangeActivityBadge）布局无 lg 依赖可直接挂载，数据层函数与 query key 全部复用，移动壳（筛选抽屉/⋯菜单/折叠卡）沿用本页既有范式；B=每卡重写移动版，违反移动端代码明文约束「数据层 100% 复用桌面（禁止复制第二份实现）」（每份移动页头部注释均载），制造双实现漂移面；C=废弃 /m/ 路由体系改响应式，推翻 2026-08-26-mobile-workspace-page 整个架构决策，牵连 m/layout 钻取路由、MobileWorkspaceHeader、底部 Tab 等全部移动基建。A 是仓库惯例的直接推论，非开放取舍。
故障面：若某桌面组件在小屏实测溢出（如 ScopeAuditCommandCard 明细表），需就地加移动断点而非重写——执行时验证
退役判据：若未来移动端整体转向响应式单套页面（方案 C 复活），本决策随之退役

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-clipboard-fallback
锚点：未记录
最近确认：5b6889fc8e9a74a581f8f2324c363aa8a0e07989
理由：- 风险：execCommand 已被 WHATWG 废弃，未来浏览器可能移除——届时降级路径失效回到报错横幅（与修复前同等），Async Clipboard 主路径不受影响；非安全上下文下无其它程序化通道（Service Worker 剪贴板方案依赖 HTTPS），移除前该方案是唯一解。 - 放弃方案 A：改部署形态强制 HTTPS/localhost——部署约束变更不归前端代码管，且局域网自签证书有额外运维成本；代码侧降级是即时空运的解。 - 放弃方案 B：navigator.clipboard 缺失时直接报「请在 HTTPS 下使用」引导文案——不解决功能不可用本身，execCommand 降级在目标浏览器（Chrome/Edge/Firefox 全支持）下即可用。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-change-owner-backfill
锚点：未记录
最近确认：9c5f38e39ca52feb5586d0c4728021f0c37eafbb
理由：最大风险：语义软化——兜底「工作区所有者」在多人协作工作区里未必是真责任人（agent 干的活记到创建工作区的人头上）。缓解：前端 title 明示「负责人未指派，默认工作区所有者」兜底语义；数据侧不改写存量，真实 owner（change_writer 路径）永远优先显示。若未来需要精确归属，可在会话立项联动时把会话用户写入（本次范围外，留作后续演进）。 试过但放弃的方案： - 「reparse 对存量空行也回填 workspace.created_by」——放弃理由：300 条历史行一次性改写、不可逆，且多数为 agent 产出，把「未知」写成「猜测」弱化数据可信度；展示层兜底达到同等可见效果。 - 「从 git log 提交者推断负责人」——放弃理由：agent 提交的 git author 不可靠（多为统一 agent 身份/机器账号），且 reparse 在平台侧执行需要额外仓库访问，成本高收益低。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-change-center-lineage-tag-and-filter
锚点：未记录
最近确认：56e0e5c338e5c327a8683802f90b38dc925ee9f4
理由：最大风险：`_resolve_thin_lineage_keys` 全 workspace 拉行 + outerjoin progress 肥 JSON，大 workspace 下列表请求变慢。评估：与现网 `pending_review_only` 聚焦路径同量级（后者已有 Redis read-through 缓存先例），v1 先现算不加缓存，超预期再按先例挂缓存，不阻塞本变更。死路①：把三分支直译 SQL（PG jsonb + SQLite json_each 跨方言 JSON 展开）——方言分裂、防御解析逻辑（畸形 steps 容忍）难复刻，放弃。死路②：changes 表物化 `is_thin` 列——出身是投影语义（依赖 progress JSON 与时间窗），同步成本高且易漂移（注释↔实现不一致是万恶之源），放弃。死路③：筛选沿用 `current_stage != 'thin'` 取反——漏归档兜底行、与行内标签口径分裂，放弃。
