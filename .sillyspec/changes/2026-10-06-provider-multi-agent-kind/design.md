---
author: qinyi
created_at: 2026-10-06 14:07:03
generated_by: sillyspec-design-init
scale: "large"  # 多文件跨模块（backend llm_provider/daemon 解析链 + frontend 表单/列表/配置条）+ schema 迁移 → Wave 编排，run plan
---

# 设计文档（Design）— 2026-10-06-provider-multi-agent-kind

## 背景

供应商（llm_providers）每行只支持一个 Agent 种类（agent_kind 单值：claude/codex/pi 等引擎）。同一份上游凭证要服务多个引擎时必须重复建卡——生产实证（2026-10-06 查询）：admin2 同一份智谱 key 建 4 条（claude×3 + pi×1），另两用户各 2 条；根因是会话解析链按「引擎 == 供应商 agent_kind」精确匹配（backend/app/modules/daemon/lease/context.py:184、backend/app/modules/daemon/session/service/inject_gates.py:278、backend/app/modules/session_attachment/capability.py:113、backend/app/modules/mcp_gateway/tools.py:1234），单值字段把多引擎需求逼成了多行数据。

用户已确认做完整多选（decisions.md D-001）。

## 设计目标

1. 一条供应商凭证（同 key/base_url/模型配置）可声明服务多个引擎，会话解析按「引擎 ∈ 供应商引擎集合」命中（D-004/D-005）。
2. 全链路行为语义明确：设默认对勾选的全部引擎生效且同引擎互斥保留（D-003）；「pi × openai_chat」禁配升级为组合级校验。
3. daemon 注入链零改动：下发 provider_config.agent_kind 恒为会话引擎值，注入器分发契约不变（D-005）。
4. 存量数据自动迁移为「单元素数组」，仅新数据享受多选，不合并重复行（D-002）。

## 非目标

- 不做存量重复供应商合并/一键清理（D-002，用户手动删）。
- 不支持「只对部分勾选引擎设默认」（D-003 全引擎生效，YAGNI）。
- 不做按引擎差异化的模型配置：一条供应商一套配置，注入时各引擎各取所需（沿用现状——claude 注入器消费 ANTHROPIC_* 全套，pi 注入器消费 auth_field/extra_env）。
- 不改 daemon 仓任何代码（sillyhub-daemon 零改动）。
- 不改 opencode/litellm 相关链路（api_format=openai_chat 仍走既有 LiteLLM 路径及其隔离状态）。

## 拆分判断

单变更不拆：改动横跨三端但语义是同一条轴（agent_kind 单值→集合），拆成「后端先行+前端后行」两个变更会造成中间态（API 已回数组、前端还读单值）破窗。内部按 Wave 分层施工（后端数据层+解析链 → 前端 → 测试收口），一个变更内推进。

## 总体方案

**Wave 1 后端（数据层 + 服务 + 解析链）**

1. 迁移（NEW:backend/migrations/versions/20261006120000_provider_agent_kinds.py）：`agent_kind VARCHAR(32)` → `agent_kinds JSON NOT NULL`。SQLite/PG 双方言：batch_alter_table 加新列 → `UPDATE ... SET agent_kinds = [旧值]`（SQLite json_array 兼容写法，PG to_jsonb）→ 删旧列 → 复合索引 ix_llm_providers_user_agent_default 显式 drop 后按 (user_id) 维度 rebuild（is_default 过滤转行级 Python 判断，见 R-01）。项目未上线不要求历史兼容（规则 11），不留双列。
2. 模型/DTO（backend/app/modules/llm_provider/model.py、schema.py）：
   - `agent_kinds: list[str] = Field(min_length=1)`（至少一个引擎；去重；值域沿用现有引擎词表）；
   - Create/Update/Read 三 DTO 同步；Read 兼容：响应体仅出新字段 agent_kinds（数组），旧字段 agent_kind 删除——openapi.json + api-types 全量重生成，前端同批改，无过渡期（单仓单 PR 收口）；
   - 组合校验：`api_format=openai_chat 且 "pi" ∈ agent_kinds` → 422（沿用 LlmProviderKindFormatForbidden 语义，从行级单值改集合包含判定，schema.py:42 与 service.py:254 两处同口径）。
