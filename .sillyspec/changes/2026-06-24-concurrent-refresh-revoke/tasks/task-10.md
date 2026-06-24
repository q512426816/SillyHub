---
author: qinyi
created_at: 2026-06-24 11:17:15
id: task-10
title: 端到端实测 + 文档同步
priority: P1
depends_on:
  - task-01
  - task-02
  - task-03
  - task-04
  - task-05
  - task-06
  - task-07
  - task-08
  - task-09
blocks: []
requirement_ids:
  - FR-01
  - FR-02
  - FR-03
  - FR-04
  - FR-05
  - FR-06
  - FR-07
decision_ids:
  - D-001@v1
  - D-002@v1
  - D-003@v1
  - D-004@v1
allowed_paths:
  - backend/tests/modules/auth/
  - .sillyspec/docs/backend/modules/auth.md
  - .sillyspec/docs/frontend/modules/lib-api.md
---

# task-10

> Wave 4 收口任务。task-01~09 已分别交付:后端 grace window + rotated_at 字段 + migration + TTL 30min(`task-01/02/03/05`)、后端测试(`task-04`)、前端单飞锁 + 三处 401 收口 + AppShell 主动刷新(`task-06/07/08/09`)。本任务**不改功能代码**,只做端到端联调实测、补充集成测试用例、同步模块文档,使整个变更闭环可交付。

本任务在依赖全部就绪后执行;不产生新的业务逻辑,所有改动属于"验证 + 文档"性质。验收前先确认 task-01~09 已在 plan.md 的"任务总表"中勾选完成。

## 修改文件

| 操作 | 文件 | 说明 |
|---|---|---|
| 新增 | `backend/tests/modules/auth/test_integration_e2e.py` | 跨层集成测试:login → 并发/重复 refresh → 断言 grace 内不吊销其它 session、超 grace 吊销、logout 三元解包不报错(AC-01/02/07);用 freezegun 推进时间避免真等 60s。 |
| 修改 | `.sillyspec/docs/backend/modules/auth.md` | 在「注意事项」段补充:refresh 采用 grace window(`auth_refresh_grace_seconds`,窗口内重签不吊销、超窗口按重放 `revoke_all`)、`rotated_at` 字段语义(logout 不写、仅 rotate 写)、access TTL 默认 30min 可配、grace=0 回退旋钮。**只改注意事项,不加变更索引 section**(scan 会重生模块文档)。 |
| 修改 | `.sillyspec/docs/frontend/modules/lib-api.md` | 在「注意事项」段补充:401 自动刷新已收口到 `lib/token-refresh.ts` 的 `ensureFreshAccessToken()` 单飞锁(模块级 `inflight` Promise,并发 N 次 401 只发 1 次 `/api/auth/refresh`);主动刷新由 `AppShell` 按 access token `exp` 剩余 < 1/3 TTL 触发。**只改注意事项**。 |

> `allowed_paths` 限定本任务只能动以上 3 处。功能代码(service/api/token-refresh/AppShell)若实测发现 bug,需回到对应 task-05/07/08/09 修复,不在本任务内改。

## 覆盖来源

- `design.md` §5 Phase3(测试)、§10 风险登记(R-01~R-05)、§12 自审(需求覆盖/约束一致性/真实性/验收可测)。
- `design.md` §7.5 生命周期契约表(refresh 三态:rotate/grace/重放 + logout)。
- `plan.md` 「验收标准(对应 proposal 成功标准)」AC-01~AC-08、「覆盖矩阵」。
- `proposal.md` 「成功标准(可验证)」7 条。
- `CONVENTIONS`(multi-agent-platform):「Docker 后端不热重载 → 改源码后需 rebuild 镜像再验」「后端改完必实测 API(curl 打端点,grep 确认 import,别只靠 tsc/mypy)」「curl 实测 405≠401 区分」。
- memory「scan 重生模块文档」:模块文档由 scan 重新生成为简洁 module-card(定位/契约/逻辑/注意事项/人工备注),手动改动应融入「注意事项」而非新增「变更索引」section,否则会被 scan 删除。

## 实现要求

