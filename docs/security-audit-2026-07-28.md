# SillyHub 多智能体平台 · 安全审查报告

- **日期**:2026-07-28
- **方法**:纯只读静态审查,7 个维度并行子代理 + 主线补充,逐条读码确认(非臆测)
- **覆盖维度**:① 认证与会话 ② 授权与 IDOR ③ 注入风险 ④ daemon 运行时 ⑤ 网络与部署 ⑥ 文件上传与对象存储 ⑦ 前端与密钥管理
- **严重度**:P0 可直接未授权造成系统控制/数据泄露;P1 有条件但影响大;P2 纵深防御缺失;P3 最佳实践

---

## 一、严重度统计

| 级别 | 数量 | 说明 |
|------|------|------|
| P0 | 8 | 含 2 条完整可利用攻击链 |
| P1 | 6 | 核心授权/注入缺陷 |
| P2 | 16 | IDOR / 凭证存储 / 缓存一致性 |
| P3 | 9 | 加固与依赖 |

> ⚠️ 网络与部署维度的部分 P0 基于当前公网部署(crrcdt.ppdmq.top / 47.113.145.252)的现状假设,实际严重度取决于阿里云安全组是否放行了 5432/9001/6379、是否已上 TLS。**请先按本报告"立即行动"逐项确认。**

---

## 二、最危险的攻击链(把多个发现串起来)

### 链 A:公网爆破零成本进管理员
默认管理员使用常见弱口令(README 曾文档化)+ 登录/refresh 全栈**无限流** + 无强制改密 + 公网明文 HTTP(无 TLS) → 攻击者几无成本爆破或撞库拿到管理员,且拿到后 access token 30 分钟内不可吊销(P1-13)。

### 链 B:冒充 daemon → 完整接管(最严重)
`daemon_local_id`(一个 UUID)是 daemon 接入的唯一凭证,经 `?daemon_local_id=` 走 query string → **进 nginx access log、从不轮换**。攻击者一旦从日志/备份/共享开发机拿到任一 daemon 的 UUID:
1. 连 `/api/daemon/ws`(**零鉴权**,P0-1)→ 冒充该 daemon
2. 接收 backend 推给该 daemon 的全部 RPC(后端读什么文件,攻击者就看到什么)
3. 接收 lease payload(**含明文 LLM api_key**,P0-2)
4. 或令被 prompt 注入的 agent 用 Read 工具(**canRead 全 allow**,P0-3)读 `~/.sillyhub/daemon/config` 的明文凭证、`~/.ssh/id_rsa` → 长期接管宿主机

### 链 C:任意登录用户横向扫数据
- `GET /api/file/list`(不带参)返回**全平台所有文件**元数据 + 全部 file_id → 下载/删除任意他人文件(P0-5)
- PPM `data_scope` 系统性缺失(P1-9):部门经理/普通成员可跨项目读改删任务、工时、计划节点、客户、成员、干系人

### 链 D:token 泄露后难以止血
access + refresh token 都 persist 到 `localStorage`(P2-15)→ 任一 XSS 即可窃取 → access token 30min 不可吊销(P1-13)+ refresh 14 天可轮换 → 长期账户控制。

---

## 三、P0 详述

### P0-1 daemon WebSocket 零鉴权
- **文件**:`backend/app/modules/daemon/router.py:1958-2023`
- **证据**:handler 仅校验 `daemon_local_id` 在 `DaemonInstance` 表存在即 `websocket.accept()`,**无 Bearer / X-API-Key / Origin 校验**;docstring 声称的"HTTP upgrade 阶段鉴权"未实现。daemon 侧 `sillyhub-daemon/src/ws-client.ts:350,355-357` 连接时不带任何认证头。
- **修复**:WS 握手强制 `_extract_bearer`+`get_current_user`(失败 `close(4401)`),并比对连接方是注册 owner;daemon_local_id 不再当 bearer,改用已下发的长期 API key 做 WS 鉴权,改走 header(不入 access log)并支持轮换。

