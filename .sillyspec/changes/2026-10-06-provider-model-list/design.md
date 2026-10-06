---
author: qinyi
created_at: 2026-10-06 21:15:00
scale: "large"  # 跨 backend/frontend 两端 + schema 迁移 + 三消费链（注入/门控/会话选模型），需 Wave 编排
---

# 设计文档（Design）— 2026-10-06-provider-model-list

## 背景

供应商模型配置现状是三个不相干字段的拼盘：`model` 单默认值（backend/app/modules/llm_provider/model.py:59-63）、`model_role_mappings` 固定 4 角色槽（sonnet/opus/fable/haiku，daemon injector 注 ANTHROPIC_DEFAULT_*_MODEL）、`multimodal` 供应商级三态（backend/app/modules/session_attachment/capability.py:7 附件门控消费）。痛点（用户 2026-10-06 提出）：
1. **多模态挂错层级**——同一供应商不同模型的多模态能力不同（如 flash 系文本 only、pro 系可看图），供应商级标记粒度不够；
2. **4 角色槽限制模型定义**——角色槽是 Claude Code 的注入语义不是模型管理语义，其它引擎（pi/codex）没有"模型列表"可定义，模型条数被槽位数隐性限制。

上一变更 2026-10-06-provider-multi-agent-kind（已部署生产）已完成 agent_kinds 集合化，本变更是模型面的同型续作（D-001/D-005）。

## 设计目标

1. 供应商级**模型列表**：每条模型条目含模型名 + 多模态三态（auto/true/false）+ 可选角色标记（承担 Claude 哪些档位，可多标）+ one_m 勾选；条数不限（D-002）。
2. 多模态**下沉到模型级**：附件门控按「会话当前生效模型在列表里的标记」判定，auto 沿用模型名启发式（D-003）。
3. 三条消费链同步切换且 **daemon 仓零改动**（延续上变更契约保持策略）：注入折算、附件门控、会话选模型。
4. 存量自动折算（D-004）：model + model_role_mappings 去重折算成列表，多模态标 auto，角色/one_m 保留，旧四列迁移后删除。

## 非目标

- 不做模型条目的更多属性（价格/上下文窗口/描述文案等）——后续有需要另立变更。
- 不做跨供应商模型共享或平台级模型目录。
- 不改 daemon 仓任何代码（注入链契约保持）。
- 不做预设的模型预填（预设零触碰）。

## 拆分判断

单变更不拆：模型列表的存储/迁移/服务层/三条消费链/前端表单是同一条轴（字段重构），拆开会留中间态破窗（API 已回列表、门控还读旧字段）。内部 Wave 分层施工。

## 总体方案

**条目结构（单一真相）**

```json
models: [
  { "name": "deepseek-v4.1-flash", "multimodal": "auto", "roles": ["sonnet"], "one_m": false },
  { "name": "glm-5.3", "multimodal": "true", "roles": ["opus", "fable"], "one_m": true }
]
```

- `roles`: list[str]，值域 sonnet/opus/fable/haiku（Claude 4 档），可空（其它引擎的模型不标）；同角色允许多条模型时取第一条（表单校验提示但不禁——用户可能故意配备胎；注入取首条）。**主模型** = ANTHROPIC_MODEL = sonnet 角色首条 ?? 列表首条。

**Wave 1 后端数据层 + 服务层**

1. 迁移（NEW:backend/migrations/versions/20261006200000_provider_models.py）：
   - `llm_providers` 加 `models JSON NOT NULL`（server_default '[]' 占位）；（Grill P1-2：`default_fallback_model` 列一并退役——其语义「会话未选时的兜底」与主模型派生重合，四处消费点 capability.py:76 / litellm_client.py:84 / inject_gates.py:615,624 / create.py:669 全部切「列表派生主模型」口径）；
   - 回填折算（D-004，Python 侧逐行读旧三字段算列表——SQL 表达不了去重+角色归并）：
     - 候选模型名集合 = [model] + [default_fallback_model] + 4 槽的 model 值（非空去重保序，Grill P1-2 补 fallback 值——否则只配了 fallback 的存量供应商折算后列表为空）；
     - 每条 `multimodal: "auto"`（旧供应商级标记不映射——粒度变了，auto 让启发式兜底）；
     - 角色槽归并：sonnet/opus/fable/haiku 槽指向的模型名 → 对应条目 roles 追加该角色 + one_m 透传；
     - 空供应商（无任何模型名）→ `[]`（服务层允许空列表，会话选模型时提示先配模型）；
   - 删 `model` / `model_role_mappings` / `multimodal` / `default_fallback_model` 四旧列；
   - downgrade 对称：重建四旧列（model=sonnet 首条 ?? 列表首条 ?? NULL、default_fallback_model=主模型、model_role_mappings 从 roles 反折 4 槽、multimodal='auto'）。
