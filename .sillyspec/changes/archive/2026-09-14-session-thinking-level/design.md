---
author: qinyi
created_at: 2026-09-15 00:19:33
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 模型思考级别选择（v2 全量：创建时选档+动态档位+会话中切换）

## 背景

会话页的"模型思考级别"（reasoning effort / thinking level）目前**完全没有平台级选择能力**——用户在 Claude Code CLI 用 tab 切 thinking 档位、在 pi TUI 用 /thinking 命令、在 codex TUI 用模型选择器带 reasoning level，平台上一律只能用引擎默认档。长任务想要更深推理或更快响应，没有入口。

调研实证（2026-09-14，两路调研，源码/二进制/SDK 文档锚点核过）：

- **claude**（SDK 0.3.247）：`Options.effort?: EffortLevel`（sillyhub-daemon/node_modules/@claude-agent-sdk sdk.d.ts（pnpm .pnpm hash 目录内）:1735，五档 low/medium/high/xhigh/max，xhigh 有模型条件回退）；**会话中切** `Query.applyFlagSettings({effortLevel})`（:2505-2507，session-scoped，'max' 特例不入持久化）；**档位查询** `Query.supportedModels(): Promise<ModelInfo[]>`（:2552，ModelInfo.supportsEffort :1267 / supportedEffortLevels :1271）。daemon 落点：sillyhub-daemon/src/interactive/claude-sdk-driver.ts:409-411? options 构造区、:217-242 ClaudeStartOptions、state.query 可达（session-manager 存）。
- **pi**（0.81.1）：spawn 无 thinking 参数；**切换** `set_thinking_level {level}`（rpc.md:281-295，七档 off/minimal/low/medium/high/xhigh/max，xhigh/max 按模型条件）；**档位查询** `get_available_thinking_levels`（:316-335，按当前模型动态，无推理返回 ["off"]）+ get_state 的 thinkingLevel 现值 + thinking_level_change 事件。driver `_sendCommand` 通道现成（compact task-04 刚用）。
- **codex**（0.147.0 二进制 strings 实证）：turn/start params 有 model 先例（:1650），effort 极可能同位；**会话中切** `thread/settings/update` + `reasoningEffort` 字段（与 serviceTier/sandbox 同 struct）+ `thread/settings/updated` 通知；枚举 minimal/low/medium/high/xhigh；档位查询经模型目录元数据 `supported_reasoning_levels`。driver `_sendJsonRpcRequest` pending 通道现成（compact task-05 刚建）。
- **cursor**：无通道。
- **平台既有先例**：compact（2026-09-14-session-ctx-compact）刚验证的 RPC 模式——driver 可选契约方法+daemon RPC handler+caps 键+backend 端点+前端控件，照抄成本极低。会话中切模型走的是进程重启式（reloadWithConfig :1651-1716），体验差不适用于切档。
- **漂移发现**：codex caps.thinking=false 但 driver :671-682 已把 reasoning item 映射成 thinking 事件（sillyhub-daemon/src/adapters/json-rpc.ts:626-651 注释明说"codex reasoning 与 claude thinking 同契约"）——取值依据过时，顺手翻值。

## 设计目标

