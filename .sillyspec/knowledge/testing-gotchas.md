---
author: qinyi
created_at: 2026-07-05 02:00:00
---

# 测试坑 (testing-gotchas)

> 后端 pytest + 前端 vitest/React Testing Library 踩过的坑。

## 后端：pytest patch 函数内局部导入的目标

被测函数内部用 `from app.core.db import get_session_factory`（函数级局部导入）时，`patch("app.modules.agent.service.get_session_factory")` 会报 `AttributeError: module does not have the attribute`，因为该名字从未绑定到 service 模块命名空间。

- 正确做法：patch 源头模块属性 `app.core.db.get_session_factory`。局部导入每次执行时从源模块取属性，patch 源头才能拦截。
- 同理适用于任何「函数内 import」的 mock。模块级 import 才 patch 使用方模块。

## 后端：无本地 venv 时在 Docker 后端容器跑 pytest

- 本机只有 Windows Store 的 python stub（exit 49 不执行），项目走 Docker 部署无 venv。
- 主机项目盘挂载在后端容器 `/host-projects`，git worktree 可经 `/host-projects/.../multi-agent-platform/.sillyspec/.runtime/worktrees/<change>` 访问。
- 生产镜像 venv 缺 pytest，但 `pip install pytest` 装到 `~/.local`(user-site)，venv python 默认不加载；运行时 `sys.path.insert(0, site.getusersitepackages())` 后 `pytest.main()` 即可。
- 用 `PYTHONPATH=<worktree>/backend` 让测试 import 命中 worktree 改动代码，不污染容器 /app（镜像层）。
- 验证回归：在 `/host-projects/.../backend`(main) 上跑同样测试对比，区分预存失败与本次引入的回归。

## 前端：MENU_PERMISSION_GROUPS 跨 menu 重复 permission.key 致 queryByLabelText 失败

当 MENU_PERMISSION_GROUPS 中同一个 permission.key 出现在多个 menu（如 `user:read` 在 `git-identities`/`users`/`settings` 三处），picker 三级渲染会为每个出现位置生成一个独立 checkbox，aria-label={p.key} 在 DOM 中重复。

- 后果：React Testing Library 的 `screen.queryByLabelText("user:read")` 抛 `getMultipleElementsFoundError`。
- 规避（不修改 picker 实现，仅调整测试）：
  - 全局计数断言：`screen.getAllByLabelText("user:read").length` 折叠某 menu 前后比较。
  - 容器内查询：`within(menuContainer).getByLabelText(p.key)`，先通过 menu label 文本定位容器。
  - 单 menu 单 key 校验：选 only-once 的 key 做断言（如 `organization:read` 只在 organizations menu 出现）。

## 前端：antd v5 DatePicker 周几/日历表头显示英文，仅 ConfigProvider locale 不够

- 现象：DatePicker 日历表头星期显示英文（Su/Mo/Tu…），即便已配 `ConfigProvider locale={zhCN}`。
- 根因：antd v5 DatePicker 内部用 dayjs 渲染日历表头，这些取自 **dayjs 全局 locale**，而非 antd ConfigProvider 的 locale。`ConfigProvider locale={zhCN}` 只影响 antd 自有文案（「今天」按钮、placeholder），管不到日历表头星期。
- 修复：补 `import 'dayjs/locale/zh-cn'; dayjs.locale('zh-cn');`，与 ConfigProvider locale 双保险。
- 通用坑：antd v5 全家桶（DatePicker / RangePicker / Calendar / TimePicker）的日历本地化 = `ConfigProvider locale`（antd 文案）+ `dayjs.locale`（日历表头/月份）**缺一不可**。

## 前端：antd v5 两字中文按钮 autoLetterSpacing 致 DOM 字间空格（getByRole 匹配失败）

- 现象：antd v5 `Modal.confirm({ okText: "移除", cancelText: "取消" })` 的两字中文按钮，DOM 渲染为 `<span>移 除</span>`（字间插空格，autoLetterSpacing 特性）。测试 `getByRole("button", { name: "移除" })` 严格匹配失败。
- 根因：antd v5 对 CJK 文本默认开启 `autoLetterSpacing`，渲染时在字符间插入空白节点，破坏 `aria-label`/name 严格匹配。
- 解法：测试用正则 `/移\s*除/` / `/取\s*消/` 兼容字间空白；或关 `autoLetterSpacing`（影响视觉一致性，不推荐）。前端测试断言中文按钮一律用 `\s*` 兼容。

## 前端：MarkdownText 用 next/dynamic ssr:false，jsdom 测试同步 render 得 null

- markdown-text.tsx 用 `next/dynamic` `ssr:false`，jsdom 测试同步 `render` 处于 loading（返回 null），assistant 文本不进 DOM 致 `getByText` 失败。
- 修法：测试文件顶部 `vi.mock` 成纯文本渲染（测父组件逻辑而非 markdown 库本身）。
- 影响组件：agent-log-viewer / interactive-session-panel / runtime-session-dialog。

