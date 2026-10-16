---
author: qinyi
created_at: 2026-10-16 15:37:41
generated_by: sillyspec-design-init
scale: large  # 用户显式要求完整流程（后端吊销语义属安全语义调整，CLAUDE.md 规则3）；后端簇与前端簇是可真并行的独立任务簇（不同子项目零共享文件），详见「总体方案」
---

# 设计文档（Design）— 2026-10-16-fix-auth-random-logout

## 背景

用户报告"登录的账户有时候莫名其妙被退出登录"。排查确认两个代码层根因：

1. **根因一（后端误杀）**：refresh token 轮换后，旧 token 超过 60 秒宽限窗再被使用时，`backend/app/modules/auth/service.py:424-429` 判定为重放攻击并吊销**该用户全部会话**。多标签页各持一份 token 副本、电脑休眠/后台标签页节流恢复等场景下，旧副本超窗提交即全设备团灭。`frontend/src/stores/session.ts:4-14` 注释自认这是"多标签页被周期性踢回登录页的根因"，历史上修过两轮（6e285779d、8b8f02856），残留触发面仍宽。
2. **根因二（前端过度登出）**：`frontend/src/lib/token-refresh.ts:86` 的 `if (!resp.ok) return null` 把 refresh 请求收到的一切非 2xx（含部署窗口/代理抖动的 502/503/504）都当作"登录态失效"，上层 `frontend/src/lib/api.ts:249-256` 清空会话并整页跳登录页——而凭证实际仍有效。

用户已选定方案（D-005）：根因一用"会话族吊销 + 宽限窗加大"治本，根因二按状态码分流治前端。

## 设计目标

- 旧 refresh token 超窗复用时，只吊销其所属**会话族**（同一次登录衍生的全部 session），同用户其他设备/其他登录不受牵连；窃取凭证换出的新 session 同族同灭，安全属性不降级。
- 宽限窗默认 60s → 300s，覆盖典型休眠/后台恢复窗口（D-003）。
- 前端 refresh 请求遇 5xx/408/429 时保留登录态、抛可重试错误，只有明确的 4xx 失效（401/403）才清会话跳登录（D-004）。

## 非目标

- 不改 access token TTL（30min）与 refresh TTL（14 天）。
- 不引入 cookie/SSO，不改变 token 传输方式（Bearer header 不变）。
- 不改管理员"踢全部会话"端点语义（admin/settings 走 UserService.revoke_all_sessions，保留全吊销）。
- 不改 HTTP API 请求/响应结构（无 gen:types 义务，frontend 与 daemon 的 api-types.ts 均不动）。
- 不做前端 BroadcastChannel 跨标签页选主（storage 事件同步已存在，本变更后端侧止血后不再必要）。

## 拆分判断

单一主题（登录态误踢）双模块（backend auth + frontend lib），因果同源、验收耦合（复现路径跨前后端），不拆分为两个变更；任务量小（后端 1 簇 + 前端 1 簇，合计 <10 任务），不适用批量模式。

## 总体方案

### Phase 1 后端——会话族建模与族级吊销（对应 D-001/D-002/D-003）

1. `sessions` 表新增 `family_id UUID NULL` 列（alembic 增量迁移）。login 签发时 `family_id = uuid4()` 开新族；refresh 轮换与 grace 续期签发的新 session 继承被消费 session 的族，兜底表达式 `family_id or id`（存量 NULL 行自成一族）。
2. `_consume_refresh_token` 复用检测分支改调新增的 `_revoke_session_family(user_id=revoked.user_id, family=revoked.family_id or revoked.id)`（**调用处实参表达式必须带 `or revoked.id` 兜底**——design Grill 追问 B-001：存量 NULL 行取 `revoked.family_id or revoked.id`，只写 `revoked.family_id` 会 fail-open 吊销 0 行）：`UPDATE sessions SET revoked_at=now WHERE user_id=:uid AND revoked_at IS NULL AND (family_id=:f OR (family_id IS NULL AND id=:f))`。`revoke_all_user_sessions` 方法保留（无其它调用方，防将来复用语义混淆，注释标明用途已收窄）。
3. `AuthRefreshReused` 文案改"登录凭证已被使用过（可能存在安全风险），该设备的登录已注销，请重新登录。"
4. `config.py` `auth_refresh_grace_seconds` 默认 60 → 300（上限 le=600 不变），description 同步。
5. 复用既有索引 `ix_sessions_user_revoked`（每用户 session 行数少，族谓词在 user_id 过滤后残余行数个位数），不加新索引。

### Phase 2 前端——refresh 状态码分流（对应 D-004）