3. 服务层（backend/app/modules/llm_provider/service.py）：
   - create：`_clear_sibling_defaults` 从清一个引擎改为清集合内全部引擎的兄弟默认行（事务内循环，R-05 互斥语义不变，粒度仍 (user_id, agent_kind)）；
   - update：引擎集合可编辑；**扩张**：is_default=True 行新增引擎时，同样清「新增引擎」的兄弟默认行（D-006，互斥不变量恒成立）；**收缩**：若不再包含某引擎且该行是那个引擎的默认 → 该引擎默认空缺，不自动转移（D-003 附带语义，表单 toast 提示）；
   - probe/fetch_models/usage 不动（与引擎无关）。
4. 解析链（backend/app/modules/llm_provider 触点 + daemon 侧只读消费）：
   - backend/app/modules/daemon/lease/context.py：resolve_default 查询 `agent_kind == X AND is_default` → `agent_kinds 包含 X`（Python 侧集合判断，user_id 先过滤后行内过滤，数据量每用户几十行无性能面）；resolve_bound 的 `provider.agent_kind != agent_kind`（context.py:184）→ `agent_kind not in provider.agent_kinds`；构造 provider_config 时 **agent_kind 字段盖为会话引擎值**（会话是什么引擎就下发什么，daemon 注入器分发不变）；
   - backend/app/modules/daemon/session/service/inject_gates.py:278 同款 == → in；
   - backend/app/modules/session_attachment/capability.py:113 与 backend/app/modules/mcp_gateway/tools.py:1234 两处「user_id + agent_kind + is_default」默认查询同款集合化（Python 行级过滤）；tools.py:1030 的池描述符输出 `agent_kind` 键值改为**池引擎值**（effective_agent，语义本就是引擎）而非行字段；
   - **热切换扇出**（backend/app/modules/daemon/lease/provider_switch.py:45-98，D-006）：notify_provider_switch 现为单 config 无差别广播——多引擎默认行改为**按目标会话引擎分组构造 config**：先查目标 active interactive 会话集合，按 session.provider（引擎）分组，组内 resolve 出 provider_config（agent_kind=该引擎），逐会话推送；停止场景（config=None）行为不变；session.provider 为 NULL 的会话跳过扇出并告警（best-effort，对齐既有 runtime 解析 None 跳过语义）；
   - backend/app/modules/agent/schema.py:103-111（provider_config DTO 文档串）与 backend/app/modules/daemon/protocol.py:326 注释同步语义（「provider 的 agent_kind」→「会话引擎，恒为该会话引擎值」）。

**Wave 2 前端**

5. 表单（frontend/src/components/llm-providers/llm-provider-form.tsx）：引擎单选 Select → 多选（Checkbox.Group 形态，至少勾一个）；openai_chat 格式时 pi 项禁用并提示（与后端组合校验对齐，前置防 422）。
6. 列表（frontend/src/components/llm-providers/llm-provider-list.tsx）：引擎徽标从单个改多个（横向排布）。
7. 消费面过滤（frontend/src/components/sessions/session-config-bar.tsx、frontend/src/components/agent-profile-form.tsx）：按引擎过滤供应商的 `p.agent_kind === engine` → `p.agent_kinds.includes(engine)`；移动端（frontend/src/app/m/...）以 api-types 编译期核对，有本地过滤点同步（tasks 列核查项）。
8. 接口层（frontend/src/lib/api/llm-providers.ts）：类型与归一化同步（agent_kind → agent_kinds[]）；`pnpm gen:types` 重新生成 api-types.ts + backend/openapi.json 提交。注：预设（frontend/src/config/llmProviderPresets.ts）**无 agent_kind 字段**（引擎在表单独立选择，Grill P2-1 核正），预设零改动。

**Wave 3 测试与验收**

