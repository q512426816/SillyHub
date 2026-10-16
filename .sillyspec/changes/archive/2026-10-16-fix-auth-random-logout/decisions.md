---
author: qinyi
created_at: 2026-10-16 15:31:53
generated_by: sillyspec-fourpiece-init
change: 2026-10-16-fix-auth-random-logout
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: sessions 表增 family_id 列建模会话族
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: 「只吊销会话族」的"族"如何在数据模型上表达（现表无族系字段，backend/app/modules/auth/model.py:91-151）
- answer: 我的判断：sessions 表新增 nullable UUID 列 `family_id`。login 签发时生成新 uuid 作为族根；refresh 轮换/grace 续期签发的新 session 继承被消费 session 的族（`family_id ?? id` 兜底存量 NULL 行——旧行自成一族）。族查询条件 `user_id=? AND revoked_at IS NULL AND (family_id=? OR (family_id IS NULL AND id=?))`，复用既有索引 ix_sessions_user_revoked，不加新索引（每用户 session 行数少）。迁移走 alembic 增量加列（PPM 已上线有生产数据，禁重置；加列 nullable 零停机零强制登出）
- normalized_requirement: alembic 迁移为 sessions 加 family_id UUID NULL 列；_issue_token_pair 接受 family 参数；login=新族、refresh/grace=继承族
- impacts: [FR-01, FR-02, task-01, task-02]
- evidence: backend/app/modules/auth/model.py:91-151（现列集）、backend/app/modules/auth/service.py:329-361（_issue_token_pair）、.claude/CLAUDE.md 规则11（PPM 已上线）
- 故障面: family_id 写错族会把无关设备牵连进吊销面（与旧全吊销等价），靠 FR-02 测试族隔离性兜底
- 退役判据: 若未来引入服务端全设备会话管理 UI 且要求误杀面趋零，可评估改为「复用检测仅拒绝不吊销」

## D-002@v1: refresh 复用检测从全用户吊销改为族级吊销
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 旧 refresh token 超 grace 窗复用时吊销范围（现行 revoke_all_user_sessions 全用户团灭，backend/app/modules/auth/service.py:424-429）
- answer: 用户已定向（「复用检测只吊销会话族」）：复用检测分支改调新增的 `_revoke_session_family(user_id, family)`，只吊销该 token 所属族系（含其后代——攻击者用窃取 token 轮换出的新 session 同族，同样被灭，安全属性保留）；其他设备/其他登录族不受影响。`revoke_all_user_sessions` 方法保留（改密码场景 service.py:243 注释已说明另有内联实现；admin/settings 端点走 UserService.revoke_all_sessions 不受影响）。AuthRefreshReused 报错文案同步改「该设备登录已注销」（原「所有会话已注销」不再准确）
- normalized_requirement: 复用超 grace → 仅 (user_id, family) 范围 session 置 revoked_at；同用户异族 session 存活；仍抛 AuthRefreshReused 401
- impacts: [FR-02, FR-03, task-02, task-04]
- evidence: backend/app/modules/auth/service.py:408-429（复用分支）、backend/app/modules/admin/router.py:560-572 + backend/app/modules/settings/router.py:370-377（管理端点走 UserService，语义保留）、用户本轮指令
- 故障面: 攻击者在 grace 窗内重放仍可得新对（既有 grace 权衡，不变）；grace 窗外重放只灭单族，若攻击者已独立另行登录（异族）不受牵连——可接受（异族本就是合法登录）
- 退役判据: 出现实际窃取事故且需要全设备熔断时，可配置回退全吊销

## D-003@v1: grace 宽限窗默认 60s → 300s
- type: boundary
- priority: P1
- status: accepted
- source: code
- question: 宽限窗是否加大（用户「评估加大宽限窗」，授权评估）
- answer: 我的判断：`auth_refresh_grace_seconds` 默认 60 → 300（config 上限 le=600 内）。依据：休眠唤醒/后台标签页节流恢复后旧 token 复用常超 60s；300s 覆盖典型恢复窗口，且族级吊销上线后超窗误杀的爆炸半径已缩到单设备，双保险。攻击者在窗内重放可换新对是既有权衡，内部平台威胁模型可接受
- normalized_requirement: config.py 默认值 60→300；deploy/.env 未覆盖该项（无需改）；既有 grace=0 退化行为保留
- impacts: [FR-03, task-03]
- evidence: backend/app/core/config.py:160-168（le=600）、frontend/src/stores/session.ts:4-14（历史根因注释）