1. **不改功能代码**。如 curl/测试暴露缺陷,记录到本任务边界处理段并回退到源 task 修复,不在本任务内 inline 改 service/api。
2. **后端实测必须真打 HTTP 端点**(curl / httpx AsyncClient),不靠 tsc/mypy 静态检查放行(`CONVENTIONS` 教训:历史曾因运行时未 import 符号致 API 500)。
3. **时间相关测试用 freezegun**,不真等 60s(会拖垮 CI、且 wall-clock 抖动致 flaky);grace 边界测 `grace-1s`(续期)、`grace+1s`(吊销)两个用例夹紧窗口。
4. **文档同步遵循 scan 重生规则**:改动落在 auth.md / lib-api.md 的「注意事项」bullet 内,绝不新增"## 变更索引"之类 section(scan 会删);如不确定格式,先 `sillyspec run scan --module auth` 看重生产物再对齐。
5. **集成测试归档位置**:`backend/tests/modules/auth/test_integration_e2e.py`,与 `task-04` 的 `test_refresh_grace_window.py` 区分(后者是单元级复现,前者是端到端含 login/logout 全链路)。

## 接口定义

### 实测步骤清单(curl 伪代码)

前置:rebuild 后端镜像 + `alembic upgrade head` 确认 `rotated_at` 列存在(`CONVENTIONS`:Docker 后端不热重载)。

```bash
# 0) 环境就绪(必做,否则测的是旧镜像代码)
docker compose build backend && docker compose up -d backend
docker compose exec backend uv run alembic current   # 确认 head = 202606241000_add_session_rotated_at
docker compose exec backend psql -c "\d sessions" | grep rotated_at   # 列存在 NULL

BASE=http://localhost:8000

# 1) login 拿 T1(第一对)
RESP1=$(curl -s -X POST $BASE/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"account":"admin@example.com","password":"<admin密码>"}')
ACCESS1=$(echo $RESP1 | jq -r .access_token)
REFRESH1=$(echo $RESP1 | jq -r .refresh_token)
echo $RESP1 | jq '.access_expires_in'   # AC-05: 期望 ≈ 1800

# 2) 第二个 session(模拟"该用户其它 active session"),用同一账号再 login 一次
RESP_S2=$(curl -s -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{...同上}')
ACCESS_S2=$(echo $RESP_S2 | jq -r .access_token)
# 此时 sessions 表该 user 有 2 行 active

# 3) 正常 refresh:用 T1 换 T2(此时 session1 被 rotate,rotated_at=now,revoked_at=now)
RESP2=$(curl -s -X POST $BASE/api/auth/refresh \
  -H 'content-type: application/json' \
  -d "{\"refresh_token\":\"$REFRESH1\"}")
echo $RESP2 | jq '.access_expires_in'   # AC-05: ≈ 1800
REFRESH1_OLD=$REFRESH1   # 记住已被 rotate 的旧 token

# 4) AC-01: 60s 内再用 REFRESH1_OLD(refresh → 期望 200 新对,且不吊销 session2)
RESP3=$(curl -s -w '\n%{http_code}' -X POST $BASE/api/auth/refresh \
  -H 'content-type: application/json' \
  -d "{\"refresh_token\":\"$REFRESH1_OLD\"}")
echo "$RESP3" | tail -1   # 期望 200
# 验证 session2 仍 active:用 ACCESS_S2 调一个需鉴权的端点
curl -s -o /dev/null -w '%{http_code}' $BASE/api/auth/me -H "Authorization: Bearer $ACCESS_S2"   # 期望 200,未被吊销

# 5) AC-02: 等 >60s 后再用 REFRESH1_OLD → 期望 401 且 session2 也被 revoke_all
sleep 65   # 实测脚本用;CI/单测用 freezegun 推进(见 test_integration_e2e.py)
RESP4=$(curl -s -w '\n%{http_code}' -X POST $BASE/api/auth/refresh \
  -H 'content-type: application/json' \
  -d "{\"refresh_token\":\"$REFRESH1_OLD\"}")
echo "$RESP4" | tail -1   # 期望 401
curl -s -o /dev/null -w '%{http_code}' $BASE/api/auth/me -H "Authorization: Bearer $ACCESS_S2"   # 期望 401(被 revoke_all)

# 6) AC-03: grace=0 回退旋钮 —— 重置数据后设 AUTH_REFRESH_GRACE_SECONDS=0,重跑步骤 3+4
#    期望步骤 4 立即 401(等价旧行为:rotate 后立即按重放处理)

# 7) AC-04: 前端并发单飞(浏览器手测,见下「前端手测」)

# 8) AC-07: logout 三元解包 —— login 拿新对后直接 logout,期望 204 且不报错
curl -s -w '\n%{http_code}' -X POST $BASE/api/auth/logout \
  -H "Authorization: Bearer $ACCESS1" \
  -H 'content-type: application/json' \
  -d "{\"refresh_token\":\"$REFRESH1\"}"   # 期望 204;logout 命中 grace 路径幂等设 revoked_at,不签发新对
```