9. 后端：llm_provider 域（创建多引擎/组合校验/默认互斥清多引擎/更新收缩引擎默认空缺）+ daemon 解析域（resolve_default/bound 集合命中、claim payload agent_kind 盖会话引擎、provider switch 轮换口径）+ 迁移升级测试（SQLite 双方言）。
11. 前端：表单多选交互 + 组合禁用、列表徽标、配置条/档案表单过滤、移动端 mock 核查；tsc + eslint。
10. 端到端：UI 实测——一条智谱供应商勾 claude+pi，分别开 Claude 会话与 Pi 会话命中同一行；设默认后两种引擎新会话都默认它。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:backend/migrations/versions/20261006120000_provider_agent_kinds.py | agent_kind→agent_kinds JSON 迁移（双方言 + 存量单值转单元素数组 + 索引 drop/rebuild） |
| 修改 | backend/app/modules/llm_provider/model.py | 列定义 agent_kinds JSON NOT NULL + 索引重建 (user_id) |
| 修改 | backend/app/modules/llm_provider/schema.py | Create/Update/Read DTO agent_kinds: list[str]（min_length=1）+ pi×openai_chat 集合级校验。数据流：producer=前端表单 agent_kinds[] → API JSON → pydantic 校验（组合禁配）→ ORM 列；consumer=Read 响应回前端 |
| 修改 | backend/app/modules/llm_provider/service.py | create/update/set_default：_clear_sibling_defaults 按集合逐引擎清（含扩张新增引擎，D-006）；pi×openai 组合校验集合化；收缩引擎默认空缺语义 |
| 修改 | backend/app/modules/daemon/lease/context.py | resolve_default/bound + _inject_provider_config：== → 集合包含；provider_config.agent_kind 盖会话引擎值。数据流：producer=服务端盖写会话引擎 → claim payload → daemon injector（consumer，getInterceptor(agent_kind) 不变） |
| 修改 | backend/app/modules/daemon/lease/provider_switch.py | notify_provider_switch 按目标会话引擎分组扇出（每引擎一份 config，agent_kind=该引擎；停止场景不变）。数据流：producer=按引擎 resolve → ws_hub send_session_control → daemon reloadWithProvider（consumer） |
| 修改 | backend/app/modules/daemon/session/service/inject_gates.py | :278 引擎匹配 == → not in 集合（422 语义不变） |
| 修改 | backend/app/modules/session_attachment/capability.py | :113 默认查询集合化（会话/群聊 shadow 附件多模态门控链路，Grill P1-1） |
| 修改 | backend/app/modules/mcp_gateway/tools.py | :1234 配额池查询集合化；:1030 池描述符 agent_kind 键改输出池引擎值（Grill P1-1） |
| 修改 | backend/app/modules/agent/schema.py | provider_config DTO 文档串语义更新（agent_kind=会话引擎） |
| 修改 | backend/app/modules/daemon/protocol.py | :326 注释语义同步 |
| 修改 | backend/openapi.json | pnpm gen:types 再生成（agent_kinds 数组字段） |
| 修改 | frontend/src/lib/api-types.ts | gen:types 再生成 |
| 修改 | frontend/src/lib/api/llm-providers.ts | 类型/归一化 agent_kind → agent_kinds[] |
| 修改 | frontend/src/components/llm-providers/llm-provider-form.tsx | 引擎多选（Checkbox.Group）+ pi 项 openai 格式禁用前置 |
| 修改 | frontend/src/components/llm-providers/llm-provider-list.tsx | 多引擎徽标 |
| 修改 | frontend/src/components/sessions/session-config-bar.tsx | 供应商过滤 === → includes |
| 修改 | frontend/src/components/agent-profile-form.tsx | 同上过滤口径 |
| 修改 | backend/app/modules/llm_provider/tests/test_llm_provider.py | 默认互斥多引擎/扩张清新增引擎兄弟/组合校验用例 |
| 修改 | backend/app/modules/llm_provider/tests/test_api_format.py | pi×openai 集合级禁配用例 |
| 修改 | backend/app/modules/daemon/tests/test_resolve_default_provider_config.py | 集合命中 + agent_kind 盖会话引擎断言 |
| 修改 | backend/app/modules/daemon/tests/test_resolve_bound_provider_config.py | 同上（bound 路径） |
| 修改 | backend/app/modules/daemon/tests/test_provider_switch.py | 按引擎分组扇出断言（多引擎默认行对不同引擎会话各推对应 config） |
| 修改 | backend/tests/modules/daemon/lease/test_provider_config_payload.py | claim payload 契约断言 |
| 修改 | backend/app/modules/session_attachment/tests/test_capability.py | capability 集合化用例（门控默认查询按引擎命中多选行） |
| 修改 | frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx | 多选交互 + 组合禁用 |
| 修改 | frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx | api_format × pi 禁配前置 |
| 修改 | frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx | 徽标 |
| 修改 | frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx | mock DTO 字段补齐（agent_kinds） |
| 修改 | frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx | mock DTO 字段补齐（agent_kinds；其余含 agent_kind 的测试 mock 以 grep 复核为准逐一补字段） |
| 修改 | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | mock 字段补齐 |
| 修改 | frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx | mock 字段补齐 |
| 新增 | NEW:backend/app/modules/llm_provider/tests/test_agent_kinds_migration.py | 迁移测试（双方言+存量转数组+索引在位断言，范式沿用 backend/tests 顶层迁移测试先例） |
| 修改 | backend/app/modules/daemon/tests/test_provider_switch_integration.py | 扇出改造波及的集成用例（task 卡 grep 补充） |
| 修改 | backend/app/modules/daemon/tests/test_control_command_dispatch.py | notify 真实调用点夹具补 agent_kinds（task 卡 grep 补充） |
| 修改 | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx | 配置条过滤口径用例 |
| 修改 | frontend/src/lib/api/__tests__/llm-providers.test.ts | api 层归一化用例（grep 复核补充） |
| 修改 | frontend/src/app/m/workspaces/[id]/sessions/[sid]/__tests__/page.m-session-chat.test.tsx | 移动端会话聊天 mock 补齐（grep 复核补充） |
| 修改 | frontend/src/components/__tests__/agent-profile-form.test.tsx | 档案表单过滤口径用例 |