1. `token-refresh.ts` `doRefresh` 按状态码分流（**归类优先级：抛错枚举优先于「其余 4xx→null」——先判 5xx/408/429 抛错，其后才落入 401/403/其余 4xx→null**；design Grill 追问 B-002）：2xx → 返回 token 对；401/403 及其余 4xx → 返回 `null`（明确失效，上层清会话）；**5xx / 408 / 429 → 抛 `ApiError`**（沿用 ql-20260917-005 timeout 先例的抛错通道：不清会话、不跳登录，错误体带实际状态码与消息）。
2. `api.ts` 401 收口代码不变（`null` 才 clear+redirect，抛错自然向调用方传播），仅同步契约注释。
3. 审计全部 `ensureFreshAccessToken` 调用点（13 处，含 file/api.ts 上传与下载两处；design Grill 实测口径）对抛错的容错：`app-shell.tsx:216` 已有 `.catch(() => {})`；其余各 lib 调用点均为"401 → 刷新 → 重试"模式，抛错传播为请求失败（用户可重试），execute 阶段逐一确认无未处理 Promise 拒绝。

### Wave 组织（scale=large 依据）

Wave 1（后端簇，可独立交付）：model + migration + service + config + 后端测试。Wave 2（前端簇，可独立交付）：token-refresh + api 注释 + 前端测试 + 调用点审计。两簇文件零交集、可真并行；因总量小实际可单会话顺序执行，Wave 边界作为验收切分点保留。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/auth/model.py | Session 模型加 `family_id: uuid.UUID \| None` 列（String→Uuid 同 id 列范式，nullable） |
| 新增 | NEW:backend/migrations/versions/20261016xxxx_add_sessions_family_id.py | alembic 增量迁移：`add_column sessions family_id UUID NULL`（版本号按迁移链头实际生成） |
| 修改 | backend/app/modules/auth/service.py | `_issue_token_pair` 加 `family_id` 参数；`refresh` 传族（`session.family_id or session.id`）；复用分支改调新增 `_revoke_session_family`；`AuthRefreshReused` 文案；`revoke_all_user_sessions` 用途注释收窄 |
| 修改 | backend/app/core/config.py | `auth_refresh_grace_seconds` 默认 60 → 300，description 更新 |
| 新增 | NEW:backend/tests/modules/auth/test_refresh_family_revocation.py | 族语义测试（见下） |
| 修改 | backend/tests/modules/auth/test_refresh_grace_window.py | 复用检测用例的"全用户吊销"断言改为族断言（规格按 D-002 变更，测试随规格走） |
| 修改 | frontend/src/lib/token-refresh.ts | `doRefresh` 状态码分流（5xx/408/429 抛 ApiError） |
| 修改 | frontend/src/lib/api.ts | 401 收口契约注释同步（代码不变） |
| 修改 | frontend/src/lib/__tests__/token-refresh.test.ts | 增分流用例（503/504 抛错不清会话、401 返 null、2xx 返对） |
| 修改 | .sillyspec/docs/multi-agent-platform/flows/auth-flow.md | verify 阶段同步：TTL 数字纠错（15min/7d → 30min/14d）+ 复用响应改族级吊销 + 宽限窗 300s |

无对外字段/DTO/事件 payload 变更（family_id 是纯库内列，不出现在任何 API 面），无 producer→consumer 数据流标注义务。

## 接口定义

本变更接口面：0 端点（无接口变更）——HTTP API 路由、请求/响应 schema 均不动。内部方法签名变化：

```python
# backend/app/modules/auth/service.py
async def _issue_token_pair(
    self, user: User, *, user_agent: str | None, ip: str | None,
    family_id: uuid.UUID | None = None,   # 新增：None=开新族（login）；refresh 传继承族
) -> TokenPair: ...

async def _revoke_session_family(self, *, user_id: uuid.UUID, family: uuid.UUID) -> int:
    """复用检测专用：吊销 (user_id, family) 范围内存活 session，返回吊销数。"""
```

```typescript
// frontend/src/lib/token-refresh.ts — doRefresh 返回契约
// 2xx → SessionTokens；401/403/其余 4xx → null（明确失效）；5xx/408/429/超时 → throw ApiError（瞬态故障，不清会话）
```

## 生命周期契约表

本变更直接触碰 `sessions` 行状态机，契约如下（关键词命中 session，必填）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| login | frontend | backend auth | username/password → TokenPair | 新 session（family_id=新 uuid，live） |
| refresh rotate | frontend | backend auth | refresh_token（live） | 旧 session live→revoked+rotated；新 session（继承族，live） |
| refresh grace | frontend | backend auth | refresh_token（rotated 且 <300s） | 新 session（继承族，live）；旧保持 revoked+rotated 不刷新 rotated_at |
| reuse detected | frontend（旧 token） | backend auth | refresh_token（rotated 且 ≥300s） | **族内全部 live→revoked**（旧语义：全用户）；返 401 AuthRefreshReused |
| logout | frontend | backend auth | refresh_token | 该 session live→revoked（不写 rotated_at，不参与 grace） |
| admin revoke-all | admin UI | backend users | user_id | 该用户全部 live→revoked（**语义保留**，走 UserService） |
| change password | frontend | backend auth | old/new password | 该用户全部 live→revoked（**语义保留**） |

