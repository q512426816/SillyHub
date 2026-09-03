# ROADMAP — SillyHub / multi-agent-platform

> 多智能体协作管理平台。本文件是项目的"单一全貌"：做过什么、在做什么、待做什么。
> 维护规则：每次 `sillyspec-archive` 归档变更时同步更新「已完成里程碑」与「当前活跃」两节。
> 详细变更规格见 `.sillyspec/changes/`（活跃）与 `.sillyspec/changes/archive/`（历史）。

最近更新：2026-08-29

---

## 一、已完成里程碑（按时间，提炼自已归档变更）

### 2026-09-02 · 工作台活跃变更总览卡片（机器 sillyspec 进度三端链）

- **changes-overview-card**（2026-09-02，plan 四件套 + 8 task；实现 c0e6fce46、verify PASS 7/7 含 09-04 独立复验）：三端链——①backend：daemon_instances.sillyspec_status JSON 列（迁移 20260903090000）+ 心跳宽松 DTO（宁宽勿断不 422）None=清除置 NULL + register 恒清 + GET /machines 嵌套透出（MachineSillySpecStatusRead）；②daemon：SillySpecManager.collectStatusOnce 三态采集器（execFile 数组形参 spawn progress show --json、cwd=claim 观察的主仓根、能力缺失/瞬态失败/快照三态、changes N=50 截断 + 32KB 预算超限降级纯计数）+ 第五循环（interval 默认 60s 可关）+ 心跳第 6 参透传（sillyspec 缺席显式 undefined 占位防位置滑槽）；③前端：changes-overview-card 组件（健康条/变更行管线/ghost 折叠/冲突区/过滤/null 占位与数据过期标记）+ 工作台 SectionCard 挂载，类型走 gen:types。已知边界：compose 部署级浏览器端到端留部署后观察（integration-evidence 三段链已覆盖逻辑正确性）。补遗：ql-20260904-M4 采集器 bin 解析补 %APPDATA%
pm 候选（标准 Node.js 安装器布局，原仅覆盖 nvm-windows）。

### 2026-08-29 · 变更中心删除闭环、文档拉取与进行中可见性（task-15 收尾，待人工确认归档）

- **change-delete-closure-and-spec-pull**（2026-08-29，brainstorm→plan→execute 三轮审过门，revision 1 并入波 4；15 task/4 Wave + 跨仓 X1-X4）：四块能力——①**删除自动收敛+防复活**（波 1）：apply_ops 空目录清理（仅 ops 涉及目录，规避 Windows bind mount stat 断崖）/`spec_file_manifest.platform_deleted` 墓碑四通道拦截（add/rename 拒、delete 幂等放行、`_write_spec_root` 落盘前缀排除、`_ensure_change_row` 双层拒收 409 code=change_deleted）/scoped 定向删除（R-08 收窄修订：scope∩磁盘确认消失可删、scope 外零动作）/删除环与 `_apply_parsed` 对 deleted 行三点豁免（Grill B-1/B-2 加固）/progress 联动删/quicklog apply 期对账 hidden；②**删除入口**（波 2）：`DELETE /workspaces/{ws}/changes/{cid}`（CHANGE_ARCHIVE 或 owner，D-001）→ soft_delete_change_dir（30 天备份区+墓碑）→ location='deleted' 软删+change_events 审计（D-002），前端三页（末段输入防呆弹层/操作列/详情危险按钮/移动端 ActionSheet）；③**拉取口子**（波 3）：`GET /changes/-/spec-bundle`（shpsync、字面量路由前置）+X-Spec-Version 头+tar 顶层 PLATFORM-BUNDLE.json，前端「下载文档包」（blob 范式，快照语义文案），daemon 兼容实证零改；④**进行中可见性**（波 4，D-007 三层）：ChangeSummary.last_pushed_at 投影（零 migration）+活动徽标三态（ACTIVITY_STALE_MS=30min/ISO_LIKE_RE 防御解析，R-12 文案只陈述事实）+CLI X3 步骤开始/X4 任务边界补推（后端零改动）+心跳 Layer 3 Non-Goal。跨仓 sillyspec 仓 X1-X4 全落地（b86a593 墓碑+X3/X4、16c21b0 pull --spec、fb35dc0 --force 保留 local.yaml）。决策 D-001~D-007 沉淀 knowledge/decisions（backend 4/frontend 1/sillyhub-daemon 1/unmapped 1）。已知裁量/遗留：spec-sync HTTP 响应未透传 platform_deleted 诊断键（service 契约先行）、ChangeRead 无 last_pushed_at（详情页 steps 派生）、X3 渲染侧一行接线待后续变更、_compute_reparse_scope docstring 漂移待修（详见 scan/CONCERNS 与 docs/sillyspec 回执）。

### 2026-08-28 · 守护进程共享与平台共享智能体（grants 统一授权表）

- **daemon-agent-share**（2026-08-28，brainstorm→plan→execute→verify→E2E 全流程 + R-10 修复收口）：
  新建 `daemon_runtime_grants` 统一授权表（workspace|platform 两类 grantee，NULLS NOT DISTINCT
  唯一约束；存量 shared 数据自动迁移）。三块能力：①工作区共享补齐两缺口——共享机器在守护进程
  页面可见（shared_to_me 含引擎明细）+ 交互式会话钉定授权放行（owner-only 扩为授权判定，借用
  审计含 grant_id；修改类端点 owner-only 不变）；②平台共享智能体——管理员配置（档案+自己名下
  在线 runtime+源码工作区+writable_dir）共享给全体用户，会话服务端强制钉定/cwd 锚源码/禁 Bash
  七工具白名单/writable_dir 写边界（daemon 写守卫 overlay 交集收紧，D-011 唯一一处 daemon
  增量）；③前端守护进程页共享区块+管理卡+选择器三入口共享徽标+「平台共享」会话徽标（用户自选
  D-004@v2，回退链零改动）。E2E 双账号实测（admin/180024）三攻防全拦（外写拒/Bash 绕过拒/路径
  改写拒）；两处集成缺陷修复（DTO validator 拒纯档案形态；R-10=SDK allowedTools 预批准集绕过
  canUseTool——写工具从 SDK 层摘除改经守卫链）。13 task/13 决策全闭环，决策 D-001~D-013 沉淀
  knowledge/decisions。

### 2026-08-26 · OnlyOffice/LibreOffice 高保真预览管线上线与退役（休眠保留）