### 前端手测(AC-04 / AC-06)

- **AC-04 单飞**:登录后打开 DevTools → Network 面板 → 临时把 access token TTL 改短验证(或直接清 store 里的 accessToken 触发被动刷新)→ 同时触发多个需鉴权请求(切路由 + 打开多个轮询卡片)→ Network 里 `/api/auth/refresh` **只见 1 次**,其余 401 请求等单飞结果后带 `x-auth-retry:1` 重试成功。
- **AC-06 主动刷新**:登录后保持页面空闲 → 剩余 access TTL < 1/3(~10min)时观察 Network 自动出现 1 次 `/api/auth/refresh`(由 AppShell `useEffect` 定时器触发),无需任何 401。
- **多 tab 手测**:开 2+ tab 同账号 → access 过期瞬间两 tab 各自发 refresh → 因前端单飞仅限单 tab,两 tab 会各自发 1 次;后端 grace window 兜底,第二个 tab 的旧 token 在 60s 内命中 grace 续期,**两 tab 都不掉线**(后端兜底,非前端跨 tab 同步,见 design §3 非目标)。

### 文档同步点

- `auth.md`「注意事项」追加 4 条 bullet:
  1. refresh 采用 grace window(`config.auth_refresh_grace_seconds`,默认 60s):同一 refresh token 被成功 rotate 后,窗口内重提 → 重新签发新对**不吊销该用户其它 session**;超窗口仍按重放 → `revoke_all_user_sessions`(安全不削弱)。
  2. `Session.rotated_at`:仅 `refresh` 的 rotate 路径写(`_mark_session_rotated`),`logout` 只写 `revoked_at` 不写 `rotated_at`(主动登出的 session 不参与 grace 续期)。
  3. access token TTL 默认 30min(`auth_access_ttl_minutes`,可配),`/api/auth/refresh` 返回 `access_expires_in≈1800`;前端按 token 自带 `exp` 推算,不硬编码。
  4. `grace=0` 时退化为旧行为(rotate 后立即按重放处理),提供回退旋钮。
- `lib-api.md`「注意事项」追加 2 条 bullet:
  1. 401 自动刷新已收口到 `lib/token-refresh.ts` 的 `ensureFreshAccessToken()` 单飞锁(模块级 `inflight` Promise,并发 N 次 401 共享同一 inflight,只发 1 次 `/api/auth/refresh`);`api.ts`/`ppm/export.ts`/`auth.ts` 三处 401 分支均调它,不再内联 fetch refresh。
  2. 主动刷新由 `AppShell` 的 `useEffect` 定时器(每分钟)按 access token `exp` 解析,剩余 < 1/3 TTL 时调 `ensureFreshAccessToken()`,减少被动 401 风暴。

## 边界处理