- **FR-01（caps 第 13 键 thinking_level）**：ProviderCaps 加 `thinking_level: boolean`（claude/pi/codex=true、cursor=false、未知回退 false），三端生成+守护+picker 同步（八步样板第四次兑现）。**顺手修**：codex caps.thinking 翻 true——**取值事实对齐**（driver :671 已映射 reasoning→thinking 事件、前端渲染由事件流无条件驱动今天已工作，caps 表值与事实不符；翻值非"解锁渲染"而是纠正声明，Grill P0-3）。
- **FR-02（统一档位词表与 driver 映射）**：daemon 单源七档 `off/minimal/low/medium/high/xhigh/max`；各 driver 层映射——claude low..max 直传 EffortLevel（off/minimal 无对应：off→不设 effort+注释、minimal→low 降级）；pi 七档直传；codex minimal..xhigh 直传（off/max 无对应：off→不设、max→xhigh 降级）。
- **FR-03（创建时选档）**：全链透传——前端 preThinkingLevel→SessionCreateRequest.thinking_level（schema.py :178/:204 model 同款）→ create.py 形参（不写 config 列，P1-8 定案：仅透传 placement）→ placement.py prepare_interactive_dispatch 形参+写 lease metadata（:653/:836 model 先例）→ lease/context.py build_claim_payload 白名单（:510 model 先例）→ daemon.ts execPayload 归一化（:9175 rawExec.model ?? payload.model 同款加 thinkingLevel）→ CreateSessionInput.thinkingLevel（types.ts :377 model 同款）→ session-manager `_buildDriverOptions`（:1031-1033 model 同款）→ 三 driver 启动设置（claude Options.effort / codex ctx+turn/start params / pi 握手完成后轮询前 set_thinking_level 命令——P1-9 时序修正）。
- **FR-04（动态档位查询）**：driver 可选方法 `getThinkingLevels?(handle): Promise<{levels: string[], current?: string}>`——pi=get_available_thinking_levels+get_state.thinkingLevel；claude=supportedModels().find(当前 model)?.supportedEffortLevels ?? 默认五档+无现值（SDK 不暴露 per-query 现值，返回 current=undefined）；codex=静态五档+thread/read reasoningEffort（若 pending 通道可读）或 current=undefined。daemon RPC handler `session_get_thinking_levels` + backend GET 端点 → 前端下拉数据源。
- **FR-05（会话中切换）**：driver 可选方法 `setThinkingLevel?(handle, level): Promise<{ok, error?}>`——pi=set_thinking_level 命令；claude=state.query.applyFlagSettings({effortLevel})；codex=_sendJsonRpcRequest('thread/settings/update',{threadId,reasoningEffort})。daemon RPC `session_set_thinking_level`（六守卫照 compact：running/reconnecting 拒绝——思考档切换不打断在跑轮，**仅空闲**约束沿用 D-002 前轮拍板）+ backend POST 端点。
- **FR-06（前端）**：①创建表单（session-config-bar）模型下拉旁加档位下拉（caps 门控+档位列表来自 GET 端点动态拉取+模型变档位重置+选 off/不选=引擎默认）；②会话页配置条（SessionConfigSwitchField 邻位）加档位切换控件（caps 门控+turn running 禁用+切换成功通知+当前档显示）；③预会话暂存 preThinkingLevel 同 preModelId 模式。
- **FR-07（真机验证）**：pi 真机 set_thinking_level+get_available_thinking_levels 双实证（_sendCommand 通道现成，成本最低）；codex 真机 thread/settings/update reasoningEffort 实证（spike 校正点）；claude applyFlagSettings 实证（SDK 直调）。

## 非目标

- **NG-01**：思考预算/自适应 thinking 配置管理（claude ThinkingConfig adaptive/budgetTokens、pi compaction 类配置——引擎默认，二期）。
- **NG-02**：轮中切档（仅空闲约束沿用 D-002 前轮）。
- **NG-03**：cursor 思考级别（无通道，caps=false）。
- **NG-04**：档位持久化到 AgentSession.config（**不写 config 列**，Grill P1-8 定案：创建时经 create.py 形参直透 placement 不写 config JSON；切换后由引擎自身 session 状态维持；平台不镜像——重启会话档位回引擎默认）。
- **NG-05**：数字型 effort（claude AgentSpec.effort 支持数字——平台统一命名档词表，数字档留二期）。
- **NG-06**：子代理/团队派工的 per-agent 档位（AgentSpec.effort——二期，主会话先落地）。

## 拆分判断

caps 键 → daemon 契约与三 driver → backend 端点 → 前端双控件是同一条功能链（三面统一：创建/查询/切换），单变更一次贯通走 large 四件套。照 compact 模式抄大幅降低风险。

## 总体方案

### Wave A — caps 第 13 键+codex thinking 翻值（FR-01）