- **onlyoffice-preview**（2026-08-26→08-27）：Office 高保真预览全链路实现后经用户决策退役。实现：backend preview_office 模块（office-config 双模式 + 一次性文件令牌 HS256/redis jti 防重放）+ 前端 OnlyofficePreviewer（DocsAPI 动态加载免 npm 包、替换式挂载误降级根治）+ 复用 bsp-onlyoffice 容器（D-006，免下载免内存调优）+ DS 9 严格 JWT 三段签名三轮调试 + 方正内嵌字体子集解混淆（odttf 异或，字形修复 ql-20260826-010）。退役证据链：OnlyOffice 引擎不支持中文 docGrid 行网格（sdk-all.js 28MB 源码 linePitch/docGrid 零命中，公文目录漂移不可修）；字体度量补丁证伪（行高不读 hhea/OS/2）；LibreOffice 对照完美结构但正文页数 46v42 用户不接受——Excel 改下载引导（ql-20260826-013）、Word 回归本地渲染（ql-20260827-003）。终态：代码与降级链完整休眠（ONLYOFFICE_ENABLED/GOTENBERG_URL env 一行重启），backend 16/16 + frontend 70/70 测试绿。
### 2026-08-25 · 会话附件与文件统一在线预览

- **session-attachment-preview**（2026-08-25）：智能体会话发送的文件可点击在线预览——统一预览弹窗（antd Modal）+ 注册表分发架构（matchRenderer：blob.type > meta.mime > 扩展名），覆盖三入口（附件 chips / 文件消息卡片 / 文件中心），后端零渲染职责仅存取。渲染器演进终态：图片=antd Image、PDF=pdf.js 画布逐页渲染（iframe+原生查看器不可依赖，ql-20260827-001）、docx=docx-preview 动态 import、markdown=必经 MarkdownText 防 XSS、fallback=下载引导；Excel 按用户决策取消在线渲染（ql-20260826-013）。useObjectUrl 统一鉴权拉取/objectURL 生命周期托管（R-04）。期间 OnlyOffice/LibreOffice 高保真管线先后上线又退役（字体解混淆修复字形 / docGrid 行网格引擎不支持 / LO 页数偏差 46v42 用户不接受），决策链完整沉淀 quicklog ql-20260825-004~006、ql-20260826-002/010~013、ql-20260827-001~003。
### 2026-08-21 · 会话随时可继续（reopen 链路打通）

- **session-reopen-resume**（2026-08-21）：修「会话重新开启生产必 409 + 恢复后永久卡 reconnecting」三处断链，实现客户端式随时继续会话。①恢复钥匙落库：daemon 消息上报时把 SDK 会话 id 回填 `agent_sessions.agent_session_id`（最新值覆盖，fork 场景正确）+ 存量 Alembic 数据迁移（取最后一轮 run 值，provider/软删三重守卫）；②双端协议确认（方案 B）：daemon 恢复成功调 confirm-reconnected（可选 lease_id 陈旧确认防误翻第二次 reopen，runtimeId 从 SESSION_RESUME payload 参数透传修复 hub-client 静默吞 F1）/ 失败含 SessionAlreadyExistsError 立即 mark-recovery-failed；③双保险兜底：reconnecting 超 180s（last_active_at 基准，F2 修复 recover 路径误杀）手动可重开（旧 lease cancelled 旋转重发）+ 后端 60s 巡检协程自动收敛 failed——同时覆盖旧 daemon 不发确认的过渡期；④边界：cwd 空扫描会话中文 409 拒绝、前端恢复超 240s 出现重开入口 + 409 中文化、gen:types 同步。全链路证据：ASGI 端点级集成测试四步链（reopen→SESSION_RESUME payload 捕获→confirm(lease_id)→active）+ daemon 侧 7 用例拼合 + 真实启动验证（health 200、sweeper 协程拉起）。9 任务 4 Wave，backend 4752/frontend 1818/daemon 2474 全绿，设计/计划/执行三道独立审查（各揪出 F1/F2/同文件同 Wave 真阻断）。部署顺序：先 backend 后 daemon（deploy-notes.md）。已知边界：极老会话（从未上报 id）维持 409 属预期；真实 SDK transcript 加载待部署后人工冒烟一次。

### 2026-08-20 · 运行时状态读点修正（仓库优先，缓存回退）

- **runtime-readpoint-repo-first**（2026-08-20）：修「/workspaces/[id]/runtime 页恒显示空态」——2026-08-19-runtime-live-daemon-read 把数据源切到 daemon 实时读取但读点固定在 spec 快照缓存（`~/.sillyhub/daemon/specs/<wsId>/`），而 platform-managed 策略下 spec bundle 同步排除 `.runtime/` 整树，agent 驱动执行流的数据真源在成员本机仓库 `<root>/.sillyspec/.runtime/`，两者错位导致页面稳定空态。修正：backend 四个 runtime.* RPC params 加可选 `root_path`（当前用户 binding 行，经 `resolve_root_path_for_daemon` 容器→宿主改写，老 daemon 忽略新键零门控兼容）；daemon `pickRuntimeSpecDir` 三道校验读点选择（元字符黑名单（shell:true 命令串注入防线，Design Grill P1 补强）→ `assertWithinAllowedRoots` 复用 explorer 同款 realpath 防线 → `.runtime` 存在性），全过读 `<root>/.sillyspec`，任一不过记日志回退缓存（workspace_id 非法仍 forbidden fail-loud）；前端 user-inputs 超 50000 字符尾部截断+含文件路径提示、副标题「优先本机仓库，回退同步缓存」。端到端实测：b97f8231 工作区三端点 200 返回真实仓库数据（进度与 CLI dump 逐字一致/102.7 万字符输入记录/1589 个产物）。8 文件三端，backend 44+207/daemon 35+2463/frontend 12+1772 全绿，CLI 全量对账 1011s 通过。已知边界（首版接受）：平台触发 scan/gate 写缓存数据在仓库数据存在时不可见。沉淀工具缺陷记录 3 份（worktree deps install 白名单拒链式命令 / doctor 误删活跃孤儿分支 / verify-postcheck CRLF 解析致 modules 恒失效回退全量）。

### 2026-05 · 平台 bootstrap（14 个变更）

- 多智能体平台 v2 bootstrap + 平台原生 SillySpec 集成
- 核心抽象落地：Agent Adapter、Change Writer、Execution Coordinator、Tool Gateway、Workflow State Machine
- 基础设施：Agent Log Streaming、SSE 可靠流、本地执行循环、Server Sandbox Runner、知识生命周期
- 工作区即组件（component-as-workspace）、工作区 intake spec bootstrap

### 2026-06 上半月 · daemon 重写 + Agent 执行统一（约 15 个变更）

- **daemon 从 Python 重写为 Node.js**（`sillyhub-daemon/`，ESM/pnpm）—— 架构拐点
- daemon Codex 支持、daemon interactive session、unified-agent-execution、agent-runtime-selection
- session history 增强、PPM 数据/模块迁移 + 前端对齐

