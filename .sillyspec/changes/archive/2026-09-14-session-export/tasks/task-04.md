---
id: task-04
title: '后端测试——test_session_export.py（内容断言/噪声排除表驱动/zip 结构/权限 404/降级/截断/413/路由顺序）'
title_zh: '后端测试——test_session_export.py（内容断言/噪声排除表驱动/zip 结构/权限 404/降级/截断/413/路由顺序）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 14:06:52
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-001@v1, D-002@v1]
expects_from:
  - 'task-03：POST /api/daemon/sessions/export 端点可用（SessionExportRequest body、text/markdown 与 application/zip 响应、RFC5987 Content-Disposition、413）'
allowed_paths:
  - NEW:backend/tests/modules/daemon/test_session_export.py
target_files: [NEW:backend/tests/modules/daemon/test_session_export.py]
goal: >
  为 task-03 落地的 POST /api/daemon/sessions/export 写 pytest 覆盖（chat md 内容断言/stdout 噪声排除表驱动/zip 结构/权限 404/附件降级/截断/413/路由顺序），
  固化 R-01 路由前置与 R-08 噪声排除语义，防后端实现与前端装配器漂移。
implementation:
  - 新建 backend/tests/modules/daemon/test_session_export.py（布局已核实：daemon 测试平铺于 backend/tests/modules/daemon/，与 design 路径一致；不改 conftest.py——既有 client 全接线 httpx.AsyncClient 与 db_session in-memory SQLite fixture 够用，Bearer 造法照 test_runtimes_usage_endpoint.py 的 _seed_admin + create_access_token 先例）
  - 造数据 helper：经 db_session 直接 ORM 插入 User + AgentSession/AgentRun/AgentRunLog（app/modules/agent/model.py）+ AgentSessionTask（backend/app/modules/daemon/model.py:662）+ SessionAttachment（app/modules/session_attachment/model.py），按 user_id 区分 owner/他人、软删置 deleted_at、群会话造参与者与非成员
  - chat md 内容断言：会话头（标题/时间/runtime/轮数）、user_input 行为用户消息、群聊行从 metadata_ 取 member_name 前缀、附件标记行 [附件:名|类型] 保留、stdout 幸存行剥 [ASSISTANT] 与 [LOG:\w+] 前缀为助手正文、stderr/tool_call/pending_input/system 行不出现在 md
  - '噪声排除表驱动：parametrize 样例直接搬 frontend/src/components/daemon/__tests__/session-log-assembler.test.ts 的 classifySessionLog 判定用例——AskUserQuestion 行、[TOOL_RESULT]（含 User answered 形态）、[(SYSTEM|RESULT)...] 前缀、[TOOL_USE] 文本行、[TASK_*] 生命周期、[ASSISTANT] Base directory for this skill: 技能装载载荷、Not logged in 与 API Error 网关错误行、[ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE] 撤回标记、[THINKING] 前缀均排除；[ASSISTANT] 正常答复与裸文本两例必须幸存；逐条断言 _assistant_text_from_stdout 返回'
  - zip 结构：标准库 zipfile 解包（io.BytesIO + ZipFile.namelist/read）——chat 多会话每会话一个 .md；full 单会话断言 full.json 顶层字段全（export_version/session/runs/logs/tasks/attachments/truncated/dropped_rows）与 attachments/{附件id}_{原名} 本体可读；full 多会话每会话一目录且目录名含 id 前 8 位防重名；Content-Disposition 断 RFC5987 编码文件名
  - 权限 404 不 mock 权限检查、走真实端点：跨用户访问他人会话、已软删会话、群会话非参与者均 404 且不泄露存在性；群参与者、workspace admin 与影子成员（allow_shadow_member_read）正常 200
  - '降级与限额：monkeypatch SessionAttachmentStorage.read_bytes 抛错 → 200 且 attachments 清单 missing: true、其余内容完整；截断经 monkeypatch 调小行数上限（或造超限行日志）断言保最早 20000 行 + truncated: true + dropped_rows 数值；413 用附件 bytes 元数据预聚合超 512MB（只造元数据不造真实文件）断言 413 且错误信息含分批导出提示'
  - 路由顺序：照 backend/tests/modules/daemon/test_runtimes_usage_endpoint.py:148 先例双证——app 路由表断言 /sessions/export 字面量前置于 /sessions/{session_id} 参数路由，且真实 POST /api/daemon/sessions/export 不返回被参数路由吞掉的 422
acceptance:
  - uv run pytest -q --no-cov tests/modules/daemon/test_session_export.py 全绿
  - 噪声排除表驱动用例与前端 session-log-assembler.test.ts 判定样例一一对应，且含至少 2 例幸存正文反例
  - 权限 404 三场景（跨用户/软删/群非成员）经未 mock 的真实 HTTP 验证；413/附件降级/截断各有独立用例
  - zip 全部断言经 zipfile 模块解包完成（条目名清单 + 内容 + RFC5987 文件名）
  - 路由顺序双证齐备（路由表顺序 + 真实请求非 422）
verify:
  - cd backend && uv run pytest -q --no-cov tests/modules/daemon/test_session_export.py
constraints:
  - 禁止跑全量测试（CLAUDE.md 规则 0），只跑本文件
  - 权限 404 用例不许 mock 权限检查，必须真实覆盖
  - zip 结构一律用标准库 zipfile 解包断言，不做字节前缀猜测
  - 不改 backend/conftest.py（fixture 已够用）；共享测试 helper 写在本测试文件内
  - 噪声排除样例禁自造替换，必须搬前端测试既有判定用例（R-08 防漂移）
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