1. **Docker 后端不热重载**(`CONVENTIONS`):backend 容器跑镜像内代码,改了 task-01~05 的源码后 **必须 `docker compose build backend && docker compose up -d backend`** 才生效。实测前先 `docker compose exec backend uv run alembic current` 确认 migration head、`psql \d sessions` 确认 `rotated_at` 列在,否则 curl 打的是旧逻辑,AC-01 会假绿。
2. **curl 实测 405 ≠ 401 区分**(`CONVENTIONS`):改完路由若忘了 `include_router` 或方法不匹配,curl 会返回 **405 Method Not Allowed**(不是 401)。AC-02 期望 401 时若拿到 405,说明端点没正确注册或 method 写错,先 `grep -rn "include_router" backend/app/main.py` 核对,而非当成"重放吊销生效"误判通过。
3. **grace 60s 等待**:curl 手测脚本里 `sleep 65` 可接受(人盯着);但**集成测试禁用真 sleep**(CI 慢 + wall-clock 抖动 flaky)。`test_integration_e2e.py` 必须用 `freezegun` 的 `freezegun.freeze_time` 或 `time-machine` 推进时间,并在 ` AuthService._utc_now()` 路径生效(确认 service 用的是可被 freeze 的 `datetime.now(timezone.utc)` 而非裸 `time.time()`)。
4. **多 tab 手测不可自动化**:AC-04 的"并发 N 次 401 只发 1 次 refresh"由 `token-refresh.test.ts`(task-06)在单 tab 内用并发 Promise 断言;但**多 tab 场景**(两 tab 各自发、后端 grace 兜底)无法在 vitest 里模拟,只能人工开 2 个浏览器 tab 验证。手测结果以截图/录屏归档到变更目录,不阻塞 CI。
5. **scan 重生模块文档**:auth.md / lib-api.md 的「注意事项」改动必须在 scan 用的格式内(bullet 列表,中文),**禁止**新增 `## 变更索引` / `## 本次改动` 之类 section —— scan 会把模块文档重生为固定 5 段(定位/契约/逻辑/注意事项/人工备注),多余 section 会被删(memory「scan 重生模块文档」)。如需记录变更追溯,放变更目录的 design/decisions,不放模块文档。
6. **数据清空前提**:AC-01~03 的 curl 序列依赖"干净 session 状态"(该 user 仅有测试创建的 session)。若库里残留历史 session,`revoke_all` 判定会污染。按 `CLAUDE.md` 规则 8(项目未上线、数据可清空),实测前 `docker compose down -v && docker compose up -d` 重置 DB,或测试用独立账号隔离。
7. **前端实测 access TTL 等待**:AC-06 默认 30min TTL 下主动刷新要等 ~20min 才触发,手测不现实。手测时临时设 `AUTH_ACCESS_TTL_MINUTES=2`(后端 env)+ 前端按 exp 推算,~40s 内即可观察主动刷新;**测完恢复默认值 30**,不要把测试值提交进 config 默认值(task-01 已锁默认 30)。
8. **freezegun 与 bcrypt/uuid 兼容**:freeze 时间可能影响 `sessions.expires_at` 计算(`_issue_token_pair` 按 now+TTL 算过期);推进时间跨过 `expires_at` 会让 session 在 `_consume` 查询时被 `expires_at > now` 过滤掉,误判为"token invalid"而非"超 grace"。测试用例推进时间后需同步推进/重发 token 对,或 freeze 到 rotate 后 61s 且未跨 expires_at(refresh TTL 通常远大于 grace)。

## 非目标

- **不做压测/性能基准**:不测"1000 QPS 并发 refresh",grace + 单飞已根治竞态,性能非本变更目标。
- **不做安全审计**:R-01(grace 窗口内旧 token 可被偷换)为 design §10 已接受的残余风险,本任务不补缓解。
- **不改功能代码**:service/api/token-refresh/AppShell 的任何逻辑调整回退到 task-05/07/08/09,本任务只验证 + 写集成测试 + 改文档。
- **不做跨 tab 同步**(BroadcastChannel):design §3 明确排除,多 tab 由后端 grace 兜底。
- **不改 RBAC / login/logout/me 协议**:认证链路其它部分不动。
- **不重构 refresh token 为 JWT+jti**:沿用 bcrypt 遍历匹配(YAGNI)。

## 参考

- `CONVENTIONS`(multi-agent-platform):
  - 「Docker 后端不热重载:backend 容器挂载 `/host-projects` 非 `/app`、无 `--reload`,改源码后须 rebuild 镜像,curl 实测新端点(405≠401)确认生效。」
  - 「后端改完必实测 API:曾出现 import 了未导入的 UTC 致 API 500 看板空;后端改完 curl 实测端点 + grep 确认 import 在当前文件,别只跑 tsc。」
- memory「scan 重生模块文档」:scan 把 `modules/*.md` 重生为简洁 module-card(定位/契约/逻辑/注意事项/人工备注,无变更索引 section),手动追加的变更索引会被删;quick 同步文档先看格式,融入注意事项而非加变更索引;rebase 冲突取远程 `--ours` 为基底。
- `design.md` §10 R-01~R-05、§11 决策追踪 D-001~D-004、§12 自审。
- `plan.md` 「验收标准」AC-01~AC-08、「覆盖矩阵」。

## TDD 步骤

本任务以**集成测试**为主(TDD 顺序:先写测试 → 跑(此时 task-05 已让单元测试绿,集成测试应直接绿或暴露联调 bug)→ 修联调问题 → 文档)。