### 2026-06 下半月 · 用户 / 权限 / 组织 / 服务化（约 25 个变更）

- 用户管理 v2、workspace members、admin 全局 daemon/workspace 管理、admin users/org tree
- 菜单驱动权限（10 task）、daemon-api-key 端到端、本地 daemon、daemon-agent-detection 扩展 12 provider
- quick-chat 多轮、kanban/gantt UI、前端错误处理、interactive idle timeout 修复、concurrent-refresh-revoke
- **daemon-service-split**（DaemonService 3324 行拆 5 子包）、**daemon-network-resilience**（W1/W2/W3 网络韧性）
- daemon-client spec sync fix、username login、ppm 前端对齐、frontend-style-system

### 2026-07 · 平台化 + 类型迁移 + team 主 agent 编排（15 个变更）

- **decouple-scan-from-change-flow**：scan 从变更流程移除，5 段阶段定型（brainstorm/plan/execute/verify/archive）
- **changes-align-sillyspec**：变更中心对齐工具契约（删 propose/quick/human_gate 投影）
- **daemon-entity-binding**：工作区绑定从 runtime 改 daemon 实体（新建 daemon_instances 表）—— 数据层大重构
- **workspace-config-flow**：工作区配置流程重设计（per-member binding + 路径可编辑 + 文档双向缓存）
- **daemon-version-management**：daemon 版本可见 + 远程升级入口
- **daemon-client-change-binding-fix**：daemon-entity-binding 写回层 4 处遗漏修复
- **agent-log-type-tags**：AgentRunLog 加 tool_kind 列 + 前端工具筛选
- **frontend-openapi-types** + **fix-frontend-type-divergence**：手写类型 → OpenAPI 生成类型
- workspace-config-card、daemon-client-spec-sync-strategy、daemon-filesystem-policy（FilesystemPolicyEngine）
- spec-import-async-and-change-reparse、runtime-allowed-roots-config、scan-docs-tree-search
- **2026-07-12-team-main-agent-orchestration**（v2，接管 v1 `2026-06-19-multi-agent-orchestration`）：team 主 agent 真 agent 动态编排（daemon interactive lease + MCP tool 反向调 backend）+ worker 用户预设 + 三重收敛（worker 全终态/主 agent 自主/budget 硬截断 OR）+ GLM fallback + mode=single 零回归。daemon 内置 stdio MCP server 5 tool（P0 鉴权 apiKey X-API-Key）+ backend OrchestratorService/mcp_tools 5 endpoint + frontend TeamConfigPanel/team-progress。12 commit main（c41608be~79417e53 + P1 7369903b）。遗留：AC-9 e2e 真部署验证 + task-04b per-worker worktree 拆新变更

### 2026-08-19 · spec 镜像墓碑同步（全量同步对账收敛）

- **spec-mirror-tombstone-sync**（2026-08-19）：修「平台 spec 镜像只增不删」机制性缺口（生产实例：变更中心进行中 39 vs 真实 24，镜像 active 目录 41 vs 24；改名/归档/删除的变更目录在镜像永久残留）。四机制：①`_write_spec_root` 全量落盘后新增对账删除阶段 `_converge_stale_files`——以 merge 实际落盘集为基准（收集点在 `_load_member` 成功后，local.yaml 天然不入集），镜像独有文件软删 move 到 `spec-backups/{ws}/{收敛批ts}/`（与增量 apply_ops delete 同构）+ 自底向上清空目录 + 复用 30 天修剪；双护栏防坏包（空落盘集跳过 / 磁盘>2×max(落盘,200) 中止）。②`spec_file_manifest` 全表 DELETE 改逐行对齐：落盘文件 version+1/exists=True（无行插 v1），对账删除文件 exists=False 墓碑（保留乐观锁谱系，衔接 ql-20260819-004 复活语义）。③`_write_spec_root` 返回三元组 + SSE done 事件/sync_applied 日志加 converged_files/converged_dirs + spec_workspace.converged 结构化日志。④change 模块占位行保护加 7 天时效窗（`PLACEHOLDER_PROTECT_WINDOW_DAYS`，按 platform_change_progress.updated_at 过滤）——一次性上行后停滞的占位行不再永久滞留「进行中」（6 条测试残留行根因），CLI 恢复时 upsert 重建不丢数据。reparse 触达零新增（对账删在 reparse 前，既有删除环自然收敛）。测试：新建 test_full_sync_convergence.py 5 用例 + reparse_guard 2 时效用例 + 2 个旧保留语义断言更新为墓碑语义；两模块 468 passed，ruff 干净；无 OpenAPI 变化免 gen:types。

### 2026-08-18 · 工作区角色类型

- **workspace-role-type**：Workspace.type 收成 8 值受控词表（frontend-code/backend-code/fullstack/business-doc/submodule/deploy-ops/design-asset/other）+ role 自由文本 + 新增 description(Text) 列——「这个工作区是项目里的什么」落进工作区本体（D-001 不动 ppm_project_workspace 关联表，同一工作区跨项目同类型）。backend constants.py 单一事实源（WorkspaceTypeLiteral + YAML_TYPE_NORMALIZE_MAP 18 键）；Create.type 必填枚举（缺/非法 422）、Update omit=不改/null=清空、读不校验存量（NULL=未分类）；`GET /workspaces` 加 `?unclassified=true`（type IS NULL，与 ?type= 互斥同传 422）；migration 20260818150000 加列+存量 CASE 收编（幂等）；parser 组件目录展示层归一+description 透传进 ComponentRead（不落 Workspace 表，D-004）。前端 lib/workspace-types.ts 镜像词表（从 api-types 派生禁手抄，tsc 防漂移）：添加弹窗类型必选下拉+描述 textarea、列表徽标+词表筛选/未分类（删废弃 daemon-client 旧值）、详情页 type/role/description 编辑区（type 未变 omit 不发防存量 422）、PPM 关联弹窗双侧徽标+title 摘要、移动端最小收口（D-006）。36 文件，pytest 245+15 预存/vitest 1674/tsc 0/mypy 无新增。消费方：后续「跨工作区团队执行」按项目定位工作区的地基。

### 2026-08-19 · 跨工作区团队执行 + 项目维度会话