八步样板（providers.ts 接口/表/回退+gen 脚本+两 @generated+alignment len==13×2+registry thirteenKeys+picker 两 toEqual+adapter 注释）。**增量**：codex 表 thinking 翻 true（docblock 补依据：driver :671-682 reasoning→thinking 映射+sillyhub-daemon/src/adapters/json-rpc.ts:626-651 同契约注释+前端渲染由事件流无条件驱动零 caps 消费方——**纯声明对齐无行为变化**，Grill P0-3 改写）。

### Wave B — daemon 契约与三 driver（FR-02/03/04/05）

1. **driver.ts**：`ThinkingLevels {levels: string[], current?: string}` / `ThinkingLevelResult {ok, error?}` 两类型 + InteractiveDriver 可选 `getThinkingLevels?(handle, model?)`（model 用于 claude supportedModels 过滤，Grill P1-5）/ `setThinkingLevel?(handle, level)` 两方法 + **InteractiveDriverStartOptions.thinkingLevel?**（三 driver 启动设置契约字段，Grill P1-9）。
2. **共享映射**：`interactive/thinking-levels.ts` NEW——七档词表常量+`mapPlatformLevelToEngine(provider, level): string|undefined`（各引擎映射矩阵+off/minimal/max 降级规则）+`isValidPlatformLevel(level)` 校验。
3. **session-manager**：`getThinkingLevels(sessionId)` / `setThinkingLevel(sessionId, level)` 两子模块函数（NEW thinking-level.ts，守卫照 compact.ts：六守卫+分派+透传）。
4. **daemon.ts**：`registerRpcHandler('session_get_thinking_levels')` + `registerRpcHandler('session_set_thinking_level')` 两 handler（照 session_compact 形态挂既有注册组）。
5. **PiRpcDriver**：`getThinkingLevels` = _sendCommand get_available_thinking_levels + get_state.thinkingLevel；`setThinkingLevel` = _sendCommand set_thinking_level；启动设置 = **握手（即 get_state）返回后、inputIt 轮询前**（pi-rpc-driver.ts :1455 插入点，Grill P1-9 时序修正）发 set_thinking_level（若 opts.thinkingLevel 传入）。
6. **ClaudeSdkDriver**：`getThinkingLevels` = handle.query.supportedModels().find(m => m.value === 当前 model)?.supportedEffortLevels ?? 默认五档（**Grill P1-5 两修正**：ModelInfo 无 id 字段用 m.value :1247-1286；"当前 model"经 SessionState.model 传参给 driver 方法——getThinkingLevels 签名扩为 (handle, model?)，session-manager 分派时传 state.model，types.ts :277 现成）；`setThinkingLevel` = handle.query.applyFlagSettings({effortLevel: 映射值})；启动设置 = ClaudeStartOptions.effort → options.effort（:409-411 同款）。
7. **CodexAppServerDriver**：`getThinkingLevels` = 静态五档+（若可行）thread/read reasoningEffort 现值（spike 定案；不可行 current=undefined）；`setThinkingLevel` = _sendJsonRpcRequest('thread/settings/update', {threadId, reasoningEffort})；启动设置 = ctx.thinkingLevel 存 handle._ctx → _writeTurnStart params 挂 reasoningEffort（spike 校正点：键名与位置）。

### Wave C — backend 端点（FR-03/04/05 服务面）

1. `GET /api/daemon/sessions/{id}/thinking-levels`：SessionDep+TaskRunAgentUser+caps 校验 → ws RPC `session_get_thinking_levels` → `{levels, current}` DTO。
2. `POST /api/daemon/sessions/{id}/thinking-level`：body `{level}` → 校验合法档（共享词表 backend 镜像）→ 会话状态校验（running/reconnecting 拒绝）→ ws RPC `session_set_thinking_level` → `{ok, error?}`。
3. `create.py` CreateSession 加 `thinking_level` 可选列（照 model :48/:170-171）。
4. schema.py 两 DTO + gen:types。

### Wave D — 前端（FR-06）