1. **写集成测试(红/绿)** `test_integration_e2e.py`:
   - 用例 E2E-01:login(2 session)→ refresh(session1 rotate)→ 60s 内用旧 token refresh → 200 + session2 仍 active。预期**绿**(task-05 已实现 grace)。若红 → 回 task-05 排查 grace 分支。
   - 用例 E2E-02:同上 → freezegun 推进 61s → 用旧 token refresh → 401 + session2 被吊销。预期**绿**。若红 → 排查 grace 边界 / `revoke_all` 触发条件。
   - 用例 E2E-03:`grace=0` 配置下 → rotate 后立即用旧 token → 401(退化旧行为)。预期**绿**(D-002 回退旋钮)。
   - 用例 E2E-04:login → logout(refresh token)→ 204,不抛异常(验证 `_consume_refresh_token` 三元解包在 logout 调用点正确,task-05 R-03)。预期**绿**。
2. **跑集成测试**:`cd backend && uv run pytest tests/modules/auth/test_integration_e2e.py -q`。全绿才进 curl 实测。
3. **curl 端到端实测**:按「接口定义」步骤清单逐条打 HTTP,确认 AC-01/02/03/05/07。405≠401 误判检查。
4. **前端手测**:AC-04(Network 单飞)/ AC-06(主动刷新)/ 多 tab 兜底,截图归档。
5. **全量测试**:`cd backend && uv run pytest -q` + `cd frontend && pnpm test`(AC-07 全绿)。
6. **文档同步**:改 auth.md / lib-api.md 注意事项(遵循 scan 规则)。
7. **验收**:对照「验收标准」表格逐条勾选。

## 验收标准

| AC | 来源 | 验证方式 | 通过标准 |
|---|---|---|---|
| AC-01 | FR-01, plan AC-01 | curl 步骤 4 + E2E-01 | 同一 refresh token 60s 内重复提交 → 200 新对;该用户其它 active session(`ACCESS_S2` 调 `/api/auth/me`)仍 200,**不被吊销**,用户保持登录 |
| AC-02 | FR-01, plan AC-02 | curl 步骤 5 + E2E-02 | 超 60s(freezegun 推进 61s)后再提交 → 401;`ACCESS_S2` 调 `/api/auth/me` → 401(被 `revoke_all`),重放防护不削弱 |
| AC-03 | D-002, proposal 成功标准 | E2E-03 | `AUTH_REFRESH_GRACE_SECONDS=0` 配置下,rotate 后立即用旧 token → 401(退化为旧行为),回退旋钮有效 |
| AC-04 | FR-04, plan AC-04 | 前端手测 DevTools Network | 并发触发多个 401 → Network 仅见 **1 次** `/api/auth/refresh`,其余请求带 `x-auth-retry:1` 重试成功;`token-refresh.test.ts`(task-06)单飞断言绿 |
| AC-05 | FR-03, plan AC-05 | curl 步骤 1/3 `jq .access_expires_in` | login/refresh 返回 `access_expires_in ≈ 1800`;config 默认 `auth_access_ttl_minutes=30` |
| AC-06 | FR-06, D-004, plan AC-06 | 前端手测(临时 TTL=2min) | access token 剩余 < 1/3 TTL 时,Network 自动出现 1 次 `/api/auth/refresh`(AppShell 定时器触发),无需 401 |
| AC-07 | plan AC-07 | `cd backend && uv run pytest -q` + `cd frontend && pnpm test` | 后端 pytest + 前端 vitest **全绿**(含 task-04 单元测试 + 本任务 E2E-01~04 集成测试) |
| AC-08 | design §9, plan AC-08 | 代码审查 task-09 | 主动刷新用标准 `setTimeout`/`useEffect` + `atob` 解析 JWT,无平台特有 API,Windows/macOS 浏览器通用 |

**额外收口检查**(本任务独有):

| 检查项 | 通过标准 |
|---|---|
| migration head 确认 | `alembic current` = `202606241000_add_session_rotated_at`;`\d sessions` 含 `rotated_at TIMESTAMP WITH TIME ZONE NULL` |
| Docker rebuild 已执行 | curl 打到的是新逻辑(非旧镜像);AC-01 不假绿 |
| auth.md 注意事项已补 | 4 条 grace/rotated_at/TTL/回退旋钮 bullet 已写入「注意事项」段,格式符合 scan module-card |
| lib-api.md 注意事项已补 | 2 条单飞收口/主动刷新 bullet 已写入「注意事项」段 |
| 文档无变更索引 section | 未新增 `## 变更索引`/`## 本次改动`(scan 会删) |
| 联调 bug 已回退修复 | 若 curl/测试暴露 service/api 缺陷,已在对应 task-05/07/08/09 修复并重测,本任务不 inline 改功能代码 |
