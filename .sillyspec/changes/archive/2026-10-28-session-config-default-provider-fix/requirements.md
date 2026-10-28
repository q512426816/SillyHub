---
author: flow-machine-draft
created_at: 2026-10-28T03:11:53.137Z
---
# 需求规格（Requirements）— 2026-10-28-session-config-default-provider-fix

## 功能需求

### FR-01: pi 会话/预会话下供应商控件显示按引擎（agent_kinds）过滤后的默认供应商名，无引擎匹配默认时显示「本机默认」而非 claude/codex 供应商名

- 供应商控件的默认兜底显示与「不指定」兜底文案**必须**只取 `agent_kinds` 覆盖当前会话引擎的默认供应商（与后端 claim 默认注入链同口径）；引擎未定（null）时**必须**维持不过滤的旧行为。

#### 场景：主路径

- Given 用户默认供应商 `agent_kinds=[claude,codex]` 且会话引擎为 pi
- When 渲染会话配置条
- Then 供应商按钮显示「本机默认」，下拉兜底项为「不指定（本机默认）」（不误示跨引擎默认名）

### FR-02: 未显式选供应商但存在引擎匹配的默认供应商时模型下拉渲染且候选跟随该供应商模型列表，显式选择行为与请求载荷不变（不新增 llm_provider_id 上送）

- 未显式选择供应商（无暂存、会话值为 null）且存在引擎匹配默认供应商时，模型子下拉**必须**渲染且候选跟随该默认供应商的模型列表；该回退**禁止**改变显式选择/暂存语义与请求载荷（创建/发送仍不带 llm_provider_id）。

#### 场景：主路径

- Given provisional 预会话、未选供应商、存在 agent_kinds 含当前引擎的默认供应商
- When 渲染配置条
- Then 模型下拉渲染，候选 = 该供应商模型列表（首项「默认」），点选走既有暂存通道

### FR-03: 工作区弹窗（dialog 模式）新建会话首句携带用户填写的模型值（有值才带，空值零回归）

- dialog 模式首句 createSession **必须**携带非空的「智能体模型」覆盖值（model prop）；model 为 null/空**必须**不进请求体（载荷形态与现状逐字节一致）。

#### 场景：主路径

- Given dialog 面板 model prop = "glm-4.7"
- When 用户发送首句创建会话
- Then createSession 请求体含 `model: "glm-4.7"`；model 为 null 时请求体无 model 键

### FR-04: session-config-bar 与 session-panel-dialog 相关既有测试不回归，新增用例覆盖上述三点

- 收口前**必须**跑触达文件相关测试并全绿；新增用例**必须**覆盖 FR-01/02/03 的正向与零回归负例。

#### 场景：主路径

- Given 本次改动触达的三个测试文件（session-config-bar / llm-providers / session-panel-dialog）
- When vitest run 执行
- Then 全部通过（本次实测 173 passed），触达文件 eslint 0 error

### FR-05: 排队派发链路核查：运行中暂存配置随排队消息派发时生效（reloadWithConfig 先重载后喂消息），与用户期望「agent 接收到新消息时切换」一致，结论落档不改动切换时序

- 切换时序**必须**保持「agent 接收到新消息时才切换」现状（daemon reloadWithConfig 先重载配置后喂 prompt）；本变更**禁止**触碰 backend/daemon 切换时序代码，核查结论**必须**落档变更目录。

#### 场景：主路径

- Given 运行中会话 + 用户暂存新供应商/模型并发送（消息入队）
- When 当前轮结束、队列派发该消息
- Then daemon 先 reloadWithProvider/reloadWithConfig（新配置生效）后把 prompt 喂给 agent——派发的那条消息即用新配置（queue-dispatch-audit.md 锚点走读）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「pi 会话 + 默认供应商不覆盖 pi（agent_kinds=[claude,codex]）→ 按钮显示『本机默认』，不误示该供应商名」
FR-01: frontend/src/lib/api/__tests__/llm-providers.test.ts「engine 参数：默认供应商覆盖引擎 → 其名；不覆盖（跨引擎默认）→ 『不指定（本机默认）』」
FR-02: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「pi 会话 + 默认供应商覆盖 pi（agent_kinds 含 pi）→ 按钮显示该供应商名 + 模型下拉渲染且候选跟随」
FR-02: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「provisional（预会话）未选供应商 + 引擎匹配默认存在 → 模型下拉渲染，候选跟随默认供应商」
FR-02: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「claude 会话未显式选供应商 + 引擎匹配默认存在 → 模型下拉渲染，『不指定』项保持当前高亮（显示层回退不改选择语义）」
FR-03: frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx「首句创建时携带『智能体模型』覆盖值（model prop 非空随 createSession 上送）」
FR-03: frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx「model prop 为 null → createSession 载荷不带 model 键（空值零回归）」
FR-04: frontend 三测试文件全量跑（vitest 173 passed + eslint 0 error，触达六文件）
FR-05: 不适用：纯链路走读核查（代码锚点见变更目录 queue-dispatch-audit.md），无新可执行行为面；既有切换时序行为由 backend test_session_switch_config.py / daemon task-runner.test.ts 既有用例锚定
