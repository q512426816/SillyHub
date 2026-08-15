# ROADMAP — SillyHub / multi-agent-platform

> 多智能体协作管理平台。本文件是项目的"单一全貌"：做过什么、在做什么、待做什么。
> 维护规则：每次 `sillyspec-archive` 归档变更时同步更新「已完成里程碑」与「当前活跃」两节。
> 详细变更规格见 `.sillyspec/changes/`（活跃）与 `.sillyspec/changes/archive/`（历史）。

最近更新：2026-08-15

---

## 一、已完成里程碑（按时间，提炼自已归档变更）

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

### 2026-08 · AgentProfile 配置层

- **agent-profile-layer**（2026-08-02）：引入智能体档案配置层，作为现有 daemon→workspace 架构的**增强层非替代层**——不改 daemon-entity-binding、不动 WorkspaceMemberRuntime 绑定、不引入运行时实例。daemon → agent profile → workspace 三层：`agent_profiles` 表（visibility 三级 private/workspace/platform + provider/model/system_prompt/mcp_refs/skill_refs/allowed_roots_overlay/tool_policy_id 引用 + is_system_default）+ `AgentRun` 加 `agent_profile_id`/`agent_profile_snapshot` + `Workspace` 加 `default_agent_profile_id`。backend `AgentProfileService` 提供 CRUD/copy/三级 visibility 过滤/`resolve_profile` 软约束兜底（run→workspace.default→平台默认→None）/`compute_effective_allowed_roots`（daemon∩overlay，D-013 拒超集）。dispatch 三入口注入 profile 快照 + `target_provider=profile.provider ?? workspace.default_agent`（D-014 不反向选 daemon）；`get_execution_context` prepend profile.system_prompt 到 claudeMd（D-012@v2，渲染管线零改动）；`build_claim_payload` 透传 mcp_refs/skill_refs/effective_allowed_roots（camelCase+snake_case 双写）。daemon batch（task-runner）+ interactive（session-manager）双路径消费 profile：`frozenAllowedRoots`/`allowedRootsProvider` 用下推 effective 值，MCP/技能取子集；`mcp-config.ts` 加第三层过滤 + type 强制 stdio（D-017）。startup idempotent 补种两默认档案（D-015）。profile_id/snapshot 全 nullable，null 零新增查询（C-07 断言保护 PPM）。遗留：batch 路径 MCP 子集完整接线（task-09 gap）需新基础设施→独立 change。

### 2026-08-13 · 平台管理 spec 文件增量同步

- **platform-managed-file-sync**（2026-08-13）：spec 文件同步从「整树 tar 全量覆盖」改「文件级增量 diff + base_version 乐观锁 + 软删备份」——方向反转（R-01，daemon 本地权威回灌 → 服务器权威清单）。后端 spec_workspace 新增独立 `spec_file_manifest` 清单表（D-011 **不复用 scan_documents**，scan_docs reparse 不碰、职责分离）+ `apply_ops`（add/update/delete/rename + per-file base_version 乐观锁 conflict=true+server_versions、软删 move 出 spec_root 到 `spec_data_root/spec-backups/{ws}/{ts}/{path}` + exists=False+version+1、containment 校验对齐 tar 端点 + .runtime 拒、R-07 无行兜底 version=1、R-06 30 天机会式修剪）+ 端点 `POST /api/workspaces/{ws}/spec-workspace/sync-incremental`（conflict 时 **HTTP 200** body 带 server_versions，端点不额外抛 409）。旧 tar `_write_spec_root` 落盘后清 spec_file_manifest 行（Q7 旧 tar 失效清单）。daemon `postSpecSync` 由整树 tar 改增量 diff（本地清单缓存 `~/.sillyhub/daemon/manifests/{ws}.json` 移出 specDir 不被 pull 清、首同步/404 回退旧 tar、rename 同 hash 不重传、conflict 抛 SpecPushConflict 人工拍板）；hub-client `postSpecSyncIncremental`（JSON POST /api 前缀，QA 揪出 P0 URL 修复 + 回归锚点）。scan_docs 零改动。backend 65 测试 + daemon 79 测试 + 真实 daemon↔backend 集成证据（200 OK+落盘+清单行）。

### 2026-0
### 2026-0
### 2026-08-15 · init lease 触发 sillyspec init