表内每个事件均有对应代码任务（task-01/02/03 后端、task-05 前端）与测试任务（task-04/06）；必需字段均为既有字段，无新增 DTO。

## 数据模型

`sessions` 表（backend/app/modules/auth/model.py:91-151）新增：

```python
family_id: uuid.UUID | None = Field(
    default=None,
    sa_column=Column(Uuid(as_uuid=True), nullable=True),
)
```

- 语义：同一次登录衍生的全部 session 共享一个族值；`NULL` = 存量旧行，读取侧以 `family_id or id` 兜底（自成一族）。
- 迁移：alembic `add_column("sessions", sa.Column("family_id", Uuid(), nullable=True))`；不回填（旧行 NULL 即设计语义）；PPM 生产库在线加 nullable 列零锁表风险（PG 11+ 默认 fast add）。
- 索引：不加新索引，复用 `ix_sessions_user_revoked`（user_id, revoked_at）。

## 兼容策略（brownfield 必填）

- **存量数据**：迁移前已存在的 session 行 `family_id=NULL`，运行时按"自成一族"处理——其后续 refresh 衍生的新行会写入 `family_id=旧行id`，族语义从首次 refresh 起自然收敛；旧行本身的复用检测只灭它自己一族。无强制登出、无数据回填。
- **配置回退**：`AUTH_REFRESH_GRACE_SECONDS=60`（或 0）可随时经 env 恢复旧行为（grace=0 退化为无宽限，既有语义保留）。
- **不改变的 API/表**：HTTP 接口零变化；users/roles/api_keys 等表不动；`revoke_all_user_sessions`、`UserService.revoke_all_sessions`、改密码全吊销语义均保留。
- **前端旧版兼容**：后端先行上线、前端未更新时，行为 = 根因一已修（族级吊销）而根因二仍在（5xx 误清）——无破坏性交互，两 Phase 独立可交付。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 存量 NULL 族兜底（`family_id or id`）边界写错会把无关设备牵连或漏灭本族 | P1 | FR-02 专测：legacy NULL 行复用只灭自身族、其衍生子代同灭、异族存活 |
| R-02 | 前端 5xx 抛错替换原 401 错误展示，用户看到"刷新失败"而非原业务错误 | P2 | 接受：与 ql-20260917-005 timeout 先例一致，瞬态错误可重试自愈 |
| R-03 | grace 300s 窗内真实窃取者重放可得新 token 对 | P2 | 接受：既有 grace 权衡的窗口参数化放大，内部平台威胁模型可承受；族级吊销已把超窗爆炸半径缩到单设备 |
| R-04 | 12 处 `ensureFreshAccessToken` 调用点存在未 catch 抛错的未处理拒绝 | P1 | task-06 逐一审计（app-shell 已确认有 catch）；vitest 对代表性路径断言不 clear |
| R-05 | auth-flow.md 现有 TTL 数字（15min/7d）与代码（30min/14d）不一致，本变更若只改语义不纠数字会延续债 | P2 | verify 阶段同文档一并修正（文件清单已含） |
| — | 非功能生命周期：无长驻进程/外部资源，生命周期面不适用（本变更不引入后台任务/文件锁/子进程；sessions 清理机制无变化） | — | 不适用（无外部资源可管理） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 数据模型节 + Phase 1 第 1 条 + task-01/02 | 已覆盖 |
| D-002@v1 | 生命周期契约表 reuse 行 + Phase 1 第 2/3 条 + task-02 + FR-02 | 已覆盖 |
| D-003@v1 | Phase 1 第 4 条 + 兼容策略（env 回退） + task-03 + FR-03 | 已覆盖 |
| D-004@v1 | Phase 2 第 1 条 + 接口定义 ts 契约 + task-05/06 + FR-04/05 | 已覆盖 |
| D-005@v1 | 总体方案（A 方案组合 = D-001+D-002+D-003） | 已覆盖 |
| D-006@v1 | rejected 落选方案（只加宽限窗），无覆盖义务——防复潮留档 | 已覆盖（rejected 留档） |
| D-007@v1 | rejected 落选方案（只拒绝不吊销），无覆盖义务——防复潮留档 | 已覆盖（rejected 留档） |

无未解决决策。多裁定组合推演：D-002（族级吊销）× D-003（grace 300s）组合——grace 窗内复用走 grace 分支（不吊销）与族级吊销互斥不叠加；grace=0 × 族级吊销 = 立即族灭（不退化回全用户吊销），组合无死锁/矛盾格。无其它相互约束裁定。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at/scale=large 附依据）
- [x] 引用所有当前版本 D-001@v1 ~ D-007@v1
- [x] 涉及生命周期关键词（session）→ 已含「生命周期契约表」
- [x] UI 原型分级：跳过——纯后端与前端 lib 逻辑，无任何界面变化（用户已在设计确认轮认可）
- [x] 无「⚠️ 自审存疑」项（三个替做决定均已经用户确认轮点头）