1. `sessions.ts`：`getSessionThinkingLevels()` / `setSessionThinkingLevel(level)` 两 API。
2. `session-config-bar.tsx`：档位下拉——**预会话态用前端静态七档镜像**（THINKING_LEVELS 词表前端 mirror，Grill P0-2 定案：与统一词表目标一致且无会话 id 可查；非 per-model 动态，引擎不支持的档由 mapPlatformLevelToEngine 降级规则兜底）；**会话态用 GET 端点动态档位**（含 current 现值显示）。off 显示"默认"并附 tooltip 说明跨引擎语义差异（claude=不设=引擎默认思考通常开/pi=真关，Grill P2-11）。
3. `session-panel-page.tsx`：①preThinkingLevel 暂存（:2117 随 createSession）②会话态档位切换控件（SessionConfigSwitchField 或独立 Select——照模型切换控件形态+turn running 禁用+当前档显示+成功通知）。
4. vitest：caps false 不渲染/档位列表加载/切换调用/模型变重置。

### Wave E — 验证（FR-07）

1. daemon vitest：映射矩阵单测（七档×三引擎+降级规则）+三 driver getThinkingLevels/setThinkingLevel（mock 形态）+session-manager 守卫+RPC handler。
2. backend pytest：两端点鉴权/caps 拒/状态拒/DTO/create 列。
3. frontend vitest：四分支。
4. 真机：pi 双命令实证（最低成本）+codex thread/settings/update spike+claude applyFlagSettings spike。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/interactive/providers.ts | caps 第 13 键 thinking_level+codex thinking 翻 true（FR-01） |
| 修改 | sillyhub-daemon/scripts/gen-provider-caps.mjs | CAPS_KEYS+模板+13 键文案（FR-01） |
| 修改 | frontend/src/lib/provider-caps.ts | @generated 重生成（FR-01） |
| 修改 | backend/app/modules/agent/provider_caps.py | @generated 重生成（FR-01） |
| 修改 | backend/app/modules/agent/tests/test_provider_caps_alignment.py | EXPECTED+len==13×2（FR-01） |
| 修改 | sillyhub-daemon/tests/interactive/provider-registry.test.ts | thirteenKeys（FR-01） |
| 修改 | frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx | 两 toEqual 补键（FR-01） |
| 修改 | sillyhub-daemon/tests/provider-adapter-registry.test.ts | 注释同步（FR-01） |
| 修改 | sillyhub-daemon/src/interactive/driver.ts | ThinkingLevels/ThinkingLevelResult+可选两方法（FR-02 契约） |
| 新增 | NEW:sillyhub-daemon/src/interactive/thinking-levels.ts | 七档词表+映射矩阵+校验（FR-02 单源） |
| 新增 | NEW:sillyhub-daemon/tests/interactive/thinking-levels.test.ts | 映射矩阵单测 |
| 新增 | NEW:sillyhub-daemon/src/interactive/session-manager/thinking-level.ts | getThinkingLevels/setThinkingLevel 守卫与分派 |
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts | facade 两方法委托+`_buildDriverOptions` 加 thinkingLevel 透传（:1031-1033 model 同款，Grill P1-9） |
| 修改 | sillyhub-daemon/src/daemon.ts | 两 RPC handler+execPayload 归一化 thinkingLevel（:9175 model 同款，Grill P0-1 补） |
| 修改 | sillyhub-daemon/src/interactive/types.ts | CreateSessionInput.thinkingLevel（:377 model 同款） |
| 修改 | sillyhub-daemon/src/interactive/pi-rpc-driver.ts | getThinkingLevels/setThinkingLevel+启动设置（FR-04/05/03） |
| 修改 | sillyhub-daemon/src/interactive/claude-sdk-driver.ts | 两方法+ClaudeStartOptions.effort+options 构造（FR-04/05/03） |
| 修改 | sillyhub-daemon/src/interactive/codex-app-server-driver.ts | 两方法+ctx.thinkingLevel+turn/start params（FR-04/05/03） |
| 新增 | NEW:sillyhub-daemon/tests/interactive/session-thinking-level.test.ts | 守卫与分派 |
| 修改 | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | 两方法断言 |
| 修改 | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | 两方法断言 |
| 修改 | backend/app/modules/daemon/router/session_crud.py | GET thinking-levels+POST thinking-level 两端点（FR-04/05） |
| 修改 | backend/app/modules/daemon/schema.py | 两 DTO+SessionCreateRequest.thinking_level（:178/:204 model 同款，Grill P1-6）（FR-03/04/05） |
| 修改 | backend/app/modules/daemon/session/service/create.py | thinking_level 形参透传 placement（不写 config 列，Grill P1-8 定案）（FR-03） |
| 修改 | backend/app/modules/agent/placement.py | prepare_interactive_dispatch 加 thinking_level 形参+写 lease metadata（:653/:836 model 先例，Grill P0-1 补） |
| 修改 | backend/app/modules/daemon/lease/context.py | build_claim_payload interactive 分支白名单透传（:510 model 先例，Grill P0-1 补） |
| 新增 | NEW:backend/app/modules/daemon/session/service/thinking_level.py | 两服务函数（照 compact.py 先例） |
| 新增 | NEW:backend/app/modules/daemon/tests/test_session_thinking_level_endpoint.py | 端点测试 |
| 修改 | backend/app/modules/daemon/router/__init__.py | _ENDPOINT_ORDER 加两序（import 期硬校验——compact 已留痕同型坑，Grill P1-4） |
| 修改 | backend/openapi.json + frontend/src/lib/api-types.ts | gen:types 产物 |
| 修改 | frontend/src/lib/daemon/sessions.ts | 两 API 客户端（FR-06） |
| 修改 | frontend/src/components/sessions/session-config-bar.tsx | 档位下拉（FR-06①） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | preThinkingLevel+会话切换控件（FR-06②） |
| 修改 | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx | 档位下拉控件测试（渲染/门控/级联/模型变重置，FR-06，plan-review P1-3 归属） |
| 修改 | docs/agent-provider-onboarding.md | thinking_level 接入指引（收尾） |

