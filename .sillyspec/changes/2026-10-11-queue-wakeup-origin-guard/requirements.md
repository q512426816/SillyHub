---
author: flow-machine-draft
created_at: 2026-10-11T03:40:33.352Z
---
# 需求规格（Requirements）— 2026-10-11-queue-wakeup-origin-guard

## 功能需求

### FR-01: 用户消息的 [后台任务通知] 前缀不再享有任何豁免

- 用户经 `/inject` 端点发送的消息（无结构化 origin 标记）**必须**按普通用户消息计数：占满员额度（队满第 6 条 QueueFull）、不进通知合并分支、排队行 origin 为 NULL；**禁止**以消息内容前缀作为任何豁免/合并/计数排除的判定依据。

#### 场景：前缀伪造不豁免

- Given 会话忙轮且已有 5 条 pending 用户消息
- When 用户再发一条以 `[后台任务通知]` 开头的消息（Bearer、无 origin 字段）
- Then 抛 DaemonSessionQueueFull（第 6 条用户消息口径），不落通知合并行

### FR-02: 服务凭证通知注入豁免满员并按 origin 合并

- daemon 服务凭证注入（X-API-Key + `origin="task_wakeup"`）**必须**豁免满员检查、不计入用户额度、与既有 pending 的同 origin 行合并不新增行，且排队行 `origin` 落 `task_wakeup` 字面量。

#### 场景：队满后通知照常入队并合并

- Given 会话忙轮且已有 5 条 pending 用户消息 + 1 条 origin=task_wakeup 通知
- When 服务凭证再注入一条 origin=task_wakeup 通知
- Then 合并入既有通知行（不新增行、position 不变），用户后续消息额度口径仍是 5

### FR-03: 结构化 origin 标记仅限服务凭证携带

- `SessionInjectRequest` 新增可选 `origin: Literal["task_wakeup"]`；Bearer（浏览器 JWT）请求携带该字段**必须**被 403 拒绝（仅 X-API-Key 服务凭证可标记——API key 由 `api_key:admin` 门控签发给 daemon）；X-API-Key 与 Bearer 同时在场时按 `get_current_principal` 既有优先级视作 Bearer 用户（同样 403）。

#### 场景：Bearer 冒充标记被拒

- Given 任一活跃会话
- When 携带 `Authorization: Bearer …` 的请求体带 `origin="task_wakeup"`
- Then 403 PermissionDenied，无排队行/run 副作用

### FR-04: origin 字面量由 DTO 严格校验

- `origin` 字段**必须**为 `Literal["task_wakeup"]`：任意其它字符串（含空串）在 DTO 层 422，不进 service。

#### 场景：非法 origin 值

- When 请求体 `origin="admin"` 或 `origin=""`
- Then 422（pydantic Literal 校验）

### FR-05: 通知条目编辑保护改纯结构化 origin 判定

- 排队条目编辑守卫**必须**且仅按 `origin == "task_wakeup"` 拒绝（409）；内容前缀不再参与判定（存量前缀行与新伪造行形态不可区分，按规则 11 不做前缀兜底——pending 行生命周期天级、误放行影响仅限当条 prompt 文本）；**禁止**把普通用户消息（前缀伪造、origin NULL）误判为不可编辑。

#### 场景：两类行的编辑语义

- Given 两条 pending：A=origin task_wakeup、B=用户前缀伪造行 origin NULL（与升级在途存量行同形态）
- When 逐一编辑
- Then A 409、B 200 可编辑

### FR-06: 回归与新增用例全绿

- 既有 test_session_queue / test_session_queue_actions 中通知相关用例**必须**改结构化口径后全绿；**必须**新增前缀伪造（FR-01）、服务豁免与合并（FR-02）、HTTP 层门控（FR-03/04）、编辑三态（FR-05）用例，先红后绿。

#### 场景：先红后绿

- When 在旧实现上运行新增用例
- Then 前缀伪造豁免用例与 Bearer-origin 门控用例失败（红）；实现后全绿

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/app/modules/daemon/tests/test_session_queue.py「test_spoofed_prefix_message_consumes_user_quota_and_rejected」
FR-02: test/app/modules/daemon/tests/test_session_queue.py「test_wakeup_inject_succeeds_when_queue_full」
FR-02: test/app/modules/daemon/tests/test_session_queue.py「test_wakeup_entries_merge_by_origin」
FR-03: test/app/modules/daemon/tests/test_inject_origin_guard.py「test_bearer_with_origin_field_403」
FR-04: test/app/modules/daemon/tests/test_inject_origin_guard.py「test_origin_literal_validation_422」
FR-05: test/app/modules/daemon/tests/test_session_queue_actions.py「test_edit_wakeup_entry_rejected_409」
FR-05: test/app/modules/daemon/tests/test_session_queue_actions.py「test_edit_spoofed_prefix_user_entry_allowed」
FR-06: test/app/modules/daemon/tests/test_inject_origin_guard.py「test_api_key_origin_inject_marks_queue_row」