- **init-trigger-sillyspec-init**（2026-08-15）：工作区初始化真正执行 `sillyspec init`——daemon `handleInitLease` 编排 5→6 步（pullSpecBundle 后、postSpecSync 前插 `runSillyspecInit` 硬失败 abort，D-002@v2：pull 整删重建故 init 必须后置），spawn `sillyspec init --dir <rootPath> --spec-dir <缓存> --workspace-id --no-skills --tool <多工具>`（shell:true + 60s 超时杀树 + spawnFn 依赖注入），成员本地获得 .sillyspec-platform.json 平台指针（status active）+ CLAUDE.md/AGENTS.md 指令注入 + spec 骨架。spawn 前 3s 版本门控 `MIN_SILLYSPEC_VERSION_FOR_INIT=3.26.8`（查询/解析失败 fail-safe，错误带中文升级指引，不依赖 daemon 重启）；tools 来自 cli.ts 构造前 AgentDetector 探测映射 VALID_TOOLS（兜底 claude）。配套双侧防冲突：backend `apply_ops` 冲突分支同 hash no-op 豁免（op.hash==row.content_hash → 不 conflict + new_versions 回服务器版本，D-008@v2 治第二成员骨架 add 必冲突）；daemon `UPLOAD_EXCLUDE_TOP_BASE` 三处统一排除 projects/（防成员机器绝对路径上传 + 缓存残留 delete op 误删）。跨仓 sillyspec CLI 三项（--no-skills / --tool 逗号重复多值 / 平台模式跳过项目内清理保 local.yaml 手调段）。verify PASS 含三场景真实集成证据（首成员产物/重复 init 手调保留/第二成员零冲突）+ 门控负路径；本机 npm link 3.26.8 验证（正式发版待用户，MIN 语义为下界）。契约零变更（lease metadata/claim payload/FileOp schema）。

### 2026-08-15 · perf-remediation 性能审查高危修复

- **perf-remediation**（2026-08-15）：六代理性能审查 10 项修复全流程归档（worktree b85c02f3，31 文件 +2368/-326，约 40 新测试）。核心：reparse/spec 写入链路 to_thread 事件循环解放（Wave C 范式推广）；_BatchProgressWriter 50 文件/500ms 批量回写（终态准确+COALESCE 修 NULL 不落地）+ apply_ops IN 预取（dict 镜像保同请求语义）；scan_docs 无 q 时 load_only 排除 content；api_key 认证 key_prefix 索引过滤（O(n) bcrypt→O(1)）；scandir 单遍+每文件 1 stat+_safe_mtime 推广；_load_module_map (path,mtime) 复合键缓存+platform_managed 路径修复；agent GET logs after 游标（> 取增量）+ mission console 增量合并；daemon _pollLoop lease 分支 90s 窗门控（change-write 无 WS 推送不门控）+ 落盘日志 7 天清理。流程坑：after 游标方向在 design Grill 修订时写反（<=），plan 独立审查抓出；daemon B2 测试竞态为预存缺陷（baseline 也红）顺修。遗留 P3：mission console 空 fallback 无闩锁、Windows 排序大小写差异。
8-14 · security-audit-remediation 多代理安全审查高危修复

- **security-audit-remediation**（2026-08-14~15）：6 并行审查代理（认证/注入/密钥/DB/FS/前端 daemon）确认 5 高危 + 7 中危 + XSS + 部署弱口令，全流程修复归档（commit c0af692c，77 文件 +6035/-441，100 新测试）。高危闭合：daemon WS 升级期鉴权（X-API-Key/Bearer 4001/4003，daemon 客户端同窗传 header）；claim/pending-leases/heartbeat 归属校验（三锚点链 + compare_digest）；LiteLLM master key 不出 backend 进程（llm-proxy 透传端点 v1 路径白名单 + usr-uid-pid 归属断言，context.py 两处改 proxy 标记）；file 五端点 IDOR（uploaded_by/WORKSPACE_READ/admin 可见域）；platform_sync JWT/shk_live_ 写端点 403（仅 shpsync_）+ 读并集聚合；sync_documents relative_to + filename 白名单；quick-chat lease metadata.actor_user_id 归属链（D-005@v2）；query token 回退删除 + 前端 5 处 fetch-SSE/header 转传；markdown rehype-sanitize；compose 弱口令 :?must set + 端口绑 127.0.0.1。QA review 追加修复：llm-proxy admin API 白名单（H-1）、HUB_PROXY_BASE_URL 部署接线、无锚点存量 lease 404。verify 含真实运行时证据（容器热更 + restart，WS 401/llm-proxy 401/admin 404 实测）。遗留 P2：sanitize svg 注释对齐、litellm-db 密码、8000/3000 端口面（独立 change）；性能类发现另立 change 待立项。
8-14 · profile.system_prompt 注入 + stageProfileId 持久化

- **profile-system-prompt-injection**（2026-08-14）：补全智能体档案绑定最后一块——profile.system_prompt 经 SDK `systemPrompt={preset:claude_code, append}` 注入 agent（废弃 D-012@v2 claudeMd prepend，保留 claude 默认能力 + 追加档案提示词）；stageProfileId 每阶段独立持久化到 `change.stages[<stage>].profile_id` + 新 PATCH `/changes/{id}/stage-profile`。链路：backend `_apply_profile_to_lease` 写 lease.metadata.system_prompt → `_PROFILE_PAYLOAD_FIELDS` 加字段双写 claim payload → daemon interactive SessionManager.create 透传 → `_buildDriverOptions` 设 preset+append → claude-sdk-driver 逐字段写 SDK options（D-005 非 claude 编译期隔离）；前端 stageProfileId useEffect 从 stages 恢复 + onChange PATCH。倒推 B 模式（代码先行）7 commit main（e258b5f1~68974864 + edde56fc 半接线修复）。无 DB 迁移（stages JSON 列）。遗留：batch/--print 路径未覆盖（非目标）；resume 重连 e2e 待观察。

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