**字段数据流标注**：①创建：前端 preThinkingLevel→createSession body→SessionCreateRequest.thinking_level→create.py 形参→placement.py lease metadata→lease/context.py 白名单→daemon.ts execPayload 归一化→CreateSessionInput.thinkingLevel→_buildDriverOptions→三 driver 启动设置（claude options.effort/codex ctx+turn params/pi 握手完成后命令）。②查询：前端 react-query→GET thinking-levels→backend RPC→daemon handler→session-manager→driver.getThinkingLevels→pi rpc/claude supportedModels/codex 静态→{levels,current} 回传。③切换：前端控件→POST thinking-level→backend 校验（词表+状态）→RPC→daemon handler→session-manager 守卫→driver.setThinkingLevel→pi set_thinking_level/claude applyFlagSettings/codex thread/settings/update→{ok,error}→前端通知。caps `thinking_level` 键：providers.ts 单源→gen→前端门控+backend 校验。

## 接口定义

```ts
// driver.ts（可选契约，cursor 不实现）
export interface ThinkingLevels { levels: string[]; current?: string; }
export interface ThinkingLevelResult { ok: boolean; error?: string; }
export interface InteractiveDriver {
  // …既有（含 compact?）…
  getThinkingLevels?(handle: InteractiveDriverHandle): Promise<ThinkingLevels>;
  setThinkingLevel?(handle: InteractiveDriverHandle, level: string): Promise<ThinkingLevelResult>;
}

// thinking-levels.ts（NEW 共享单源）
export const THINKING_LEVELS = ['off','minimal','low','medium','high','xhigh','max'] as const;
export function mapPlatformLevelToEngine(provider: string, level: string): string | undefined;
export function isValidPlatformLevel(level: string): boolean;

// types.ts CreateSessionInput 追加
thinkingLevel?: string;
```

```python
# backend schema.py
class SessionThinkingLevelsResponse(BaseModel):
    levels: list[str]
    current: str | None = None
class SessionThinkingLevelRequest(BaseModel):
    level: str
class SessionThinkingLevelResponse(BaseModel):
    ok: bool
    error: str | None = None
```