2. model.py：四旧字段删除，`models: list[dict]` JSON 列。
3. schema.py（含 Create/Update/Read 的 `default_fallback_model` 字段一并退役，N-1 附带）：`ProviderModelEntry` pydantic 子模型（name 必填 pattern 防空白、multimodal Literal 三态缺省 auto、roles 值域校验、one_m bool 缺省 false）；Create/Update/Read 的 `models: list[ProviderModelEntry]`（Create 缺省 []、Update None=不动）；同角色多条不拒（提示性校验）。
4. service.py：create/update 赋值；`_to_read` 透传。

**Wave 2 后端三条消费链**

5. 注入折算（backend/app/modules/daemon/lease/context.py 两处 resolve）：
   - provider_config 新形态：`models` 列表 + `model`（会话所选或主模型）原样保留（daemon 兜底）；
   - **关键折算**：daemon injector 消费四个键——model / default_fallback_model / model_role_mappings（Grill P1-1 核正：attachments.py:442-446 会话所选**同时覆写** model 与 default_fallback_model 两键，injector 规则 3 fallback 优先）。折算口径：`model` 与 `default_fallback_model` **两键同值** = 会话所选模型 ?? 主模型（sonnet 首条 ?? 列表首条）——与现状两键覆写行为逐字对齐；`model_role_mappings` 键形态逐字不变（值由条目 roles+one_m 折算 `{role: {model, one_m}}`）；**新增 `models` 原始列表键**供前端/门控用。daemon injector 消费面零变化。
6. 附件门控（backend/app/modules/session_attachment/capability.py，Grill P1-3 核正：三层签名均**无**模型名入参，auto 现状读 provider.model 供应商级单值——需**新增 model_name 入参**并改造两级调用方）：
   - 判定链：resolve_gate(provider, model_name=None) 新增入参 → model_name 在 provider.models 列表查条目 → auto 走 supports_multimodal_by_model_name(model_name) / true/false 直判；
   - 调用方改造：单聊 inject 链（attachments.py 组装点传会话生效模型）与群聊 members 链（group/service/shadow.py → attachment_pipeline.resolve_multimodal_gate 透传各成员会话模型）——两链文件入清单（R-07）；
   - 列表查不到该模型名（会话选了个后来删掉的模型）→ 保守 false（模型未知，对齐现有"本机凭证保守不支持"语义）；
   - 旧 provider.multimodal 读取删除。
7. 会话选模型（backend/app/modules/daemon/session/service/inject_gates.py + create.py）：
   - 会话级 model 三态语义不变（None 不动/空串重置/非空选模）；
   - 非空时校验所选模型 ∈ 供应商 models 列表（不在 → 422 提示可用模型），取代现在"无供应商 422"的单点；
   - claim payload 的 model 字段 = 会话所选 ?? 主模型（列表派生）。

**Wave 3 后端测试**

8. 迁移折算测试（SQLite 直驱：单模型/4 槽去重/one_m 保留/空供应商/downgrade 反折）；服务层列表 CRUD；注入折算（roles→model_role_mappings 形态断言 + daemon 消费契约逐字）；门控三态×列表命中/未命中；会话选模型校验 422/透传。

**Wave 4 前端**

9. 表单（llm-provider-form.tsx）：模型区改**列表编辑器**（每行：模型名输入 + 多模态三态下拉 + 角色多选标签 + one_m 勾选 + 删除；底部"添加模型"）；在线拉模型（fetch_models）保留——拉到的模型一键加入列表行；角色映射旧 4 槽 UI 退役（列表行内标角色取代）。
10. 消费面：会话配置条模型下拉源改供应商 models 列表（session-config-bar）；agent-profile-form 模型选择同源；usage 上下文条（ctx-usage-bar）模型显示对齐；api-types 重生成。
11. 移动端会话模型选择同源。

**Wave 5 前端测试 + 端到端验收**