## D-004@v1: 前端 doRefresh 按状态码分流——5xx 抛错不清会话
- type: architecture
- priority: P1
- status: accepted
- source: user
- question: 前端 refresh 请求收到非 2xx 时如何区分「登录态真失效」与「链路临时故障」（现行 `if (!resp.ok) return null` 一律清会话跳登录，frontend/src/lib/token-refresh.ts:86）
- answer: 用户已定向（「对 5xx 不清会话」）：doRefresh 分流——2xx → 返回 token 对；401/403/其余 4xx → 返回 null（上层 clear+redirect，明确失效）；5xx/408/429 → 抛 ApiError（对齐 ql-20260917-005 timeout 先例：抛错路径不清会话、不跳登录，调用方 catch 展示可重试错误）。app-shell.tsx:216 主动续票已有 .catch(() => {}) 兜底；api.ts 401 收口处 await 抛错时原 401 ApiError 被 refresh 错误替代传播（与 timeout 行为一致）
- normalized_requirement: vitest 断言 503/504 → 抛 ApiError 且 useSession 未 clear；401 → null；2xx → token 对
- impacts: [FR-04, FR-05, task-05, task-06]
- evidence: frontend/src/lib/token-refresh.ts:56-96（doRefresh）、frontend/src/lib/api.ts:229-257（401 收口）、frontend/src/components/app-shell.tsx:195-225（catch 兜底）、用户本轮指令
- 故障面: 5xx 时原 401 错误被替换为 refresh 5xx 错误展示（与 timeout 先例一致，可接受）；瞬时 5xx 期间页面报错但登录态保留，恢复后自愈
- 退役判据: 后端或代理层能保证 refresh 请求不经受 5xx/网络抖动窗口（如本机直连）时，可收敛为单一 null 语义

## D-005@v1: 根因一实现方案选 A（会话族吊销 + 宽限窗加大）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 根因一（旧 refresh token 超窗复用误判被盗→全设备登出）后端实现方案取舍（A 族级吊销 / B 只加大宽限窗 / C 复用只拒绝不吊销）
- answer: 用户选 A：sessions 加 family_id 建模会话族，复用检测只吊销该族（窃取凭证换出的后代同族同灭，安全属性保留），宽限窗 60→300s 双保险。理由要点：B 治标（全吊销语义未变，超 600s 上限仍团灭）；C 丢失窃取响应（纯拒绝弱于 BCP 族级吊销标准）
- normalized_requirement: 实现按 D-001/D-002/D-003 组合执行
- impacts: [FR-01, FR-02, FR-03]
- evidence: 方案选择轮（AskUserQuestion 2026-10-16）
- 故障面: family 谓词或族继承写错时，误杀面在「全用户」与「单设备」之间漂移（靠 FR-01/FR-02 测试网兜底）
- 退役判据: OAuth BCP 实现升级为服务端 per-token introspection 后可重估

## D-006@v1: 方案 B（只加大宽限窗，不加族系列）
- type: architecture
- priority: P0
- status: rejected
- source: user
- question: 同 D-005 取舍问句
- answer: 落选：一行配置改动最小，但「全用户吊销」语义未变——休眠/离线超过宽限上限（config le=600 即 10 分钟）仍全设备团灭；且单纯加宽窗口给真实窃取者更长重放窗口，治标不治本
- normalized_requirement: 不采用
- impacts: []
- evidence: 方案选择轮（AskUserQuestion 2026-10-16）
- 否决理由: 全吊销语义未根除，仅推迟触发；安全与可用性双输
- 复潮条件: 若后端禁止 schema 变更（如生产库冻结期）且急需止血，可作为临时缓解先上线

## D-007@v1: 方案 C（复用检测只拒绝不吊销）
- type: architecture
- priority: P0
- status: rejected
- source: user
- question: 同 D-005 取舍问句
- answer: 落选：误杀面归零且零迁移，但丢失对凭证窃取的安全响应——OAuth BCP 对 refresh 轮换复用的标准响应是吊销 token family，纯拒绝使攻击者已换出的新凭证不受影响，安全姿态弱化
- normalized_requirement: 不采用
- impacts: []
- evidence: 方案选择轮（AskUserQuestion 2026-10-16）
- 否决理由: 安全响应弱于 BCP 族级吊销标准
- 复潮条件: 平台威胁模型明确接受弱响应（如纯内网无外部暴露）且要求零 schema 变更时

## D-008@v1: 族吊销必须内部 commit（执行期裁决，纠正 design 笔误）
- type: consistency
- priority: P0
- status: accepted
- source: design-grill
- question: design 原文写 `_revoke_session_family` 「不提前 commit（refresh 链统一 commit）」——与代码现实矛盾（非破坏性执行期裁决）
- answer: 内部 commit（对齐 revoke_all_user_sessions 既有语义）。依据：复用分支 UPDATE 后立即 raise AuthRefreshReused，而 get_session 依赖对异常路径 session.rollback()（backend/app/core/db.py:163-167）——不先行提交则族吊销被回滚成空操作（安全响应静默丢失）。design.md 对应措辞已同步修正
- normalized_requirement: _revoke_session_family 内 await self._db.commit()；测试断言复用后族内 revoked_at 非空（跨请求持久性）
- impacts: [FR-02, task-02]
- evidence: backend/app/core/db.py:163-167、backend/app/modules/auth/service.py:238-286（新增方法注释）