- **cross-workspace-team-mission**（2026-08-19）：team 模式 mission 从钉死单 workspace 扩展到跨工作区派发。AgentMission 新增 `project_id`（UUID FK nullable）/ `scope_workspace_ids`（JSON list）；AgentRun 新增 `target_workspace_id`（UUID FK nullable，NULL=单 ws 模式）。anchor+scope 设计：`POST /api/projects/{pid}/missions`（PPM 项目经理鉴权，scope⊆项目 422，anchor 默认 type=backend-code 优先）+ `GET` 列表端点。代表 binding（D-001@v2）：`resolve_representative_binding` owner 在线优先→任意在线→None；`placement.py` 新增 `representative_fallback` 旗标（target≠anchor 时开）。执行路由（D-002@v2）：`execution.py` 按 `target_workspace_id` 路由 worktree + 回写 run 列（NULL=单 ws 零回归）。MCP 双通道对齐（D-010@v1）：`agent/mcp_tools.py` 与 `mcp_gateway/tools.py` 同步 scope 放宽 + target 透传 + NULL 语义保持。收敛（D-003@v1）：`finalizer.py` merge/cleanup 按 `(target_workspace_id or anchor, worktree_branch)` 分组，A 组冲突不挡 B 组。前端：`projects/[id]/missions/page.tsx` 项目维度入口 + `mission-console.tsx` projectMode（scope 多选、anchor 单选、worker 目标工作区徽标列）。daemon：`mcp-server.ts` dispatch_worker schema 透传 target。16 task，backend 700+1 预存/vitest 1684/daemon 2422+tsc 0/mypy 0。
- **runtime-live-daemon-read**（2026-08-19）：运行时状态页从平台侧同步快照切换为直读绑定 daemon 实时数据。backend `RuntimeLiveService` 经 WS RPC 调 daemon 新增 `runtime.*` 四方法（read_progress/read_user_inputs/list_artifacts/read_artifact），MemberBindingResolver 用户门控（D-004），9 个 `Runtime*` 错误类全表映射 design §6.3（离线 502/断连 502/超时 504/forbidden 403/not_found 404/版本过旧 422/超限 413），旧容器直读快照路径整体删除（D-001 离线不回退快照，D-003 三类数据全实时）。daemon `runtime-handler.ts`：read_progress spawn `sillyspec progress dump --json`（D-002 daemon 不解析 SQLite），workspace_id UUID 白名单 + filename 预检 + containment + 1MB/30s 上限；spawn+shell 替代 execFile（Windows .cmd shim ENOENT）。跨仓 sillyspec 新增 `progress dump` 命令（snake_case + ISO 时间戳契约，acceptance 抓出 P0 camelCase 跨端断裂后修复 9a63466 + 守护断言防回归）。前端文案「守护进程运行态/经绑定守护进程实时读取」+ 错误分级提示。17 task，backend runtime 43/daemon 25/frontend 10/sillyspec 58 断言全绿；真实 HTTP 烟雾 6 场景（uvicorn+SQLite：401/404 未绑定中文引导/502 离线 details 齐全/路径穿越路由层 404/端到端 pydantic 契约）。遗留：daemon dist rebuild、sillyspec npm 发版（用户操作）。

### 2026-08 · AgentProfile 配置层

- **agent-profile-layer**（2026-08-02）：引入智能体档案配置层，作为现有 daemon→workspace 架构的**增强层非替代层**——不改 daemon-entity-binding、不动 WorkspaceMemberRuntime 绑定、不引入运行时实例。daemon → agent profile → workspace 三层：`agent_profiles` 表（visibility 三级 private/workspace/platform + provider/model/system_prompt/mcp_refs/skill_refs/allowed_roots_overlay/tool_policy_id 引用 + is_system_default）+ `AgentRun` 加 `agent_profile_id`/`agent_profile_snapshot` + `Workspace` 加 `default_agent_profile_id`。backend `AgentProfileService` 提供 CRUD/copy/三级 visibility 过滤/`resolve_profile` 软约束兜底（run→workspace.default→平台默认→None）/`compute_effective_allowed_roots`（daemon∩overlay，D-013 拒超集）。dispatch 三入口注入 profile 快照 + `target_provider=profile.provider ?? workspace.default_agent`（D-014 不反向选 daemon）；`get_execution_context` prepend profile.system_prompt 到 claudeMd（D-012@v2，渲染管线零改动）；`build_claim_payload` 透传 mcp_refs/skill_refs/effective_allowed_roots（camelCase+snake_case 双写）。daemon batch（task-runner）+ interactive（session-manager）双路径消费 profile：`frozenAllowedRoots`/`allowedRootsProvider` 用下推 effective 值，MCP/技能取子集；`mcp-config.ts` 加第三层过滤 + type 强制 stdio（D-017）。startup idempotent 补种两默认档案（D-015）。profile_id/snapshot 全 nullable，null 零新增查询（C-07 断言保护 PPM）。遗留：batch 路径 MCP 子集完整接线（task-09 gap）需新基础设施→独立 change。

### 2026-08-17 · CLI 直跑 spec 文件增量同步

- **spec-file-incremental-sync**（2026-08-17）：补齐 CLI 直跑（无 daemon）场景的 spec 文件树增量同步——此前 CLI 只推四件套文档，plan.md/tasks//module-impact.md 等永不上平台。platform_sync 新增 2 端点（`-` 占位段避贪婪匹配）：GET `/api/changes/-/spec-manifest`（SpecFileManifest 全表清单含软删行，读也收紧 require_platform_sync_write 仅 shpsync_，workspace 从 token 派生无归属 403 fail-closed）+ POST `/api/changes/-/spec-sync`（ops: list[FileOp] 单事务透调 spec_workspace apply_ops，base_version 乐观锁 conflict=true+server_versions 不 auto-merge）；spec_workspace +get_manifest() 只读方法。sillyspec 仓新模块 src/spec-sync.js（walkSpecTree/hashFiles/computeSpecOps/syncSpecTree：服务器清单为锚 walk/hash/diff，排除口径与 daemon 逐字一致，无差异短路，404/网络静默降级，conflict warn 不阻塞）+ sync() 成功路径接入（四件套直推之后）。跨仓 5 commit（sillyspec 主干 6647e176）+ main 3 commit；三套回归 182+1610+218 全绿；uvicorn 真实 E2E 四场景（首推 8 文件落盘/无差异短路/单文件增量 v2/内容无损）。遗留 P2：local.yaml 含 shpsync_ token 随树上行落服务器 landing（daemon 同口径非新暴露，待评估排除）。

### 2026-08-13 · 平台管理 spec 文件增量同步