## 后端：daemon 列表测试造 status 必须符合 cleanup_stale_runtimes 不变量（online ⟺ 心跳<45s）

> 来源：2026-07-07-daemon-machine-runtime-hierarchy task-04 排序用例。

- `list_machines` / `list_runtimes_page` 进入先调 `cleanup_stale_runtimes()`（DEFAULT_RUNTIME_STALE_SECONDS=45）：选 `status='online'` 且心跳 >45s（或 NULL）的 instance 改 offline，**不反向 resurrect**（offline→online 由心跳端点主动刷新）。
- 测试造 data：设 `status="online"` 的 instance，`last_heartbeat_at` 必须 `<45s`（如 `now - timedelta(seconds=30)`），否则 cleanup 改 offline 污染排序/统计断言；设 `status="offline"` + 新心跳的 instance 保持 offline（cleanup 不 resurrect），可安全验证"online 优先于心跳新鲜度"。
- 通用坑：调用 `list_*`（内部 cleanup）的测试，造的 instance.status 必须与 last_heartbeat_at 一致（online ⟺ <45s），不能凭空设 online + 老 heartbeat。

## 后端：Pydantic 必填派生字段构造坑（model_validate(ORM)+model_copy 两段式必崩）

> 来源：2026-07-07-daemon-machine-runtime-hierarchy task-03/04。归类补充：构造解法与通用规则见 conventions「2026-07-08 — Pydantic 必填派生字段不能用 model_validate(ORM)+model_copy 两段式」条目，此处登记测试视角——该类 bug 由 task-04 测试捕获（`ValidationError: Field required`），DTO 含 ORM 上不存在的必填派生字段时，测试断言会先于业务逻辑暴露此构造问题，属测试能兜住的构造期错误。

## 后端：auth login 限流跨用例累计致 admin 套件偶发 429（预存，非回归）

> 来源：ql-20260808-001-4068（安全加固三联）跑 `tests/modules/admin` 时发现。

- 现象：`tests/modules/admin/test_users_router.py` 全量跑时 `test_update_username_change_success`（及 `test_create_user_then_login_by_username`）偶发 `assert 429 == 200`（`HTTP_429_LOGIN_RATE_LIMITED`）；单独跑该用例 100% 过。
- 根因：auth login 限流是**跨用例共享的测试态累计**（同 IP 127.0.0.1 的 INCR 计数在套件内不被重置）；`test_login_by_email_or_username` 单测发 5 次 `/api/auth/login`（故意测 4 次失败防枚举），把限流计数顶到阈值，后续断言「登录成功=200」的用例撞限流。conftest `_isolate_permission_timers` 只清 daemon `_permission_timers`，不含 login 限流。
- 判定为预存非回归：`git stash` 干净 HEAD 复跑 `test_users_router.py` 同样 FAILED 且**更糟**（2 用例 429）；安全加固新增测试用 `create_access_token` 铸 token、零 `/api/auth/login` 调用，不增加登录计数。
- 通用坑：① 套件级「偶发 429」基本是限流跨用例累计，先用「单跑该用例是否过 + git stash 干净 HEAD 是否复现」两步定位为预存再归因，别误判成新改动引入。② 修复方向（待做）：给 login 限流加测试态隔离（per-test 清零计数，或在 fixture 里 mock/抬高阈值），参照 `_isolate_permission_timers` 范式。③ 测「非登录路径」的权限/断言用 `create_access_token` 直接铸 token，绕开 login 限流，别走 `/api/auth/login`。

## 跨端：mock 各自绿但契约断裂——契约测试须锚定真实输出并断言字段值

> 来源：2026-08-19-runtime-live-daemon-read execute acceptance review 抓到的 P0。

- 现象：runtime 进度链路（sillyspec CLI dump → daemon 透传 → backend pydantic）三端测试全绿，端到端却断链——dump 输出 camelCase（currentStage/startedAt/sizeBytes），backend `RuntimeProgress` 是 snake_case；pydantic 默认**静默忽略未知字段**，model_validate 通过但核心字段全落 None，前端进度页成空壳。第二层坑：DB 内历史斜杠时间戳（`2026/7/22 13:38:35`）pydantic datetime 直接拒收。
- 根因：三端测试各自 mock 了「自以为对」的数据形态（backend mock snake_case、daemon mock snake_case、sillyspec 断言 camelCase），没有一侧用**真实对端输出**做契约测试。task review 铁律「只看当前 task 的 diff」天然覆盖不到跨 task 交界——这正是 stage acceptance review 的兜底价值。
- 修复范式（sillyspec 9a63466）：生产端（dump）转 snake_case + 时间戳规范化（ISO 与斜杠统一 ISO）；测试加**跨端契约守护断言**（camelCase 残留检测 + ISO 形态检测）；验收必做端到端（真实 DB → CLI 输出 → pydantic model_validate 全字段断言，不能只看「校验通过」——要看字段值非空）。
- 通用坑：① pydantic 忽略未知字段是静默降级，`model_validate` 不报错 ≠ 数据进了模型，跨端契约测试必须断言**字段值**而非仅校验成功。② 多端链路的「mock 契约」要有一侧锚定真实输出形态（fixture 从真实 CLI 输出固化），否则三端各绿 = 三端各错。