（已核查无需改动的 agent_kind 触点：backend/app/modules/daemon/session/service/attachments.py、control.py、group/service/shadow.py、attachment_pipeline.py、agent/router.py:343——传的全是会话引擎值非供应商行字段；backend/app/modules/daemon/session/service/errors.py:248 仅错误语义文案。**群聊 shadow 间接受累面**：shadow.py:796 传引擎值入 attachment_pipeline → capability.py 默认查询——已由 capability.py 清单行覆盖（R-06）。sillyhub-daemon 仓零改动。）

## 接口定义

本变更接口面：0 端点。

| 方法 | 路径 | 变更 |
|---|---|---|
| （无新端点——既有端点组字段级改造，无接口矩阵行） | | |

- `LlmProviderCreate.agent_kinds: list[str]`（≥1，去重，引擎词表校验；pi∈集 且 api_format=openai_chat → 422 KindFormatForbidden）
- `LlmProviderUpdate.agent_kinds: list[str] | None`（None=不动）
- `LlmProviderRead.agent_kinds: list[str]`（替代原 agent_kind: str）
- provider_config（claim/switch 下发，结构不变）：`agent_kind: str` **恒为会话引擎值**（盖写），其余 8 字段（anthropic）/6 字段（openai_chat）不变

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| claim lease | daemon | backend | leaseId, claimToken, provider_config(含 agent_kind=会话引擎) | pending → running（本变更仅改 provider_config 内 agent_kinds 命中与盖写，事件结构/时序零变化） |

本表仅声明受影响面：claim/会话生命周期事件的字段与时序均不变（provider_config.agent_kind 值语义从「供应商种类」细化为「会话引擎」）。