- **platform-managed-file-sync**（2026-08-13）：spec 文件同步从「整树 tar 全量覆盖」改「文件级增量 diff + base_version 乐观锁 + 软删备份」——方向反转（R-01，daemon 本地权威回灌 → 服务器权威清单）。后端 spec_workspace 新增独立 `spec_file_manifest` 清单表（D-011 **不复用 scan_documents**，scan_docs reparse 不碰、职责分离）+ `apply_ops`（add/update/delete/rename + per-file base_version 乐观锁 conflict=true+server_versions、软删 move 出 spec_root 到 `spec_data_root/spec-backups/{ws}/{ts}/{path}` + exists=False+version+1、containment 校验对齐 tar 端点 + .runtime 拒、R-07 无行兜底 version=1、R-06 30 天机会式修剪）+ 端点 `POST /api/workspaces/{ws}/spec-workspace/sync-incremental`（conflict 时 **HTTP 200** body 带 server_versions，端点不额外抛 409）。旧 tar `_write_spec_root` 落盘后清 spec_file_manifest 行（Q7 旧 tar 失效清单）。daemon `postSpecSync` 由整树 tar 改增量 diff（本地清单缓存 `~/.sillyhub/daemon/manifests/{ws}.json` 移出 specDir 不被 pull 清、首同步/404 回退旧 tar、rename 同 hash 不重传、conflict 抛 SpecPushConflict 人工拍板）；hub-client `postSpecSyncIncremental`（JSON POST /api 前缀，QA 揪出 P0 URL 修复 + 回归锚点）。scan_docs 零改动。backend 65 测试 + daemon 79 测试 + 真实 daemon↔backend 集成证据（200 OK+落盘+清单行）。

### 2026-0
### 2026-0
### 2026-08-17 · 变更中心「快速修复」tab（quick 操作平台展示位）

- **change-center-quick-tab**（2026-08-17）：补齐 SillySpec quick 操作在平台的展示位。双链路：① CLI 端 `quicklog.js` allocate/complete 后 best-effort POST `POST /api/quicklog-entries`（shpsync_ 鉴权、workspace 从 token 派生、5s 超时、无配置静默跳过）；② 平台端解析 `spec_root/quicklog/` 文件 fallback。新增 `quicklog_entries` 表（UNIQUE(workspace_id, ql_id) 幂等 upsert），新增 `backend/change/quicklog_parser.py`（CRLF/全半角冒号/4 状态形态/多状态行取最后/5 分隔符/bullet 括注/白名单/mtime 缓存）与 `quicklog_service.py`（双源合并 PG 优先、stale 24h 派生、author enrich、模块推导、全文搜索），变更中心第三 tab「快速修复」（筛选/轮询/空态）、抽屉详情（四段正文/原始 md 切换）、详情页反向「关联的快速任务」区块。跨仓 sillyspec CLI 六项推送测试。verify PASS WITH NOTES（3 条观察项：历史 ql_id 撞号/GBK 乱码头行/实机冒烟留部署）。

### 2026-08-15 · init lease 触发 sillyspec init

- **init-trigger-sillyspec-init**（2026-08-15）：工作区初始化真正执行 `sillyspec init`——daemon `handleInitLease` 编排 5→6 步（pullSpecBundle 后、postSpecSync 前插 `runSillyspecInit` 硬失败 abort，D-002@v2：pull 整删重建故 init 必须后置），spawn `sillyspec init --dir <rootPath> --spec-dir <缓存> --workspace-id --no-skills --tool <多工具>`（shell:true + 60s 超时杀树 + spawnFn 依赖注入），成员本地获得 .sillyspec-platform.json 平台指针（status active）+ CLAUDE.md/AGENTS.md 指令注入 + spec 骨架。spawn 前 3s 版本门控 `MIN_SILLYSPEC_VERSION_FOR_INIT=3.26.8`（查询/解析失败 fail-safe，错误带中文升级指引，不依赖 daemon 重启）；tools 来自 cli.ts 构造前 AgentDetector 探测映射 VALID_TOOLS（兜底 claude）。配套双侧防冲突：backend `apply_ops` 冲突分支同 hash no-op 豁免（op.hash==row.content_hash → 不 conflict + new_versions 回服务器版本，D-008@v2 治第二成员骨架 add 必冲突）；daemon `UPLOAD_EXCLUDE_TOP_BASE` 三处统一排除 projects/（防成员机器绝对路径上传 + 缓存残留 delete op 误删）。跨仓 sillyspec CLI 三项（--no-skills / --tool 逗号重复多值 / 平台模式跳过项目内清理保 local.yaml 手调段）。verify PASS 含三场景真实集成证据（首成员产物/重复 init 手调保留/第二成员零冲突）+ 门控负路径；本机 npm link 3.26.8 验证（正式发版待用户，MIN 语义为下界）。契约零变更（lease metadata/claim payload/FileOp schema）。

### 2026-08-15 · perf-remediation 性能审查高危修复

- **perf-remediation**（2026-08-15）：六代理性能审查 10 项修复全流程归档（worktree b85c02f3，31 文件 +2368/-326，约 40 新测试）。核心：reparse/spec 写入链路 to_thread 事件循环解放（Wave C 范式推广）；_BatchProgressWriter 50 文件/500ms 批量回写（终态准确+COALESCE 修 NULL 不落地）+ apply_ops IN 预取（dict 镜像保同请求语义）；scan_docs 无 q 时 load_only 排除 content；api_key 认证 key_prefix 索引过滤（O(n) bcrypt→O(1)）；scandir 单遍+每文件 1 stat+_safe_mtime 推广；_load_module_map (path,mtime) 复合键缓存+platform_managed 路径修复；agent GET logs after 游标（> 取增量）+ mission console 增量合并；daemon _pollLoop lease 分支 90s 窗门控（change-write 无 WS 推送不门控）+ 落盘日志 7 天清理。流程坑：after 游标方向在 design Grill 修订时写反（<=），plan 独立审查抓出；daemon B2 测试竞态为预存缺陷（baseline 也红）顺修。遗留 P3：mission console 空 fallback 无闩锁、Windows 排序大小写差异。
8-14 · security-audit-remediation 多代理安全审查高危修复

- **security-audit-remediation**（2026-08-14~15）：6 并行审查代理（认证/注入/密钥/DB/FS/前端 daemon）确认 5 高危 + 7 中危 + XSS + 部署弱口令，全流程修复归档（commit c0af692c，77 文件 +6035/-441，100 新测试）。高危闭合：daemon WS 升级期鉴权（X-API-Key/Bearer 4001/4003，daemon 客户端同窗传 header）；claim/pending-leases/heartbeat 归属校验（三锚点链 + compare_digest）；LiteLLM master key 不出 backend 进程（llm-proxy 透传端点 v1 路径白名单 + usr-uid-pid 归属断言，context.py 两处改 proxy 标记）；file 五端点 IDOR（uploaded_by/WORKSPACE_READ/admin 可见域）；platform_sync JWT/shk_live_ 写端点 403（仅 shpsync_）+ 读并集聚合；sync_documents relative_to + filename 白名单；quick-chat lease metadata.actor_user_id 归属链（D-005@v2）；query token 回退删除 + 前端 5 处 fetch-SSE/header 转传；markdown rehype-sanitize；compose 弱口令 :?must set + 端口绑 127.0.0.1。QA review 追加修复：llm-proxy admin API 白名单（H-1）、HUB_PROXY_BASE_URL 部署接线、无锚点存量 lease 404。verify 含真实运行时证据（容器热更 + restart，WS 401/llm-proxy 401/admin 404 实测）。遗留 P2：sanitize svg 注释对齐、litellm-db 密码、8000/3000 端口面（独立 change）；性能类发现另立 change 待立项。
8-14 · profile.system_prompt 注入 + stageProfileId 持久化