12. 表单列表编辑器交互（增删行/角色标签/多模态下拉/fetch 一键加入）；门控链用例；配置条下拉源；tsc/eslint。
13. UI 实测：编辑存量供应商（折算结果回显）→ 加新模型标角色 → 开会话选该模型 → 附件门控按标记判定；会话选不在列表的模型被 422。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:backend/migrations/versions/20261006200000_provider_models.py | models JSON 列 + 存量折算回填（Python 侧）+ 四旧列删除 + 对称 downgrade |
| 修改 | backend/app/modules/llm_provider/model.py | 删 model/model_role_mappings/multimodal/default_fallback_model 四字段，加 models JSON 列 |
| 修改 | backend/app/modules/llm_provider/schema.py | ProviderModelEntry 子模型 + Create/Update/Read.models。数据流：producer=前端表单 models[] → API JSON → pydantic 校验（name/三态/roles 值域）→ ORM 列 → consumer=Read 响应 + 注入折算 + 门控 |
| 修改 | backend/app/modules/llm_provider/service.py | create/update 赋值 + _to_read 透传 + probe 链 model 取值切「主模型派生」（:358 读 row.model，N-2）；fetch_models 返回形态不动（前端拉取后自加行） |
| 修改 | backend/app/modules/llm_provider/router.py | quota 链 query_zhipu_quota(model=…) 取值切主模型派生（:151 读 row.model，N-2 列删除后 AttributeError） |
| 修改 | backend/app/modules/llm_provider/litellm_client.py | Grill P1-4：register 的 model 取值改「主模型派生」（:84 读 provider.model 会 AttributeError） |
| 修改 | backend/app/modules/daemon/lease/context.py | 两处 resolve：provider_config 下发 model_role_mappings（由条目 roles+one_m 折算，形态与 daemon 消费面逐字一致）+ model/default_fallback_model（主模型派生）+ models 原始列表。数据流：producer=服务端折算 → claim payload → daemon injector（consumer，规则 3/4/5 消费键不变） |
| 修改 | backend/app/modules/session_attachment/capability.py | 门控改「生效模型 ∈ provider.models 条目」三态判定；未命中保守 false；旧 multimodal 字段读取删除 |
| 修改 | backend/app/modules/daemon/session/service/inject_gates.py | 会话选模型非空时 ∈ 列表校验（422 带可用模型提示）；claim model 派生 |
| 修改 | backend/app/modules/daemon/session/service/create.py | 会话创建 model 字段同款校验（若创建即带模型） |
| 修改 | backend/app/modules/agent/schema.py | provider_config DTO 文档串更新（models 键 + 折算键说明） |
| 修改 | backend/openapi.json | gen:types 再生成 |
| 修改 | frontend/src/lib/api-types.ts | gen:types 再生成 |
| 修改 | frontend/src/lib/api/llm-providers.ts | ProviderModelEntry TS 类型 + Read/Create/Update.models + FormValues.models |
| 修改 | frontend/src/components/llm-providers/llm-provider-form.tsx | 模型列表编辑器（行内 name/三态/角色标签/one_m/删行 + 添加 + fetch 一键加入）；旧 4 槽 UI 退役 |
| 修改 | frontend/src/components/sessions/session-config-bar.tsx | 模型下拉源改 provider.models |
| 修改 | frontend/src/components/agent-profile-form.tsx | 模型选择源同改（如有该面） |
| 修改 | frontend/src/components/sessions/ctx-usage-bar.tsx | 模型显示对齐列表条目（1M 判定链随 one_m 语义核对） |
| 修改 | frontend/src/components/llm-providers/llm-provider-list.tsx | 列表卡片模型展示改 models 列表（:53-54 消费旧 model 字段，Grill P1-4） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | :2641 消费旧模型字段（Grill P1-4 grep 证实） |
| 修改 | frontend/src/components/daemon/session-panel/page-helpers.tsx | :502/:541 消费旧模型字段（Grill P1-4） |
| 修改 | backend/app/modules/daemon/attachment_pipeline.py | 门控调用透传 model_name（P1-3 调用链） |
| 修改 | backend/app/modules/daemon/group/service/shadow.py | 群聊成员门控透传各会话模型（P1-3） |
| 修改 | frontend/src/app/m/workspaces/[id]/sessions/[sid]/page.tsx | 移动端会话模型选择同源（grep 复核触点，R-08 清零核对） |
| 修改 | backend/app/modules/llm_provider/tests/（多文件） | 服务层/折算/校验用例 |
| 修改 | backend/app/modules/daemon/tests/test_resolve_default_provider_config.py | 注入折算断言（含 bound 侧同改） |
| 修改 | backend/app/modules/daemon/tests/test_resolve_bound_provider_config.py | bound 路径折算断言 |
| 修改 | backend/tests/modules/daemon/lease/test_provider_config_payload.py | claim payload 契约（两键同值 + models 键） |
| 修改 | backend/app/modules/session_attachment/tests/test_capability.py | 门控三态×列表用例 |
| 修改 | frontend/src/components/llm-providers/__tests__/ | 表单编辑器用例 |

（已核查无需改动：sillyhub-daemon 仓全部——injector 消费键 model/model_role_mappings/default_fallback_model 形态逐字保留。probe/quota 链的 row.model 取值切换已入 service.py/router.py 清单行，N-2。）

## 接口定义

本变更接口面：0 端点。

