# 配置资产管理能力补强方案（MCP 库 / Codex 供应商 / 技能库）

- 日期：2026-09-10
- 依据：`docs/research-ai-toolbox-config-management-2026-09-10.md`（ai-toolbox 调研）+ 平台现状实测（下文引用具体文件）
- 性质：**brainstorm 输入材料**。实施前每个方向须按 SillySpec 流程开独立 change（brainstorm → plan → execute），本文档提供动机、边界建议和技术底稿
- 关联：`2026-09-03-agent-provider-abstraction`（agent 运行时抽象，其非目标中"execenv 式环境准备层"正是本方案 P0-B 要补的空间，互补不重叠）

## 1. 动机与目标

对照 ai-toolbox 调研结论，平台在"配置资产管理"上有三个实际缺口：

1. **MCP 无资产沉淀**：平台 MCP 配置只是 settings 表两个 KV（`backend/app/modules/settings/router.py:160`，`mcp.platform_default` + `mcp.whitelist`），无独立实体、无分组/标签/收藏、无导入能力、无注入诊断回显。用户想复用一个 MCP 定义（比如 context7）只能手抄 JSON。
2. **Codex 供应商注入断层**：`llm_provider` 表是 agent_kind 中性设计，但 daemon 注入器注册表只有 claude（`sillyhub-daemon/src/credential-injector.ts:217`，注释明确预留 codex 扩展点）；codex 会话靠 CLI `-c` 参数覆盖，供应商切换（平台已有的 WS 热切换能力）对 codex 不生效。
3. **技能无版本与来源管理**：现有链路（`backend/app/modules/agent/skills_bundle_service.py`：sillyspec-* 扫描 + CustomSkill DB → tar.gz → daemon 复制）没有 git 源、没有版本更新、没有 per-workspace 启用粒度。

目标：补齐这三块，同时**不破坏平台既有优势**（会话隔离配置目录、密钥不出 backend、供应商热切换、stdio-only 防护）。

## 2. 设计原则（从 ai-toolbox 搬什么、不搬什么）

**搬**：

- "中央主数据 + 投影 + 单向推送 + 显式导入"模式——投影目标从 ai-toolbox 的"宿主全局配置文件"换成我们的"会话隔离目录 / workspace 文件"
- 保守合并铁律：平台写任何配置文件只动"自己管理的字段"，托管清单显式化（对应 ai-toolbox 的 KNOWN_ENV_FIELDS / managed-config 差量替换）
- 导入去重规则：同名同配置 skip、同名异配置改名复制；来源打持久去重键
- 变更指纹（content hash）驱动更新与诊断
- "上游有权威 CLI 时不重做安装逻辑"（插件结论，见 §6）

**不搬**：

- 写宿主全局配置（`~/.claude/settings.json`、`~/.codex/config.toml`）——多用户平台必须保持会话级隔离目录
- symlink 分发——服务端 daemon 与 workspace 存在容器/权限边界，继续用 copy
- 托盘/WSL/SSH 同步——桌面场景专属
- SQLite JSONB 单用户存储——我们已有 SQLModel 关系模型 + 用户隔离需求

## 3. P0-A：MCP 中央资产库（建议优先）

### 3.1 范围

新增 `mcp_registry` backend 模块（或并入现有 settings 域，brainstorm 时定）：MCP 定义成为一等实体，可管理、可复用、可导入；现有注入链（platform < workspace < builtin 优先级、白名单过滤、stdio-only）**语义不变**，只是 `platform_default` 的数据源从 KV 升级为 registry 渲染产物。

### 3.2 数据模型草案

```text
McpServer（新表）
  id / owner_user_id（NULL = 平台共享，否则用户私有）
  name（唯一键：owner + name）
  server_type            # 'stdio'（建模预留 http/sse，注入层暂不放行，见 §3.5）
  server_config (JSON)   # {command, args, env}——env 中 secret 类键加密存储
  tags / note / enabled
  source                 # manual / imported_workspace / imported_json
  dedup_key              # 导入去重（如 ws:<workspace_id>:<name>）
  created_at / updated_at

McpBinding（作用域绑定，或 McpServer 上的 JSON 字段，brainstorm 定）
  scope: platform_default | user_default
  server_id
```

要点：