- **profile-system-prompt-injection**（2026-08-14）：补全智能体档案绑定最后一块——profile.system_prompt 经 SDK `systemPrompt={preset:claude_code, append}` 注入 agent（废弃 D-012@v2 claudeMd prepend，保留 claude 默认能力 + 追加档案提示词）；stageProfileId 每阶段独立持久化到 `change.stages[<stage>].profile_id` + 新 PATCH `/changes/{id}/stage-profile`。链路：backend `_apply_profile_to_lease` 写 lease.metadata.system_prompt → `_PROFILE_PAYLOAD_FIELDS` 加字段双写 claim payload → daemon interactive SessionManager.create 透传 → `_buildDriverOptions` 设 preset+append → claude-sdk-driver 逐字段写 SDK options（D-005 非 claude 编译期隔离）；前端 stageProfileId useEffect 从 stages 恢复 + onChange PATCH。倒推 B 模式（代码先行）7 commit main（e258b5f1~68974864 + edde56fc 半接线修复）。无 DB 迁移（stages JSON 列）。遗留：batch/--print 路径未覆盖（非目标）；resume 重连 e2e 待观察。
- **session-stream-ux**（2026-08-19）：智能体会话流结构化重构（参考 deepseek-harness 设计，方案 C 共享装配器）——纯前端 17 文件 +7438/-548，后端零改动（子代理归属数据链路本就完整，Grill X-04 核实）。核心：`session-log-assembler.ts` 纯函数装配器收敛两处 applyLogToTurn 副本（分段装配/parent_tool_use_id 归属路由嵌套/override 跨段撤回/双路去重/归属桶配对，sanitize.ts 改 re-export 垫片）；`turn-segment-views.tsx` 五类段渲染组件（工具单行卡+运行扫动动画/思考折叠流式跟随/子代理嵌套递归块/流式光标，段级 memo + path-copy 引用稳定）；`turn-status-bar.tsx` 轮级状态条（计时锚点三源 live 占位/attach run.started_at/首条 log + 前 15s 不显秒 + 局部 tick 不外溢）；`subagent-catalog.tsx` 头部子代理目录（运行脉冲+时长补秒+受控跳转）；TurnTimeline v2 双路径（segments 段渲染+旧渲染回退）；两消费方（/sessions 页 + runtimes 弹窗）接线。测试 1761 全绿（新增 79 用例）。设计期 Grill 抓 3 个 P1 事实错误（turn_started 事件不存在/tool_result 无 id 可配/接口缺兜底变体）；QA 验收真实数据端到端（DB 577 行归属日志 → 装配器嵌套正确）。遗留 P3：弹窗 attach 计时锚点落第三源、目录跳转待补 data-segment-id 锚点（同名子代理命中首个）。
- **sessions-workspace-selector**（2026-08-19）：/sessions 新建会话支持选择工作区挂项目上下文——frontend+backend 双模块（ca99b100 一提交 +1020/-2，6 任务全过）。核心：`WorkspaceSessionPicker` 自治受控组件（listWorkspaces + fetchMyBindings 取数，首项「不使用工作区」，选中按工作区绑定的 daemon_id 联动带出在线机器，空列表禁用提示 + 失败重试）；`NewSessionForm` 四选择器→五选择器（⓪工作区置顶，提交体带 workspace_id，选中显示项目目录运行提示条）；后端 `create_session` 补归属校验（workspace_id 非空先经 `allowed_workspace_ids(WORKSPACE_READ)` 校验，不可见抛 404 `HTTP_404_DAEMON_SESSION_WORKSPACE_NOT_FOUND`，校验在事务外失败不落库）。复用既有 workspace 端点无新 API；daemon 执行链路 workspace_id 消费逻辑本就有（零改动）。同期配套 quick：会话列表/面板头部工作区信息显示（ql-20260819-001-b742）、/sessions 移除「结束会话」按钮（ql-20260819-002）。

---

## 二、当前活跃变更（5 个）

| 变更 | 状态 | 下一步 |
|---|---|---|
| `2026-06-28-daemon-subagent-transcript` | W1 完成（task-01/02，commit b9dee2e0） | task-03 partial 分桶（R-02 P0）+ 后续 W2/W3 |
| `2026-06-19-multi-agent-orchestration`（v1） | 核心闭环 merge（d16e13c7），Wave0 + 通用兜底已落地 | **被 v2 接管并归档**（team-main-agent-orchestration 已 archive 2026-07-12，v1 Wave3-5 由 v2 实现） |
| `2026-06-04-fix-agent-driven-change-center-flow` | complete_stage 闭环修复（部分） | 补 verify-result 后归档 |
| `frontend-api-fix` | progress 卡在 worktree（macOS 路径残留 `/Users/qinyi/SillyHub/`） | 评估是否已被后续变更覆盖；续作或归档 |
| `qa-fix-round1` | progress 卡在 worktree（macOS 路径残留） | 同上，评估后续作或归档 |

---

## 三、短期计划 / 下一步重点

1. **daemon-subagent-transcript 推进**：完成 partial 分桶 + 三端 transcript 沉淀
2. **multi-agent-orchestration delegate_task spike**：运行时验证 delegate 链路
3. **frontend-api-fix / qa-fix-round1 处置**：核实是否已被后续变更覆盖，决定续作或归档
4. **第 3 批文档救火**（本次审查识别，待单独走变更）：
   - 重跑 scan 再生 5 套过期 scan 文档（source_commit `ba87eec` → HEAD `2d00d069`，跨过 daemon-entity-binding 重构）
   - 恢复 sillyspec.db 进度跟踪或显式接受"以目录为准"

---

## 四、已知技术债 / 风险

| 债务 | 严重度 | 说明 |
|---|---|---|
| scan 文档全量结构性过期 | 🔴 P0 | 5 套 scan 都停在 ba87eec，影响归档/影响分析/模块边界判断 |
| sillyspec.db changes 表为空 | 🔴 P0 | 进度跟踪系统失效（2026-07-03 重建 db 后未关联既有目录），`status/continue/resume` 失灵 |
| SillyHub/multi-agent-platform 双视图文档重复 | 🟠 P1 | `projects/*.yaml` 定义了两个 project 都指向同一仓库，scan 各生一套 docs，modules/flows/glossary 三套重叠 |
| 待部署验证的 migration | 🟠 P1 | daemon-entity-binding 等变更的 PG migration 待 apply + 端到端部署验证 |
| test_member_runtimes 等测试债 | 🟡 P2 | daemon-entity-binding / agent-log-type-tags 变更遗留的少量测试债 |
| `docs/sillyspec/finished/` 21 份工具 bug | 🟡 P2 | 性质属 sillyspec 上游 issue backlog，错配在本仓库 docs/ 下 |

