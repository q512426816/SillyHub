---
id: task-02
title: 'e2e infrastructure: env + fixtures + helpers'
title_zh: 'e2e 基础设施（env/fixtures/helpers）'
author: 'qinyi'
created_at: 2026-08-29 14:55:00
priority: P0
depends_on: ['task-01']
blocks: ['task-03', 'task-04']
requirement_ids: [FR-02, FR-03]
decision_ids: [D-002@v2, D-003@v1]
allowed_paths:
  - frontend/e2e/env.ts
  - frontend/e2e/fixtures.ts
  - frontend/e2e/helpers.ts
goal: >
  建立 e2e 三件套基础设施（multica 模式）：env.ts 加载 E2E_* 环境变量；fixtures.ts 的
  TestApiClient（原生 fetch 直连后端，admin 登录/幂等建角色/建 run-id 用户挂 role_ids/
  用户登录/me）；helpers.ts 的 run-id 常量、loginAsE2e（localStorage persist v1 注入）、
  waitForPageText（design §3.2/§3.3，FR-02/FR-03）。
implementation:
  - e2e/env.ts：dotenv 加载 frontend/e2e/.env.e2e → frontend/.env（存在则读）；导出 E2E_BASE_URL（默认 http://localhost:3000）、E2E_API_URL（默认 http://localhost:8000）、E2E_BOOTSTRAP_EMAIL/E2E_BOOTSTRAP_PASSWORD（必填，缺失时 throw 带修复指引的中文错误）
  - e2e/fixtures.ts TestApiClient：构造时持 API base；loginAsAdmin()（bootstrap 凭据 POST /api/auth/login，Bearer token）；ensureSmokeRole()（GET /api/admin/roles 列表查 key 已存在则复用，否则 POST /api/admin/roles：key=e2e_smoke_<runid>（下划线，pattern ^[a-z][a-z0-9_]*$）、permission_keys=["workspace:read"]）；createSmokeUser()（POST /api/admin/users：email=e2e-<runid>@test.local、username=e2e<runid>（≥3 字符）、password ≥8 含字母数字、role_ids=[角色 id]、is_platform_admin=false、login_enabled=true）；loginAs(account,password) 返回 TokenPair；fetchMe(token) 返回 MeResponse（含顶层 permissions）
  - e2e/helpers.ts：E2E_RUN_ID = Date.now().toString(36) + process.pid.toString(36)（multica 同款）；createE2EContext()（admin 登录→建角色→建用户→用户登录，返回 {api, user, tokenPair}）；loginAsE2e(page, ctx)——page.addInitScript 注入 localStorage["multi-agent-platform.session"]，JSON.stringify({state:{hydrated:true,user:{id,email,displayName,is_platform_admin,permissions},accessToken,refreshToken},version:1})，user 字段复刻 fetchMe 落盘映射（auth.ts:15-22：displayName 降级合并、permissions 取 me 顶层）；waitForPageText(page,text,timeout=30000) 用 page.waitForFunction(document.body?.innerText.includes)；注释指向 frontend/src/stores/session.ts 落盘形状（R5 变更点单一）
  - 所有 API 调用错误信息带 HTTP status + body 摘要（中文），失败可诊断
acceptance:
  - cd frontend && pnpm exec tsc --noEmit 0 错（e2e 三文件类型正确）
  - 本机后端在跑且 E2E_* 配好后，node 层面可用（后续 task-03/04 的 spec 能 import 并通过）；类型上 TestApiClient 方法与 backend 实际契约一致（POST /api/admin/roles 的 key/permission_keys、POST /api/admin/users 的 username 必填/密码规则/extra=forbid）
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 纯浏览器外 fetch，不 import 前端 src/（零构建耦合，multica 同款）
  - 不写任何 spec 用例（归 task-03/04）
  - 注入格式集中在 helpers 单点（R5）
  - 不改 backend（角色/用户端点已存在，design §7 已核实 file:line）
---