- **加密**：`server_config.env` 中 secret 类键复用 `llm_provider` 的加密设施（key_id 体系）；读取端点沿用 `_redact_mcp_env` 的遮蔽语义（`settings/router.py:168`）
- **workspace 维度不动**：workspace 级继续用现有 `.mcp.json`（`workspace/skills_view_service.py` 直读直写 + 审计），registry 通过"导入 workspace 配置"吸收它，不替代
- **白名单保留**：`mcp.whitelist` 继续作为平台治理层（哪些 server 名允许注入），registry 是资产层，两层分离

### 3.3 注入链改造（最小侵入）

`GET /api/daemon/mcp/config`（daemon 拉取端点）返回值由"读 KV"改为"渲染 platform_default 绑定的 server 集合 → 拼 mcpServers"；daemon 侧 `sillyhub-daemon/src/mcp-config.ts` **零改动**（消费的 JSON 形状不变）。预净化、白名单过滤、合并优先级全部保留。

### 3.4 能力清单（对标 ai-toolbox §3）

| 能力 | 做法 | ai-toolbox 参照 |
|---|---|---|
| CRUD + 分组/标签/搜索 | 标准模块 + 前端 settings/mcp 页升级 | `mcp/types.rs`、McpPage |
| 导入 JSON | 粘贴 mcpServers JSON 建库（兼容 `mcpServers/servers/mcp` 包装，ai-toolbox 的 `mcpJsonImport.ts` 逻辑可直接参考） | `utils/mcpJsonImport.ts` |
| 扫描导入 | 扫各 workspace `.mcp.json` 反向导入，同名去重（同配置 skip/异配置改名） | `mcp_scan_servers` / `mcp_import_from_tool` |
| 注入诊断回显 | 聚合 daemon 已有 warn 事件（`mcp_server_rejected_by_whitelist` / `mcp_server_prepurged_non_stdio`）到 registry UI | `sync_details` |
| 收藏模板 | 预置常用 MCP 模板（fetch/context7 等）快速添加 | `FavoriteMcp` 预置 7 个 |
| cmd 归一化 | 入库时剥 Windows `cmd /c` 包装存可移植形态（若 command 用绝对路径场景出现再做） | `unwrap_cmd_c` |

### 3.5 明确不做 / 开放问题

- **http/sse 不在本期放行**：stdio-only 是 D-017 防 SSRF 的安全决策。registry 建模预留 type 字段，放行需先做 URL 出网白名单评估（brainstorm 时作为独立议题）
- 多用户可见性模型（平台共享库 vs 用户私有库的默认行为）需用户确认
- 不做"同步到宿主工具配置文件"（我们是注入不是写盘）

## 4. P0-B：Codex 供应商注入（先 spike 后实施）

### 4.1 现状与差距

- backend `llm_provider`：agent_kind 中性、`set-default` + WS 推送 `PROVIDER_CONFIG_CHANGED` 热切换——**对 codex 不生效**，因为 daemon 注入链没有 codex 实现
- daemon：`codex-app-server-driver.ts` 用 CLI `-c` 覆盖参数（每处调用点手工拼），无凭证注入、无 config.toml 写盘

### 4.2 方向

1. **Spike（先行）**：验证 codex 凭证注入的三条路径，确定首选：
   - env 注入（`OPENAI_API_KEY` / `OPENAI_BASE_URL` 是否被 codex 认）——若 env 够用则最薄
   - 隔离 `CODEX_HOME` 下写 `auth.json` + `config.toml`（对应 claude 的 `$CLAUDE_CONFIG_DIR` 隔离哲学）
   - 继续 `-c` 覆盖（现状，无法热切换）
2. **CodexCredentialInjector**（`sillyhub-daemon/src/credential-injector.ts` 注册表现成扩展点，接口注释已写明做法）：ProviderConfig → codex 认得的 env / 配置
3. **codex-settings.ts**（若走 CODEX_HOME 写盘）：spawn 前写隔离目录的 auth.json / config.toml。**核心借鉴 ai-toolbox 的保守合并**（`codex/commands.rs` 的 `write_codex_config_files`）：
   - auth.json 只替换托管字段
   - config.toml 用"上一份管理配置 → 新管理配置"差量替换，非托管段保留（用户自定义 approval_policy 等不丢）
   - 托管字段清单显式化（对应 claude-settings.ts 的 4 键白名单模式）
4. **热切换打通**：供应商切换时 codex 活跃会话跟随 `PROVIDER_CONFIG_CHANGED`（复用现有 `daemon/lease/provider_switch.py` 机制，按 codex 会话是否支持运行中生效决定是"新会话生效"还是"重启会话生效"，spike 结论定）