- `ProviderModelEntry`: `{ name: str, multimodal: "auto"|"true"|"false" = "auto", roles: list["sonnet"|"opus"|"fable"|"haiku"] = [], one_m: bool = false }`
- `LlmProviderCreate.models: list[ProviderModelEntry] = []`；`Update.models: list[...] | None`；`Read.models: list[...]`
- provider_config（claim 下发）：**新增 `models` 键**（原始列表）；`model` / `default_fallback_model` = 主模型派生（会话所选优先）；`model_role_mappings` 键**形态不变**（值由条目折算 `{role: {model, one_m}}`）

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| claim lease | daemon | backend | leaseId, claimToken, provider_config(models + 折算键形态不变) | pending → running（仅 provider_config 内模型面扩充，事件结构/时序零变化） |

本表仅声明受影响面：claim/会话生命周期不变；daemon injector 消费键（model/model_role_mappings/default_fallback_model）形态逐字保持。

## 数据模型

llm_providers：删 `model VARCHAR(128)` / `model_role_mappings JSON` / `multimodal VARCHAR(8)` / `default_fallback_model VARCHAR(128)` 四列，加 `models JSON NOT NULL`（list[dict]）。索引无涉。存量折算语义见总体方案 Wave1-1。

## 兼容策略（brownfield 必填）

- 项目未上线无过渡期：API 直接切换 models 列表（旧四字段键从请求/响应消失），前后端同批收口（规则 11）。
- 存量供应商折算后行为等价面：主模型（sonnet 首条）= 旧 model 语义；4 档 env = 旧角色槽语义；门控 auto = 旧 auto 供应商级语义（启发式同函数）——**唯一行为变化**：旧供应商级 multimodal=true/false 的显式标记折算后变 auto（粒度下沉的代价，D-004 接受：显式标记过的供应商编辑一次即恢复精确控制）。
- 会话存量 config_snapshot 里的旧 model 值：会话续聊时注入折算用列表派生主模型（快照 model 若在列表内则沿用会话所选）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 折算回填逻辑复杂（去重+角色归并+one_m）SQL 表达不了 | P2 | Python 侧逐行折算（迁移内 connection 循环，行数几百级无性能面）；折算测试覆盖单模型/多槽/one_m/空四形态 |
| R-02 | daemon 消费键形态漂移（折算器写出非预期形状） | P1 | 注入折算断言与现有 test_resolve_* 的 model_role_mappings 断言**逐字对比**（消费面契约测试锁定）；daemon diff=0 硬约束 |
| R-03 | 会话选了列表外模型（存量会话快照/并发编辑） | P2 | 非空校验 422（新请求）+ 门控未命中保守 false（存量会话）双防线 |
| R-04 | 前端模型列表编辑器交互复杂度（行内多控件） | P2 | 复用现有 antd 表单控件形态；表单测试覆盖增删行/角色标签/三态切换 |
| R-05 | 主模型派生规则歧义（无 sonnet 标记时） | P3 | 规则显式：sonnet 首条 ?? 列表首条；空列表 → 会话选模型提示先配（422 文案引导） |
| R-06 | 旧供应商级显式 multimodal 标记折算后变 auto（行为变化点） | P3 | D-004 已接受；兼容策略节明示；编辑一次即恢复 |
| R-07 | 门控新增 model_name 入参波及单聊/群聊两条调用链（Grill P1-3） | P2 | 两链文件入清单 + 门控用例覆盖链路；参数缺省 None 保持签名向后兼容 |
| R-08 | 前端旧三字段消费面编译破（4 文件漏改即 tsc 炸，Grill P1-4） | P2 | tsc 全绿门 + grep 四旧字段消费点清零核对入 tasks |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 彻底重构 | 数据模型 / Wave1 | 已覆盖 |
| D-002@v1 列表内标角色 | 条目结构 / Wave1-3 / Wave4-9 | 已覆盖 |
| D-003@v1 三态下沉积承 | 门控链 Wave2-6 | 已覆盖 |
| D-004@v1 存量自动折算 | 迁移 Wave1-1 / 兼容策略 | 已覆盖 |
| D-005@v1 JSON 列 | 数据模型 | 已覆盖 |

## 自审

- [x] 章节齐全（背景/目标/非目标/总体方案/文件清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-001~D-005
- [x] 生命周期关键词命中（claim/session）→ 含生命周期契约表
- [ ] UI 原型：模型列表编辑器为表单控件组形态变化（行内编辑），无新页面布局——不另出 HTML 原型；如评审认为列表编辑器交互复杂需原型再补（记风险 R-04）
- [x] 不确定问题标注：同角色多条取首条的宽容口径（表单提示不禁止）待 Grill 复核