## daemon：vitest include 仅 tests/**，src 内不放测试

sillyhub-daemon 的 vitest.config.ts include 仅 `tests/**/*.test.ts`——src 内任何 `__tests__/` 目录不被发现（`pnpm vitest run src/...` 报 No test files found，spikes 目录就是因此单独建了 config）。新增 daemon 测试一律落 `tests/interactive/` 等既有子目录。（来源：2026-08-27-background-subagent-progress task-04）

## daemon：本机集成验证 WS 鉴权只认 X-API-Key + USERPROFILE 隔离跑第二实例

- daemon 的 WS 升级鉴权（backend `_authenticate_ws_upgrade`）走 `X-API-Key`（或 shk_live_ 前缀 Bearer）；`--token`（JWT）只能过 REST，WS 会 403 `ws_upgrade_auth_rejected`——本机起 daemon↔backend 真实集成时必须 `--api-key`（key 经 POST /api/auth/api-keys 签发）。
- daemon 单实例守卫是全局 `~/.sillyhub/daemon/daemon.pid`（不分 server）；本机已有真实 daemon 时，集成验证进程用 `USERPROFILE=<临时目录>` 启动即可整树隔离（config/locks/pid 全落临时 HOME，Windows 上 os.homedir() 读 USERPROFILE），零副作用跑第二实例，验后删目录。
- 来源：2026-08-31-machine-sillyspec-version verify Runtime Evidence（task: verify 集成验证）

## 后端：daemon 模块测试双目录惯例（app/modules/daemon/tests/ 为主）

- daemon 模块测试主要在 `backend/app/modules/daemon/tests/`（conftest + 绝大多数用例，如 test_pending_update_upsert / test_machines_router / test_register_heartbeat_daemon）；顶层 `backend/tests/modules/daemon/` 只有契约/迁移/版本管理少数文件（test_protocol_session_contract / test_daemon_version_management）。写 TaskCard allowed_paths 与 verify 命令时先按此归属，别把 app/modules/... 的测试写到 tests/modules/... 路径。
- 来源：2026-08-31-machine-sillyspec-version task-02/task-03（design 首版路径写错目录，plan 阶段修正）

## 前端：jsdom 下 shadcn/Radix Avatar 的 AvatarImage 永不渲染，需 stub window.Image

- Radix AvatarImage 内部 `new Image()` 等 load 事件才挂 `<img>`，jsdom 不加载资源永不触发 → 头像图用例断言 img 永远拿不到、只见 AvatarFallback 首字。解法：测试里 stub `window.Image`（getter/setter 赋 src 时同步置 complete=true、naturalWidth=64 并 dispatch load），`URL.createObjectURL` 由 src/test/setup.ts 全局 polyfill 兜底。适用于一切经 useAvatarSrc（blob objectURL）→ shadcn Avatar 展示头像的组件测试（top-bar-avatar.test.tsx 实证）。
- 来源：2026-09-10-account-avatar-upload task-09

## Git Bash 本地 e2e 验收环境坑：/tmp 路径分叉、curl 多行 JSON 传参、无 PG 起 dev 后端

- Windows Git Bash 起本地 dev 后端做 curl 端到端验收时：(1) `DATABASE_URL=sqlite+aiosqlite:////tmp/x.db` 中 Python/aiosqlite 把 `/tmp` 解析为当前盘符根（`C:/tmp/x.db`），与 Git Bash 内建 `/tmp`（用户 AppData/Local/Temp）是两个文件——`rm -f /tmp/x.db` 清库清不掉真库，残留半建表结构会让重跑报 `table has no column named ...`。规避：DATABASE_URL 一律写显式 Windows 路径 `sqlite+aiosqlite:///C:/tmp/x.db`，清理时同步删两个路径。
- (2) curl `-d '<多行 JSON>'` 在 Git Bash 单引号内含中文/换行时报 `There was an error parsing the body`。规避：JSON 写文件后 `-d @<绝对路径>`。
- (3) 本地无 PG 时起 dev 后端：SQLite URL + SECRET_KEY 环境变量注入（.env 只在主仓 backend/ 下，worktree 缺失）；全量 alembic 链在 SQLite 跑不通（PG 专属 EXTENSION 语句），用 `import app.main` 后 `BaseModel.metadata.create_all`（根 conftest 同款 model 注册链）。
- 来源：2026-09-23-change-events-channel task-08