### 4.3 衔接

`agent-provider-abstraction` 的 provider 注册表已预留 execenv 字段位（其 design 非目标："不引入 execenv 式环境准备层，仅预留字段位"）——本项就是那个被推迟的层的第一块落地，实施时对齐注册表描述符，不另起炉灶。

## 5. P1：技能库（来源 / 版本 / 绑定）

### 5.1 演进方向（不推翻现有 bundle 链路）

现有链路保留（sillyspec-* 平台技能 + CustomSkill 用户技能 → manifest+version hash → daemon 重拉）。新增三层能力：

1. **来源管理**：`SkillSource`——git 仓库源（浅克隆拉取，参照 ai-toolbox `git_fetcher.rs`：`--depth 1 --filter=blob:none` + 缓存 TTL + 300s 超时 + `GIT_TERMINAL_PROMPT=0`）/ 本地目录源 / 现有 DB+文件系统源。frontmatter 解析 name/description（ai-toolbox 的 185 行 YAML 子集解析器可直译）
2. **版本感知**：目录级 content hash（相对路径+文件字节，ai-toolbox `content_hash.rs` 43 行可直译）进 manifest version；git 源记录 commit；更新时 hash 相同则跳过分发。git 源定时拉取（backend 启动 + 每日 cron，静默）
3. **启用绑定**：skill →（user / workspace / agent_profile）启用维度。第一版建议只做 user 维度（CustomSkill 已是 user 隔离，扩成"库中的技能按用户启用"），workspace 维度观察需求再加

### 5.2 Onboarding 收编

扫各 workspace 下散落的 `.claude/skills/`（用户手动放进去的技能），列出差集（不在平台库中的），一键收编为用户技能（content 存 DB）或平台技能（admin）。参照 ai-toolbox `onboarding.rs`：按名称分组、内容指纹标冲突（同名不同内容 → 标记让用户选）。

### 5.3 不做

- 不做 symlink 分发（继续 tar.gz copy）
- 不做前端技能市场 UI（先管理页）
- 不做跨用户技能分享（观察需求）

## 6. P2：插件管理（明确暂缓）

调研结论（ai-toolbox 的判断标准：**上游有权威 CLI 时不重做安装逻辑**）叠加平台约束：

- 多用户服务端替用户安装插件风险大——Claude 插件可捆绑 hooks/MCP/任意代码，在共享宿主执行面需要额外隔离设计
- 现状 `enabledPlugins` 透传（claude-settings.ts 白名单 4 键之一）已覆盖"平台控制开关"这个最小场景
- 若未来需要：方向是 daemon 侧包装 `claude plugin` CLI + 读状态 JSON 展示（ai-toolbox 模式），且须评估插件内 hooks 的执行边界。**当前无需求信号，不动**

## 7. 建议变更切分与顺序

| 顺序 | change（建议名） | 范围 | 前置 |
|---|---|---|---|
| 1 | `mcp-central-registry` | §3 全部（新表 + 拉取端点换源 + 前端管理页 + 导入） | 无 |
| 2 | `codex-provider-injection` | §4（spike 结论先行，再注入器 + 写盘 + 热切换） | spike 报告；与 agent-provider-abstraction 注册表对齐 |
| 3 | `skills-central-library` | §5（来源 + hash 版本 + user 绑定 + 收编） | 无强前置，可与 2 并行 |

理由：MCP 库价值最直接（用户体验痛点）且不依赖其他变更；codex 注入有 spike 不确定性但补的是既有热切换能力的断层；技能库是锦上添花的演进。

## 8. 风险清单

1. **MCP secret 加密迁移**：现有 `mcp.platform_default` KV 里可能已有明文 env，切 registry 时需迁移 + 加密，迁移期双读（brainstorm 时定迁移策略）
2. **codex env 注入路径未验证**：`-c` 覆盖 vs env vs auth.json 三路行为差异需 spike 实测定案，避免方案层臆断
3. **registry 渲染的性能**：daemon 拉取端点从读 KV 变为查表+解密+渲染，注意缓存（daemon 侧已有 60s 缓存机制可复用）
4. **前端 api-types 联动**：新 DTO 须走 `pnpm gen:types`（CLAUDE.md 规则 21）
5. **测试边界**：MCP 注入链有"永不抛错阻塞会话创建"的 R-03 约定，registry 渲染失败必须回落现有 KV/空配置语义