## 生命周期契约表

生命周期契约：无/N/A（查询与切换为既有 interactive 会话上的瞬时 RPC 动作零状态迁移；创建时 thinkingLevel 为 CreateSessionInput 可选字段经既有创建链路；pi thinking_level_changed 事件维持现状不透传（sillyhub-daemon/src/interactive/pi-events.ts:88 已在吸收名单）——档位现值经 getThinkingLevels 查询而非事件推送）。

## 数据模型

无 schema 迁移（thinkingLevel **不写 config 列不落库**——create.py 形参仅透传 placement（P1-8 定案）；切换由引擎 session 状态维持；caps 为内存常量+生成产物）。

## 兼容策略（brownfield 必填）

- **旧 daemon**：两 RPC 未注册→RemoteError→backend 映射「daemon 未支持思考级别，请升级 daemon」；GET 端点同映射。
- **cursor/未知引擎**：caps=false→前端不渲染控件+backend 端点拒绝+session-manager 守卫。
- **不支持的档位**：mapPlatformLevelToEngine 返回 undefined→backend 校验 400/前端下拉过滤（档位列表来自 GET 动态查询，天然只显示引擎支持的档）。
- **不改变**：既有 model/provider 切换链零变化；AgentEvent schema 零变化；compact 链零变化。
- **codex thinking 翻值**：纯 caps 声明对齐（渲染由事件流驱动今天已工作、零 caps 消费方）——无行为变化。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | codex `thread/settings/update` params 形状未逐字段实证（二进制只有 struct 字段名；approvalsReviewer 等枚举序列化格式未知） | P1 | Wave E spike 先发 thread/read 看回执定形状；不可行降级为仅创建时设置（turn/start params）+切换返回 error 提示不支持 |
| R-02 | codex turn/start 是否收顶层 reasoningEffort 未实证 | P1 | spike 同上；降级为 config.toml model_reasoning_effort **仅单 codex 会话场景可用**（机器级共享配置同 daemon 所有 codex 会话互相污染档位，Grill P1-7 爆炸半径声明）——多会话场景 spike 失败即报不支持 |
| R-03 | claude supportedModels() 在 streaming input mode 的可用性（init 响应也带 models 数组兜底 :3776） | P2 | 若 query 方法不可用降级用 init 响应缓存（driver start 时抓）；再不行静态五档 |
| R-04 | pi thinking_level_change 事件维持吸收（不透传）——切换后档位现值依赖查询刷新 | P2 | 前端切换成功后 refetch 档位列表（react-query invalidate）；引擎自身 session 状态维持不变 |
| R-05 | 档位词表映射矩阵的降级规则（off→claude？max→codex？）可能不符引擎真实行为 | P2 | 映射矩阵单测+真机三引擎各验一轮+矩阵为纯函数易改 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | FR 全集+NG-01/05/06（v2 全量范围） | 已覆盖 |
| D-002@v1 | 总体方案 Wave A-E（RPC 模式+可选契约+三面统一） | 已覆盖 |
| Grill v1→v2 | P0×3（FR-03 全链补齐 placement/context/归一化/预会话静态镜像/codex 翻值论证改写）+P1×6（_ENDPOINT_ORDER/m.value+model 传参/schema 补全/R-02 半径/NG-04 定案/契约+时序）+P2×2 全吸收 | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-001@v1/D-002@v1
- [x] 生命周期关键词命中 → 紧邻豁免短语「生命周期契约：无/N/A」+括注（瞬时 RPC+可选字段经既有创建链）
- [x] UI 原型分级核对：跳过——创建表单档位下拉+会话配置条切换控件均为既有组件模式复用（Select 下拉照模型选择器；无新布局/流程）
- [x] ⚠️ 自审存疑三点升 R-01/R-02/R-03（codex 形状/turn-start/claude 查询可用性），均配 spike 或降级路径
- [x] Grill needs_revision（3 P0+6 P1+2 P2）全部修订闭环（v2）