---

## 五、关键架构决策（累计）

- **5 段变更流程**：brainstorm → plan → execute → verify → archive（scan/propose/quick 已移除）。状态机定义：`backend/app/modules/change/model.py` `StageEnum`
- **三服务架构**：frontend（Next.js）+ backend（FastAPI）+ sillyhub-daemon（Node.js 本地守护进程）。部署：`deploy/docker-compose.yml`
- **工作区绑定 = daemon 实体**（非 runtime）：`daemon_instances` 表，per-daemon WS + dispatch daemon_id。runtime 退化为 daemon 的从属
- **provider 抽象**：Claude / Codex 经 `adapters/` 多协议 + interactive driver 抽象，新增 provider 加 driver 不触碰控制面
- **数据层**：PostgreSQL + Redis（Pub/Sub），AgentRun + DaemonTaskLease 编排
- **类型生成**：前端手写类型 → OpenAPI 生成类型（`api-types.ts`），react-query + zustand 并存
- **workspace-subpages-style-unify**（2026-08-20）：工作区 8 子页面样式统一（组件/变更/会话/文件/Skills/MCP/MCP 令牌/成员）——ErrorBanner 公共组件收敛 9 处手写红条（role=alert 保留）、返回链接规范化入 PageHeader actions（目标统一详情页）、4 处空态换 EmptyState、5 处语义色 token 化（双主题跟随）、members/mcp-tokens 表头规格统一、members 中文化、session 右侧容器 SectionCard 化、explorer 高度锚 56→64px。批量模式 4 Wave/6 任务，1793 用例全绿，grep 三清零；D-304 立 FRONTEND_PAGE_STYLE 适用范围（工作台式页面按 §0.5+概览页基线，旧 antd 全量条款限 PPM 类页面）。范围外残留（audit/approvals 等 7 子页 15 处旧红条/tone）留档后续变更。
- **workspace-nav-consolidate**（2026-08-20）：工作区导航整合——概览快速入口宫格退役（与顶部菜单重复，D-401）；WorkspaceTabs 扩至 13 项（+扫描文档/运行时/智能体档案/方案文件）flex-nowrap 左右滑动+滚动条隐藏+overview 双高亮修复（D-402）；layout standalone 由双前缀剥离收窄为仅 components/topology 整屏页（ql-20260707-004 宽度理由与现码不符废止，components/changes/[cid] 全部恢复顶部菜单，D-403）。light 3 任务，1792 用例两轮全绿；follow-up：components 页次级 NAV_ITEMS 与新菜单重复（P2-3 留档）。
- **table-column-resize**（2026-08-21）：表格列宽统一可拖拽——DataTable 共享层 useResizableColumns（antd 官方 header.cell 真手柄路线：onHeaderCell 无法渲染子元素/triggerSorter 先执行两坑由 Grill 源码级审查拦截）；number width 列挂 7px 命中区手柄（col 光标/主题高亮/拖中禁选中/3px 阈值防误触排序/min 60px）；PpmResourceTable 无 width 业务列按类型穷举 Record 兜底默认宽（PPM 资源表业务列全可拖）；onColumnsResize(dataIndex 键) 回调留持久化接口。5 新用例（真实 DataTable 全链路含排序不误触前置校验）+全量 1815 两轮绿。遗留：16 页直用 antd Table 未获能力（收敛另立）。
- **mission-converge-patrol**（2026-08-21）：mission 收敛巡检——main.py lifespan 常驻协程（MissionPatrolService，60s 可配可关停）三职责：schedule_loop 收敛兜底（修项目维度 mission change_id=None 回调短路致主 agent 不收敛时永久 running）/ redispatch 离线重派（补运行中 daemon 恢复场景）/ 两阶段僵尸可复活（daemon 持续离线 60min 判死不收敛 + 30min 复活窗口内回线自动重派续会话 + 窗口耗尽正常收敛；schedule_loop 信号 1 豁免、信号 3 不豁免）。schema 零变更（constraints JSON 标记）。59 巡检用例 + agent/daemon 全量 1443 passed，verify PASS WITH NOTES。
- **session-message-queue**（2026-08-21）：会话消息排队 + 面板组件统一——useMessageQueue（等 active 投递/上限5/失败留队头仅用户重试/附件 ids 排队，D-001~D-004）+ MessageQueueBar 三态 chip；sessions 页与 /runtimes 弹窗输入框仅终态/离线禁用，running/reconnecting 可输入排队，turn_completed/恢复 active 自动投递（真实 E2E 实证 inject 201）。组件统一（D-005）：页内面板提取共享 SessionPanel（mode page|dialog 双模式，react-query 全收 page 子组件防弹窗测试炸），interactive-session-panel 降级 127 行适配层（导出面零变更，4 消费方零改动；design「删除」因范围外消费方存在降级，迁移 workspace/change 会话区后可彻底删）。page.tsx 1473→117 行。11 task 全过 + 1866 用例绿 + verify PASS。
- **agent-file-upload-mcp**（2026-08-23）：agent 文件上传 MCP——daemon mcp-server.ts 双 toolset（MCP_TOOLSET 缺省 orchestration 零变化 / file 模式=sillyhub-file 仅 upload_file+list_uploaded_files，fail-closed 路径校验）；两条注入链（会话=provider 双 server 表 + per-server env；worker 仅 claude=tmpdir 0600 临时 .mcp.json 同步写+run 终删+进程级单次清扫，凭证 per-server env——spike-01 证 spawnEnv 自定义变量不透传）；backend POST/GET /api/agent/file-artifacts（日志行 tool_kind=FileUpload 定位承载 + Redis 双通道 publish 实时扇出 + 重放防护）；File 加 description 列（复用文件中心 MinIO，权限=能访问会话/run 所属 workspace 即可下载，D-004@v2 解析链）；前端聊天流文件卡片段（图片缩略图）+ run 详情产出文件区。10 任务/6 Wave，三轮 Design Grill+两轮 plan 审查+验收双 pass；合并后全量 backend 5074/frontend 1958/daemon 2585 绿；真实 e2e 实证（MCP 进程上传→PG/MinIO 落库→逃逸拒绝）。
- **sessions-live-updates**（2026-08-24）：会话列表 SSE 变更信号+轮询兜底——Redis 新全局频道 agent_sessions:changed 承载 created/status_changed/deleted 三类轻量信号（16 写入点埋点=design §3 生命周期契约表），后端新增 session_events.py 发布辅助（静默容错）+ GET /api/daemon/sessions/events SSE 端点（user_id 过滤+30s keepalive+连接池零占用），前端 fetchSse 订阅 subscribeAgentSessionsEvents（退避重连）+ sessions-portal useEffect 接线 invalidate [agentSessions] 前缀（断线重连补失效）；10s/30s 轮询保留兜底（D-007）。7 任务/4 Wave 全过；verify 抓出并修复 SSE 端点路由遮蔽真实缺陷（commit 0c7860f7，5186 单测全绿未拦——直调函数绕过路由表+401 探针测不出遮蔽），补路由表级回归；真环境端到端实证（真 uvicorn+真 Redis+真 JWT，D-005 用户隔离+负载零漂移）。
- **daemon-platform-resilience**（2026-08-29）：daemon↔平台四场景断线恢复——控制指令可靠投递（daemon_control_commands 表落库待发→WS 推送 delivered→重连补拉仅 pending→ACK，D-006 零重复）接入 11 下发点+心跳 pending_controls 计数+GC 双过期路径联动 run failed；backend 收敛接线（lease_expiry_sweeper 60s 常驻 GC 接线既有无调用方函数+lifespan 在线 daemon pending lease 重唤醒+WS 断开 10s 延迟降级执行时复查取消+placement 三处候选实连接过滤剔除假在线）；会话挂起语义（AgentSession+suspended 非终态：优雅停止 suspend-batch 三步幂等/offline sweep active→suspended 而 pending 维持 failed/24h 超龄 GC/recover 非白名单三态）；daemon 侧（WS 退避 [1,2,4,8,16,30]s+jitter+消息重置/register 周期重试+401/403 接管/control-dispatcher 统一消费 LRU 去重/四步统一对账/outbox kind 扩展终态+claimToken 空窗入箱重放/恢复网络失败保留重试+合并落盘）；前端（onStatusChange 连接横幅/90s 看门狗对账不伪造终态/run 流预算重置/审批面板退避重连/suspended 四入口展示）；权限 HTTP 上行（常量时间比对，断线不再 fail-closed deny）。11 task/7 Wave 全双 pass；新增 109 用例+四场景集成 10（backend 6+daemon 4）；真机端到端实证（真 uvicorn 双新协程启动日志+真 daemon hub-client×真 backend×真 postgres 心跳计数→补拉→ack→归零）。
- **session-queue-ux**（2026-08-31）：会话排队体验修复与增强——三根因修复（队头失败滞留→dispatch 循环化连续失败≥2 停+confirm_session_reconnected 恢复补派发；非终态非 active 批量转 failed→保持 pending 仅终态收敛；queue_changed SSE 前端未订阅→envelope case+双模式接线 5s 轮询兜底）+ 三功能（position 列迁移三步走+reorder 全量 422+队列条原生 DnD 拖拽；dispatch-now 置队首+interrupt 接力/空闲直发 D-001 打断语义 pending/failed 均可用兼滞留手动兜底；edit 端点 failed 转 pending 自动尝试派发+TASK_WAKEUP 条目 409/前端隐藏 ✎）+ 消息复制（CopyButton 三挂载用户气泡剥离附件标记/Text/Thinking 展开，hover 浮出+1.2s 反馈+降级）。执行期测试揪出三缺陷（MAX+1 falsy-zero；reorder/dispatch-now rollback 过期 ORM 属性 MissingGreenlet 500）修复并真实运行时复验（5 HTTP 探针 401/200/422/404/409+迁移实跑回填）；13 task/9 Wave；backend 27 新用例+frontend 27 新用例；daemon 零改动零新依赖；verify PASS。
- **daemon-selfupdate-safety**（2026-08-29）：SELF_UPDATE 安全层四件套（源自 multica self_reload 调研）——①空闲屏障：忙判定=仅进行中（hasRunningTurn running 态+hasActiveLease _controllers，D-001 空闲会话经挂起/恢复链路无损穿越）+忙则推迟 30s 复查无限等（不做 drain-hook 状态机，multica 反面教训）+server_command 链 stop 前终检（下载窗口竞态收敛毫秒级）；②更新所有权 CAS：忙推迟即释放可再入/交接排定持有到退出/失败路径全释放（保留拉起失败保活+补释放语义）；③磁盘旁路探测：读 bundle 正则提取 BUILD_ID 比对（--version 输出 semver 不同源 Grill 实跑证伪）默认 600s 可配 0 关/差异含降级走直启路径（不下载不查 manifest，操作者换文件即意图）/探测失败≠变化防替换窗口自杀；④pending 三端透传：daemon pending-update.json+status 展示+心跳可选字段→backend upsert（同内容保留 since/无字段清除 NULL 与兄弟字段反向）→前端机器卡三状态横幅+升级按钮禁用。8 task/7 Wave 双 pass；81 新用例+四路径集成回归（忙推迟全链/终检回推迟/磁盘直启零下载/可见性闭环）；真机实证（uvicorn 启动+真实心跳三态×postgres since 保留/清除）。Grill 三阻断修正（探测基准/直启路径/终检）。
- **batch-session-inherit**（2026-08-29）：worker 会话中断重派继承（Grill P0 证伪原 batch lease 方向后 D-005 重定位）——①分流挂起：suspend+offline sweep 按 parent_session_id（worker 子会话 failed+AgentRun.error_code=daemon_interrupted+SuspendBatchResult.workers 种子/主会话 suspended 逐字不变回归锁定；pending 档不分流显式边界）。②自动重派（worker_redispatch.py 新文件）：prepare_interactive_dispatch 复用原子会话（不走 dispatch_to_daemon 防 worker 脱 mission 树）+双表上下文（AgentSession+首 AgentRun）+prompt 按 objective 重渲染 build_worker_briefing+resume_session_id=agent_session_id（NULL 回退 run.session_id）注入+原 runtime 钉定（worktree 机器局部不可换机）+三互斥守卫（mission 终态/patrol④排除/30min 宽限窗）+节流（interactive lease 行数>=3）+suspend/sweep 事务后异步 fire。③claim interactive 分支 resume_session_id 白名单补透传。④daemon：CreateSessionInput.resume+spec.resume→driverOpts 透传（既有链激活）+SDK 损伤自动降级 fresh（RESUME_DAMAGE_PATTERNS+清 pendingFirstPrompt timer 防双提交）+resume_downgraded 披露。6 task/5 Wave；backend 22+28+8+49+1194+daemon 3+10+4=67 新用例全链绿；session-manager.ts 手动合并并行 plan-approval 改动。四用例全量跑红经复核=测试隔离非真实失败（单独跑全过）。

