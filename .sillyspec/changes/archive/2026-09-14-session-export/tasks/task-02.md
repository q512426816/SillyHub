---
id: task-02
title: 'implement-session-export-service'
title_zh: '后端导出服务——session/service/export.py 模块函数（权限复用/chat md/full json/噪声排除纯函数/zip/附件取流降级/413 预检/保最早 20000 行截断）+ __init__.py 类壳委托'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 14:06:52
priority: P0
depends_on: []
blocks: ['task-03']
requirement_ids: [FR-02, FR-04, FR-05]
decision_ids: [D-001@v1, D-002@v1]
provides:
  - 'SessionExportResult dataclass（media_type, filename, payload: bytes）'
  - 'export_sessions(svc, user_id, *, session_ids, tier, storage) 模块函数，经 SessionService.export_sessions 类壳一行委托暴露'
expects_from:
  - 'task-01: SessionExportRequest 形状（session_ids list[UUID] 1~50 + tier chat/full）——本服务收原生参数，不 import schema 模型'
allowed_paths:
  - NEW:backend/app/modules/daemon/session/service/export.py
  - backend/app/modules/daemon/session/service/__init__.py
target_files:
  - NEW:backend/app/modules/daemon/session/service/export.py
  - backend/app/modules/daemon/session/service/__init__.py
goal: >
  新建 session/service/export.py 模块函数 export_sessions（照 read_model.py 模块
  函数先例）实现导出核心——权限复用详情口径、chat Markdown/full JSON 渲染、
  stdout 噪声排除纯函数、zip 打包、附件取流降级、512MB 413 预检、每会话保最早
  20000 行截断；__init__.py SessionService 类壳加一行委托供 facade 调用。
implementation:
  - 新建 export.py：定义 SessionExportResult dataclass 与 async export_sessions(svc, user_id, *, session_ids, tier, storage)（复用 svc._session 请求级 DB 会话；签名照 design.md「接口定义」）
  - 权限逐会话对齐详情口径：owner（user_id 相等且 deleted_at IS NULL）未命中走 get_group_accessible_session(allow_shadow_member_read=True)（同 get_agent_session_logs 探测顺序），仍 None 抛 DaemonSessionNotFound——任一不可访问整包 404，不做部分成功
  - 日志查询自建 asc 变体：照 read_model.get_agent_session_logs 的 join/权限骨架另写 timestamp ASC + limit 20000（每会话独立计数、保最早、算 dropped_rows），聚合键只用 AgentRun.agent_session_id（绝不用 resume 语义的 AgentRun.session_id）
  - 纯函数 _assistant_text_from_stdout()：噪声排除规则逐条对齐 design.md（锚点 frontend session-log-assembler.ts 的 classifySessionLog）——空行/AskUserQuestion/[TOOL_RESULT]（含 User answered 形态）/[(SYSTEM|RESULT)…]/[TOOL_USE]/[TASK_*]/技能装载载荷/CLI 合成鉴权与网关错误/[ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE] 行排除，[THINKING] 前缀行 chat 档排除；幸存行剥 [ASSISTANT] 与 [LOG:\w+] 前缀
  - _render_chat_markdown()（会话头+按 run 分轮；user_input=用户消息、群聊行从 metadata_ 取 member_name 前缀、附件 [附件:名|类型] 标记行原样保留）+ _render_full_json()（export_version=1，session/runs/logs/tasks/attachments/truncated/dropped_rows 字段照 design full JSON 产物结构）
  - full 档附件：按 session_attachments 预聚合 bytes，整包 >512MB 抛 413（取流前预检）；经 SessionAttachmentStorage.read_bytes 取流写入 zip attachments/ 目录（zip_path=attachments/{id}_{原名}），单件失败降级清单 missing=true 继续，不整体 500
  - CPU 密集段（zip/json/md 序列化）用 anyio.to_thread.run_sync 包裹（照 ppm X-002 先例，daemon 域自建 helper 不 import ppm）；_sanitize_zip_name()（非法字符/Windows 保留名/结尾点空格修剪，空回退「未命名会话」）+ 标题后拼 id 前 8 位防重名 + _rfc5987_filename()
  - __init__.py：SessionService 类壳新增 async def export_sessions 一行委托（from . import export as _export，self 作首参透传）
acceptance:
  - export_sessions 签名与 design.md 一致并返回 SessionExportResult；chat×单会话=text/markdown、chat×多会话与 full×任一=application/zip，文件名 RFC5987 中文（会话导出_档位_时间戳）
  - 跨用户/软删/群非成员任一命中即整包 DaemonSessionNotFound（404 不泄露存在性）
  - 每会话独立超 20000 行截断保最早，产物含 truncated=true 与 dropped_rows；噪声排除纯函数行为与 design.md 规则逐条一致
  - 附件总量 >512MB 抛 413；单附件取流失败降级 missing=true 且整包继续
  - SessionService.export_sessions 委托可达，既有 session service 导入面/patch 面零破坏
verify:
  - cd backend && uv run pytest -q --no-cov tests/modules/daemon -k "session_export or read_model"
  - cd backend && uv run ruff check app/modules/daemon
  - cd backend && uv run mypy app
constraints:
  - 遵循 design.md「接口定义」签名与 full JSON 顶层结构（export_version=1 版本化）
  - 保最早 20000 行用自建 timestamp ASC+limit 查询，禁止复用 get_agent_session_logs 的 newest-N（desc 再反转）语义
  - CPU 密集段走 anyio.to_thread.run_sync；禁止跨模块 import ppm（RFC5987/时间戳文件名 helper 在 daemon 域自建）
  - 服务收原生参数，不 import task-01 的 schema 模型；不写测试（task-04）；不动 router 与 facade（task-03）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
