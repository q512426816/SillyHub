---
author: flow-machine-draft
created_at: 2026-10-21T03:16:10.861Z
---
# 需求规格（Requirements）— 2026-10-21-provider-set-default-ui

## 功能需求

### FR-01: /settings/providers 供应商列表有「设为默认」操作，已设默认的行有明确默认标记，且有对称「取消默认」操作

- 供应商列表每行**必须**提供「设为默认」操作；`is_default=true` 的行**必须**显示「默认」徽标并将该操作替换为「取消默认」；两操作文案统一为「设为默认 / 取消默认」（与档案侧后续变更同文案）。

#### 场景：设为默认主路径

- Given：列表 ≥2 条供应商且当前无默认行
- When：用户点击某行「设为默认」且后端返回 `switched=true`
- Then：列表刷新后该行显示「默认」徽标、操作变为「取消默认」，其余行无徽标

#### 场景：取消默认

- Given：某行 `is_default=true`
- When：用户点击该行「取消默认」且后端返回成功
- Then：列表刷新后徽标消失、操作恢复「设为默认」

#### 场景：凭证探测失败

- Given：目标供应商 base_url/API Key 无效
- When：用户点击「设为默认」且后端返回 `switched=false` + `error`
- Then：列表默认状态不变，toast 展示后端 error 原因

### FR-02: set/unset-default 收敛为仅置位——移除运行中会话热切换，只对新会话生效（用户 2026-10-21 拍板，否决原「保留热切换」倾向 D-001）

- 后端 `set_default` / `unset_default` **必须**移除热切换推送（WS `PROVIDER_CONFIG_CHANGED`）；操作仅变更 `is_default`，`affected_sessions` **必须**恒为 0；运行中会话**禁止**被波及（保持原供应商），新会话经既有 claim 链路按新默认注入。前端**必须**调用既有端点并按 `switched` / `error` 反馈，成功 toast 文案为「已设为默认，新会话生效」。`SetDefaultResult` 三字段 schema **禁止**变更（兼容）。

#### 场景：运行中会话不受影响

- Given：用户存在运行中的交互会话（供应商 A）
- When：设供应商 B 为默认成功
- Then：运行中会话继续使用 A，之后新建的会话经 claim 注入 B；响应 `affected_sessions=0`

#### 场景：取消默认

- Given：默认行存在且活跃会话正使用它
- When：取消默认成功
- Then：运行中会话不变，新会话回落本机凭证（claim 无默认不注入）

### FR-03: 会话未显式选供应商时注入用户默认供应商凭证，未设默认回落本机（既有 claim 链路，UI 加回即通）

- 该行为为既有 claim 链路（`_inject_provider_config` 按 `user_id + is_default` 注入，无默认则不注入 provider_config 走 daemon 本机凭证），本变更**禁止**触碰该 claim 注入链路；本变更通过恢复 UI 入口使 `is_default` 可被用户配置，并通过 FR-02 收敛 set/unset 端点行为使默认变更仅对新会话生效。

#### 场景：零回归

- Given：既有后端 claim 注入链（`_inject_provider_config` / `resolve_default_provider_config`）
- When：本变更收口
- Then：claim 注入链零触碰（本变更的后端改动仅限 set/unset 端点行为收敛，见 FR-02）

### FR-04: 新增/更新前后端测试覆盖

- 前端**必须**覆盖 API 封装（set/unset-default 的 URL/method/返回解析）与列表交互（设默认/取消默认/徽标/探测失败 toast），既有「无启动/停止按钮」回归断言**必须**同步翻转为「设为默认/取消默认」断言；后端**必须**覆盖「set/unset 后不推送热切换、`affected_sessions=0`」断言（既有 mock 夹具上收紧）。

#### 场景：默认行渲染

- Given：mock listProviders 返回两条（一条 `is_default=true`）
- When：渲染列表
- Then：默认行显示徽标与「取消默认」，非默认行显示「设为默认」

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx「设为默认成功显示徽标并刷新」「取消默认恢复设为默认」「凭证探测失败 toast 错误且状态不变」
FR-02: backend/app/modules/llm_provider/tests/test_llm_provider.py「set/unset 后 affected_sessions=0 且 notify_provider_switch 未被调用」；backend/app/modules/llm_provider/tests/test_router.py「set-default/unset-default 端点返回 affected_sessions=0」
FR-03: 不适用：claim 注入链路（`_inject_provider_config`）本变更零触碰，行为由既有测试锚定；FR-02 的后端测试仅锚定 set/unset 端点行为收敛
FR-04: frontend/src/lib/api/__tests__/llm-providers.test.ts「setDefaultProvider/unsetDefaultProvider 请求形态与返回解析」