## 数据模型

llm_providers：`agent_kind VARCHAR(32) NOT NULL` → `agent_kinds JSON NOT NULL`（Python list[str]）。存量迁移：每行 `agent_kinds = [agent_kind]`。**索引变更**：ix_llm_providers_user_agent_default (user_id, agent_kind, is_default) 随列替换 drop，rebuild 为 (user_id)（is_default 过滤转行级 Python 判断——每用户行数几十级，无性能面；R-01）。

## 兼容策略（brownfield 必填）

- 项目未上线，不做新旧并行：API 响应直接切换 agent_kinds 数组，前端同批改造同一变更收口，无过渡期窗口（规则 11 授权）。
- 未编辑的存量供应商行为不变：单元素数组下全部解析/默认/校验语义与单值时代逐行为等价（迁移的值域不变性由迁移测试锁定）。
- daemon/前端会话面板等对 provider_config 的消费零变化（agent_kind 字段名与取值域不变，仅来源细化为会话引擎）。
- 前端旧字段消费者（表单/列表/配置条/档案表单/移动端/全部测试 mock）已 grep 穷举入清单（Grill 首轮曾漏 capability/tools/provider_switch 三处列级消费点，已补——R-02 修正为「grep + Grill 双通道清点」）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 复合索引 ix_llm_providers_user_agent_default 含 agent_kind 列，列替换后索引失效/迁移报错 | P2 | 迁移内显式 drop + (user_id) rebuild；迁移测试断言索引在位 |
| R-02 | 解析/消费链漏改某处 == 匹配或行字段读取导致多选行不命中/AttributeError | P1 | grep 全后端 + Grill 独立审查双通道清点（首轮补漏 3 处）；测试覆盖 default/bound/claim/switch/附件门控/配额池六路径 |
| R-03 | SQLite（测试）与 PG（生产）JSON 迁移方言差异 | P2 | batch_alter_table + json 兼容写法双分支；既有先例 20260825150000 PG 方言守卫模式 |
| R-04 | 前端消费面漏改（移动端本地过滤点/mock 字段）导致编译错或过滤失效 | P2 | api-types 编译期强制 + 清单含移动端/mock 测试文件 + tsc 全绿门 |
| R-05 | 用户收缩引擎集合后该引擎默认空缺造成「无默认」困惑 | P3 | 设计明确不自动转移；表单收缩时 toast 提示「X 引擎默认已空缺」 |
| R-06 | 群聊 shadow 附件多模态门控经 attachment_pipeline 间接消费 capability 默认查询（Grill 首轮识别） | P2 | capability.py 集合化清单行覆盖；shadow 路径附件门控用例入测试 |
| R-07 | 热切换扇出改造（provider_switch 按引擎分组）回归单引擎场景 | P1 | test_provider_switch 补单引擎回归用例（行为等价断言）+ 多引擎扇出用例 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 多选立项 | 全文（背景/目标） | 已覆盖 |
| D-002@v1 存量仅新数据生效 | 兼容策略 / 非目标 | 已覆盖 |
| D-003@v1 默认全引擎生效 | Wave1-3 service + R-05 | 已覆盖 |
| D-004@v1 单列改数组 | 数据模型 / Wave1 迁移 | 已覆盖 |
| D-005@v1 解析包含 + agent_kind 盖会话引擎 | Wave1-4 解析链 + 生命周期契约表 | 已覆盖 |
| D-006@v1 扩张清新增引擎兄弟默认 + 热切换按会话引擎扇出 | Wave1-3 service + provider_switch 扇出 + R-07 | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-001~D-006
- [x] 生命周期关键词命中（claim/session）→ 含生命周期契约表
- [ ] UI 原型分级核对：本变更 UI 面为表单控件形态变化（单选→多选）与徽标排布，无新页面/布局重构，不另出 HTML 原型；跳过原因已记（如评审认为需原型再补）
- [x] 不确定的问题标注「⚠️ 自审存疑」（R-01 索引重建、迁移时间戳以实际生成日为准）