### P0-2 claim_lease IDOR 泄露明文 LLM api_key
- **文件**:`backend/app/modules/daemon/router.py:949-968`、`backend/app/modules/daemon/lease/service.py:141-215`、`backend/app/modules/daemon/lease/context.py:138-151`
- **证据**:`POST /leases/{lease_id}/claim` 仅 `get_current_principal` + 校验 `status=="pending"`,**不校验调用方归属**;claim 成功返回的 payload 经 `_inject_provider_config` 解密 owner 的 LlmProvider api_key 明文落入 `provider_config.api_key`。任何登录用户知道一个 pending `lease_id`(会出现在 agent_run 详情/SSE/日志)即可拿走 lease 并得到明文 key。
- **修复**:claim 时校验调用主体 = lease 绑定 runtime 的 owner;或改用 lease 级一次性 claim_token 替代"先到先得"。

### P0-3 daemon 读沙箱完全缺失(canRead 全 allow)
- **文件**:`sillyhub-daemon/src/policy/filesystem-policy.ts:88-92`
- **证据**:`canRead` 直接 `return { allowed: true }`,不判 allowed_roots、不记审计。被 prompt 注入的 agent(auto 模式尤其)可读 `~/.sillyhub/daemon/config-*.json`(明文 token/api_key,见 P2)、`~/.ssh/id_rsa` 等任意宿主文件。写沙箱有 realpath+边界(扎实),**读侧完全开放是明显不对称**。
- **修复**:`canRead` 同样走 `isPathUnderAnyRoot` 边界校验,或至少把 daemon 配置目录/`~/.ssh`/`~/.aws` 列入硬 denylist。

### P0-4 spec_workspace tar 解包 zip-slip
- **文件**:`backend/app/modules/spec_workspace/service.py:541-558`
- **证据**:解压目标在 `staging`,但路径校验却对 `spec_root` 做(`target = (spec_root / name).resolve()`),**校验目标 ≠ 解压目标**;且 `tf.extractall(staging, filter="fully_trusted")` 显式关闭了 Python 3.12 的安全过滤器。恶意 tar 成员名 `../../../../etc/passwd` 可写宿主机任意路径(若后端以 root 运行则 RCE)。
- **修复**:校验改为对 staging 做;`filter="data"`(3.12+ 安全过滤器)替代 `fully_trusted`。
- **注**:注入维度子代理曾误判此点"有防护",本条以文件存储维度子代理的精确行号证据为准。

### P0-5 文件中心全量 IDOR
- **文件**:`backend/app/modules/file/service.py:111-175`、`router.py:93,112,123,133`
- **证据**:`_get_active(file_id)` 纯主键查,不校验 `uploaded_by`/`owner`;`list_files()` 无参时返回**全平台文件**元数据 + 所有 file_id;`soft_delete` 无归属校验且会同步删 MinIO 对象本体。任意登录用户可读/删他人文件。
- **修复**:`get_stream/get_meta/soft_delete` 注入 user 校验归属;`list_files` 按 `uploaded_by=user.id` 收口。

### P0-6 公网弱默认凭据 + 端口暴露(需确认现状)
- **文件**:`deploy/docker-compose.yml:10-12,26-27,42-46`
- **证据**:postgres 默认 `platform/platform`、minio `minioadmin/minioadmin`、redis 无密码;端口 5432/9000/9001/6379 映射宿主所有接口。compose 对 `SECRET_KEY`/`SILLYSPEC_MASTER_KEY` 用 `:?` 强制(good),但 DB/MinIO/Redis 密码未强制。
- **确认**:阿里云安全组是否放行了 5432/9001/6379 到公网。若放行且未覆盖默认值 → 直接沦陷。
- **修复**:生产强制覆盖所有密码(compose 全部 `:?`);撤销 PG/MinIO/Redis 的 host 端口映射(仅 Docker 内网);redis 加 `requirepass`。

