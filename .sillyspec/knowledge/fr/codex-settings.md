## FR-codex-settings-001 codex 凭证注入（per-session CODEX_HOME）
变更：2026-09-10-multi-provider-injection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户配置了 codex 供应商（anthropic 形态 api_key/base_url，或 openai_chat 形态 litellm_base_url/；When codex 会话/任务 spawn 前 provider_config 整体 absent per-form 必需字段缺失；Then `<root>/codex/<session_id>/` 写 auth.json+config.toml（per-form 映射：anthropic=api_k
全文：.sillyspec/changes/archive/2026-09-10-multi-provider-injection/requirements.md#FR-01
最近确认：efad0edb5

## FR-codex-settings-002 pi 自定义端点文件层（per-session PI_CODING_AGENT_DIR）
变更：2026-09-10-multi-provider-injection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given pi 供应商为 anthropic 形态且 base_url 非空 base_url 为空（官方端点）；When pi 会话/任务 spawn 前；Then `<root>/pi/<session_id>/` 写三文件：auth.json 官方形状 `{"sillyhub":{"type":"api_key","ke
全文：.sillyspec/changes/archive/2026-09-10-multi-provider-injection/requirements.md#FR-02
最近确认：efad0edb5

## FR-codex-settings-003 热切换尽力语义
变更：2026-09-10-multi-provider-injection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When 默认供应商切换（既有 PROVIDER_CONFIG_CHANGED 推送）；Then daemon 对活跃 codex/pi 会话按 session_id 重写其 per-session 目录（尽力——CLI 是否进程内重读不保证）；新会话必生效
全文：.sillyspec/changes/archive/2026-09-10-multi-provider-injection/requirements.md#FR-03
最近确认：efad0edb5

## FR-codex-settings-004 backend 词表与禁配
变更：2026-09-10-multi-provider-injection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given llm_provider schema（pi 由并行变更放开的词表基础上）；Then agent_kind Literal 增 "codex"（仅 Create 一处）；pi × openai_chat 组合 Create 422 + Updat
全文：.sillyspec/changes/archive/2026-09-10-multi-provider-injection/requirements.md#FR-04
最近确认：efad0edb5

## FR-codex-settings-005 前端表单
变更：2026-09-10-multi-provider-injection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 供应商表单；Then codex 选项启用；pi 时自定义端点字段（baseUrl/models）显示且 openai_chat 禁选；DTO 走 gen:types
全文：.sillyspec/changes/archive/2026-09-10-multi-provider-injection/requirements.md#FR-05
最近确认：efad0edb5

## FR-codex-settings-006 真实 CLI 冒烟（W5）
变更：2026-09-10-multi-provider-injection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — 
全文：.sillyspec/changes/archive/2026-09-10-multi-provider-injection/requirements.md#FR-06
最近确认：efad0edb5

## FR-codex-settings-007 reload 守卫前移（D-001@v1）
变更：2026-09-12-provider-file-tx
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given codex/pi 会话收到供应商切换请求；When resume key（agentSessionId）缺失；Then 在任何文件层写盘之前抛出（message 与现状逐字一致），per-session 目录零写入（无目标文件变更、无 tmp 残留）
全文：.sillyspec/changes/archive/2026-09-12-provider-file-tx/requirements.md#FR-01
最近确认：8e8b22a7f

## FR-codex-settings-008 reload 失败文件层回滚（D-002@v2）
变更：2026-09-12-provider-file-tx
状态：active
摘要：默认场景
依据决策：D-002@v2
场景正文：
- 场景：默认场景 — Given reload 已执行文件层写盘（局部标记为真）；When 后续步骤（driver.start 等）失败进入 catch；Then 内存态还原后 best-effort 以 oldProviderConfig+oldEnv 重跑 ForReload 恢复文件层；若 ForReload 返回空
全文：.sillyspec/changes/archive/2026-09-12-provider-file-tx/requirements.md#FR-02
最近确认：8e8b22a7f

## FR-codex-settings-009 原子写（D-003@v1）
变更：2026-09-12-provider-file-tx
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given codex 两文件 / pi 三文件 / 宿主镜像拷贝任一写盘点；When 写入过程任一步失败（写 tmp/fsync/rename）；Then 目标文件保持旧全文；`.tmp-*` 被 best-effort 清理；成功时观察者只见旧或新全文（rollout 拷贝按 design 划界不纳入）
全文：.sillyspec/changes/archive/2026-09-12-provider-file-tx/requirements.md#FR-03
最近确认：8e8b22a7f

## FR-codex-settings-010 生效标记与 restore 三态探测（D-004@v2）
变更：2026-09-12-provider-file-tx
状态：active
摘要：默认场景
依据决策：D-004@v2
场景正文：
- 场景：默认场景 — Given per-session codex 目录；When 写盘成功（分支一，标记后置 best-effort）或 codex-null 镜像（分支四，标记先行——标记失败则跳过整个镜像含删除动作，返回 prior CO；Then 目录含 `.sillyhub-managed` ⟺ 切换曾真实生效（删除类动作必晚于标记持久化）；restore null+codex 探测三态：标记在 → m
全文：.sillyspec/changes/archive/2026-09-12-provider-file-tx/requirements.md#FR-04
最近确认：8e8b22a7f

## FR-codex-settings-011 provider 维度引擎门（D-005@v2）
变更：2026-09-12-provider-file-tx
状态：active
摘要：默认场景
依据决策：D-005@v2
场景正文：
- 场景：默认场景 — Given reload 调用携带 provider 切换载荷；When 引擎 ∉ {claude, codex, pi}（如 cursor）；Then 显式 throw 拒绝（fail-loud + 日志）；config-only 路径（人格/配置切换）不受门限制，全引擎行为不变
全文：.sillyspec/changes/archive/2026-09-12-provider-file-tx/requirements.md#FR-05
最近确认：8e8b22a7f