### P0-7 全栈无 TLS 明文传输(需确认现状)
- **文件**:`deploy/` 无 nginx/caddy TLS 终结配置
- **证据**:仅有 `timed-log.conf`(nginx 日志格式,非主配置)。公网访问 token/api_key/敏感响应走 HTTP 明文;daemon↔backend WS 走 `ws://`。
- **确认**:crrcdt.ppdmq.top 当前是否有 nginx 在 443 终结 TLS(记忆中曾因 nginx HTTP/2 卡顿调过,需确认 TLS 是否已上)。
- **修复**:上 nginx/caddy + HTTPS(Let's Encrypt),backend/frontend 仅监听 Docker 内网。

### P0-8 FastAPI 文档端点生产暴露
- **文件**:`backend/app/main.py:133-135`
- **证据**:`docs_url="/api/docs"`、`openapi_url="/api/openapi.json"` 无条件启用,未按 `environment` 判断。任何人可查看完整路由/schema。
- **修复**:`environment=="prod"` 时设 `docs_url=None, redoc_url=None, openapi_url=None`。

> P0-6/7/8 中登录无限流、默认弱口令无强制改密见 P1。

---

## 四、P1 详述

### P1-9 PPM data_scope 系统性缺失
- **文件**:`backend/app/modules/ppm/task/router.py`(全程无 `get_ppm_data_scope`)、`plan/router.py`(plan-node/ps/module 单资源)、`project/router.py`(maintenance/customer/member/stakeholder)
- **证据**:`get_ppm_data_scope` 仅注入在极少数端点;单资源 get/update/delete 不传 scope、不传 user;task router 全程无 scope。结果:部门经理/普通成员可跨项目读改删任务、工时、计划节点、客户、成员。
- **修复**:把 `get_ppm_data_scope` 提到 router 级 `dependencies=[...]` 统一覆盖;单资源在 service 内按 `plan_operable_by_scope`/项目成员角色收口。

### P1-10 PPM problem-change 全 CRUD 无授权
- **文件**:`backend/app/modules/ppm/problem/router.py:515-605`、`service.py:490-497`
- **证据**:端点标注 deprecated(D-005)但仍可写;`AuthUser=get_current_principal` 仅认证不授权;service 纯 CRUD 无 user/scope。任意 ppm 用户可读改删任意 problem-change、列表/导出不按 scope 裁剪。
- **修复**:废弃则下线;保留则照 problem-list 范式加 `_assert_can_operate`,list 接 scope。

### P1-11 GitIdentity 配置注入 → 潜在 RCE
- **文件**:`backend/app/modules/git_identity/schema.py:14-15`、`backend/app/modules/worktree/exec_env.py:73-84`
- **证据**:`git_username`/`git_email` 无校验(允许换行),直接 f-string 写入 gitconfig 并设为 `GIT_CONFIG_GLOBAL`。攻击者设 `git_username = "x\n[core]\nfsmonitor=/tmp/payload.sh"`,git worktree checkout 触发执行;`core.sshCommand`/`core.gitProxy` 同理。
- **修复**:schema 加 `Field(pattern=r"^[^\n\r\0]+$")`;或写入前 `re.sub(r"[\n\r\0]","",...)`。

### P1-12 tool_gateway SSRF(重定向绕过)
- **文件**:`backend/app/modules/tool_gateway/service.py:510-549`、`tool_policy.py:273-321`
- **证据**:`_check_domain_allowed` 仅查初始域名,但 `httpx.AsyncClient(follow_redirects=True)` 跟随 302 → 攻击者服务器重定向到 `http://169.254.169.254/latest/meta-data/`(IMDSv1)窃云凭证,或访问内网服务。
- **修复**:禁用 `follow_redirects` 手动逐跳校验私网 IP;或 event_hooks 重定向时重新验证。

### P1-13 Access token 不可吊销
- **文件**:`backend/app/core/security.py:103-122`、`auth_deps.py:75-83`、`auth/service.py:170-173`
- **证据**:JWT 无状态 HS256,`jti` 写入 claim 但 decode/消费从不校验黑名单(全仓无 jti 黑名单)。logout/改密只吊销 refresh session 行,旧 access token 在 TTL(默认 30min)内仍有效,含 admin 全权限。
- **修复**:Redis jti 黑名单,decode 校验;logout/改密写黑名单。或缩短 access TTL 到 5min。

### P1-14 登录无限流 + 默认弱口令无强制改密
- **文件**:`backend/app/main.py:139-163`(无 slowapi)、`auth/router.py:48-59`、`README.md:152`、`auth/service.py:362-411`
- **证据**:登录接口无限流/锁定;README 文档化默认弱口令;bootstrap 建 admin 无 `must_change_password` 标记(User 模型无此列);admin 重置默认密码 `SillyHub@123`(`admin/users_service.py:48`)的 `force_change_on_next_login` 只写审计、auth 模块零引用。
- **修复**:slowapi/redis 限流(5次/分/IP+username);User 加 `must_change_password` 列,login 后强制改密。

---

## 五、P2 / P3 摘要(详见各维度原始结论)

**P2**:
- access+refresh token 双存 localStorage(`frontend/src/stores/session.ts:31-58`)→ XSS 盗长期凭证
- 登录页明文密码入 localStorage + 默认回填已知弱口令(`frontend/src/app/(auth)/login/page.tsx:45-74`)
- quick-chat run 全局 IDOR(读/杀/续接他人会话,`main.py:181-484`)
- agent mission/execution-context 单资源 IDOR(`agent/router.py:149-156,919-927`)
- release 部署/回滚/审批跨工作区 + list 弱授权(`release/router.py:48-128`)
- problem 单资源 get 越权读(`ppm/problem/router.py:414-424`)
- git_gateway 参数注入黑名单漏 `--receive-pack`/`-c`(`git_gateway/service.py:51-57`)
- worktree clone 缺 `--` 终止符(`worktree/git_runner.py:78-79`)
- MIME 校验信任客户端 Content-Type(`file/router.py:56-60`)
- 上传 `await file.read()` 全量读内存后校验大小 → OOM(`file/router.py:56`)
- daemon 本地凭证明文 + 无 chmod 0600(`sillyhub-daemon/src/config.ts:583-585`)
- `assertWithinAllowedRoots` 不解析 realpath,symlink 可逃逸(`file-rpc.ts:70-99`)
- auto 模式(manual_approval=false)Bash 工具不经 daemon 策略门禁(`lease/context.py:199-208`)
- API key 正缓存不回查 key 自身 revoked/expires(`api_key_service.py:215-225`)
- token/api_key 经 query param 传递 → URL/日志泄露(`auth_deps.py:38-53`)
- 登录用户名存在性时序枚举(bcrypt 短路,`auth/service.py:93-96`)
- refresh 不校验 login_enabled(`auth/service.py:280-282`)
- 前端缺安全响应头 CSP/HSTS/X-Frame-Options(`frontend/next.config.mjs`)
- CORS `allow_credentials=True`+origins 来自 env,需防误配 `*`(`main.py:139-146`)
- HOST_PROJECTS_DIR 把宿主 IdeaProjects 整目录挂进容器(`docker-compose.yml:90`)

**P3**:
- `secret_key` min_length=16 偏弱(`config.py:37`)
- bcrypt 72 字节截断无预哈希(`security.py:58-66`)
- refresh grace 60s 静默重放(`auth/service.py:299-311`)
- `.env.example` SECRET_KEY 占位串易被原样提交(`deploy/.env.example:18`)
- MinIO console 9001 暴露风险(`docker-compose.yml:44-46`)
- tool_gateway run_tests 的 test_path 路径注入(影响有限,`tool_gateway/service.py:391-443`)
- `require_permission` 误用致 `/releases/.../promote`、`/missions/.../cancel` 端点 422 不可用(`release/router.py:103-111`、`agent/router.py:938-946`)
- 后端 `python-jose[cryptography]>=3.3`(jose 3.3 有已知 CVE,代码硬编码 HS256 降低可利用性,建议迁 pyjwt)
- 前端 `next 14.2.5`(14.2 早期版本,后续有安全补丁,建议升 14.2 最新补丁)

---

## 六、做得好的地方(读码确认的正面项)

- **密码学原语扎实**:bcrypt cost 12;refresh token 高熵(uuid4 + 32 random bytes)+ bcrypt 存储 + HMAC token_id 做 O(1) 索引 + 行锁 + reuse-attack 吊销;凭证加密用 libsodium secretbox(xchacha20-poly1305)+ 版本化 KEK + 强制 32 字节。
- JWT 算法白名单写死 `["HS256"]`(免疫 alg=none 混淆)+ typ 校验。
- **权限缓存设计健全**:核弹式 `invalidate_all_permissions`(扫清全部 `perm:*`+`ppm-scope:*`)避免单 key 漏失效;缓存 key 含 workspace_id 无跨工作区串;在成员/角色/用户/工作区写后均调用。
- **授权正确的模块**:admin/*、workspace/*(含 members/member_runtimes)、change/*、task/*(service 层 `where id==X AND workspace_id==Y` 正确闭合)、scan_docs、knowledge、settings、git_identity、git_gateway、auth/api-keys、daemon **HTTP** 路由(X-API-Key + X-Claim-Token)、daemon dist_router(刻意公开 + Host 白名单防注入)。
- **命令执行防护到位(写/执行侧)**:后端全部 `create_subprocess_exec` 无 shell=True;host_fs `run_command` 双端字符级白名单 + execFile 非 shell;daemon spec-sync tar 解包三重防护(拒 `..`/绝对路径/盘符 + relative 二次校验 + 跳过 symlink);写沙箱 `resolveRealPath`+边界。
- **无危险渲染/反序列化**:全局无 `dangerouslySetInnerHTML`/`eval`/`new Function`;markdown 用 @uiw/react-markdown-preview 默认不开 rehype-raw、链接强制 `rel="noreferrer noopener"`;无 yaml.unsafe_load/pickle.loads。
- **密钥管理底线**:`.env` 从未进 git history、未被追踪(git log 验证);`SECRET_KEY`/`SILLYSPEC_MASTER_KEY` compose 用 `:?` 强制。
- 文件存储键服务端生成 UUID(无覆盖攻击);无预签名 URL 直传(所有 S3 操作经后端客户端)。

---

## 七、修复优先级路线图

### 立即(确认 + 止血,公网暴露面)
1. 阿里云安全组收紧:5432/9001/6379 **不对公网**,仅限 backend 容器内网可达
2. 上 TLS(nginx 443 终结),确认 crrcdt.ppdmq.top 已 HTTPS
3. 覆盖所有默认凭据(postgres/minio/redis),compose 全部改 `:?`
4. `environment=prod` 关闭 `/api/docs`、`/openapi.json`
5. 登录加限流(slowapi/redis 5次/分)+ admin 强制改密

### 紧急(P0/P1 核心逻辑漏洞)
6. daemon `/ws` 加强制鉴权(P0-1)+ Origin 校验(防 CSWSH)
7. claim_lease 加归属校验(P0-2)
8. daemon canRead 接边界 + 敏感目录 denylist(P0-3)
9. spec_workspace tar 修校验目标 + filter="data"(P0-4)
10. file 中心 IDOR 收口(P0-5)
11. GitIdentity 输入校验(P1-11)、SSRF 重定向校验(P1-12)
12. PPM data_scope 系统补全 + problem-change 下线/加授权(P1-9/10)
13. access token jti 黑名单(P1-13)

### 排期(P2/P3)
14. refresh token 改 httpOnly cookie、access 仅内存
15. auto 模式注入 canUseTool 管 Bash
16. 上传流式读取 + MIME 魔术字节嗅探
17. daemon 凭证文件 chmod 0600 / 走 OS keychain
18. 前端安全头(CSP/HSTS/X-Frame-Options)
19. 依赖升级:python-jose → pyjwt,next 14.2 最新补丁

---

## 八、覆盖面与局限(诚实声明)

**已实际读码覆盖**:7 大维度核心文件,所有 router 装饰器+函数签名逐个确认鉴权挂载,daemon WS/lease/host_fs 全链路,认证/加密原语全文,部署配置全文,.env git history 核验。

**未深入/未覆盖(需后续补充)**:
- 各 PPM service **内部** list 查询是否在 service 层偷偷加了 scope 过滤(本次只抽验 problem/change/file;但 router 层 user 未传入,service 无从判断调用者,故"router 不传 user"本身已构成证据)
- daemon WS 是否有 **nginx/反向代理层** auth 兜底(代码层确无,基础设施层未查)
- `incident`/`tool_gateway`/`workflow`/`change_writer`/`runtime`/`worktree`/`member_runtimes` 的单资源归属未逐一抽验(已确认都挂了 require_permission/get_current_user,但未逐一验证 service 是否校验资源属于该 workspace)
- 前端是否对 IDOR 有补偿(不影响后端漏洞成立)
- **未跑动态测试/未验证生产实际配置**(安全组、TLS 现状、各 PPM service 内部过滤)——这些是静态审查盲区,建议后续做一次带认证的动态渗透 + 生产配置核查
- 依赖 CVE 未跑 `pip-audit`/`npm audit`,仅基于版本下限评估

---

## 附录:各维度原始结论来源
- 认证与会话、授权与 IDOR、注入、daemon 运行时、网络部署、文件上传 — 7 个子代理逐条读码结论(本次会话留存)
- 前端、密钥与依赖 — 主线直接读码
