---
id: task-05
title: 'backend 全链（schema 三 DTO+create 形参+placement+lease+归一化对端+_ENDPOINT_ORDER+GET/POST 端点+服务）+测试'
title_zh: 'backend 全链（schema 三 DTO+create 形参+placement+lease+归一化对端+_ENDPOINT_ORDER+GET/POST 端点+服务）+测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 00:48:35
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-03, FR-04, FR-05]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/session/service/create.py
  - backend/app/modules/agent/placement.py
  - backend/app/modules/daemon/lease/context.py
  - backend/app/modules/daemon/router/__init__.py
  - backend/app/modules/daemon/router/session_crud.py
  - backend/app/modules/daemon/session/service/thinking_level.py
  - backend/app/modules/daemon/tests/test_session_thinking_level_endpoint.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
target_files:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/session/service/create.py
  - backend/app/modules/agent/placement.py
  - backend/app/modules/daemon/lease/context.py
  - backend/app/modules/daemon/router/__init__.py
  - backend/app/modules/daemon/router/session_crud.py
  - NEW:backend/app/modules/daemon/session/service/thinking_level.py
  - NEW:backend/app/modules/daemon/tests/test_session_thinking_level_endpoint.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
provides:
  - contract: thinking-level 两端点+DTO
    fields: [SessionCreateRequest.thinking_level, SessionThinkingLevelsResponse, SessionThinkingLevelRequest, SessionThinkingLevelResponse, api-types 产物]
expects_from:
  task-01:
    - contract: ProviderCaps
      needs: [thinking_level]
goal: >
  backend 全链（FR-03 创建链前两跳+FR-04/05 服务面）：schema 三 DTO+create.py 形参（不写
  config 列，P1-8/NG-04）+placement lease metadata+lease/context.py 白名单+router/__init__
  _ENDPOINT_ORDER 两序（P1-4）+GET/POST 两端点+NEW 服务函数（照 compact.py：三校验+caps+
  状态+RPC 派发+异常映射）+gen:types 产物（P1-2）+端点测试。
implementation:
  - 'schema.py——① SessionCreateRequest 加 thinking_level: str | None = Field(default=None, max_length=16)（:203/:204 model 同款邻位，注释标 FR-03：七档词表、None/空串=引擎默认）② NEW SessionThinkingLevelsResponse {levels: list[str], current: str | None = None} ③ NEW SessionThinkingLevelRequest {level: str} 与 SessionThinkingLevelResponse {ok: bool, error: str | None = None}（design §接口定义原文）'
  - 'create.py——create_session 加 thinking_level: str | None = None 形参（:48 model 同款），仅在调 placement 处透传（:138 model=model 邻位加 thinking_level=thinking_level）；不写 config 列——:170-171 config["model"] 先例不模仿（P1-8/NG-04 定案：档位不落库，切换后由引擎 session 状态维持）'
  - 'placement.py——prepare_interactive_dispatch 加 thinking_level: str | None = None 形参（:653 model 同款）+ lease metadata 写入（:836 if model: metadata["model"] 先例旁加 if thinking_level: metadata["thinking_level"] = thinking_level）'
  - 'lease/context.py——interactive 分支 build_claim_payload 白名单透传（:510 payload["model"] 同款加 payload["thinking_level"] = lease_meta.get("thinking_level")）'
  - 'router/__init__.py——_ENDPOINT_ORDER（:145）加两序：GET thinking-levels 与 POST thinking-level（照 :214-216 compact_session 注释+条目先例；import 期硬校验 :268 自动覆盖——compact 已留痕同型坑，漏加启动即红，P1-4）'
  - 'session_crud.py——照 :592-610 compact 端点形态加两路由：GET /sessions/{session_id}/thinking-levels → SessionThinkingLevelsResponse；POST /sessions/{session_id}/thinking-level（body SessionThinkingLevelRequest）→ SessionThinkingLevelResponse；服务 import 照 :52 compact 先例；docstring 标 FR-04/05+依赖 daemon 两 RPC（session_get_thinking_levels/session_set_thinking_level）'
  - 'NEW session/service/thinking_level.py——照 compact.py 先例三件：① get_session_thinking_levels：归属校验+活跃校验+caps thinking_level 键校验（provider_caps.py @generated 查表，cursor 拒）→ ws RPC session_get_thinking_levels → {levels, current} ② set_session_thinking_level(session_id, level)：同三校验+合法档校验（七档词表 backend 镜像常量，注释与 daemon THINKING_LEVELS 同源互指——无跨语言单源通道）+状态校验（running/reconnecting 拒绝）→ ws RPC session_set_thinking_level → {ok, error} ③ 异常映射：RemoteError/未知 method → 结构化 error「daemon 未支持思考级别，请升级 daemon」（brownfield 旧 daemon 兼容）'
  - 'gen:types（P1-2）——先确认前端 node_modules 健康（pnpm exec tsc --version 能跑、.bin 有 shim，CLAUDE.md 21 惯例），跑 pnpm -C frontend gen:types 产出 backend/openapi.json + frontend/src/lib/api-types.ts 并随卡提交（不让类型落后后端形成债）'
  - 'NEW test_session_thinking_level_endpoint.py——照 test_session_compact_endpoint.py 形态：鉴权拒（未登录）/归属拒/caps=false 拒（cursor）/POST 非法档 400/POST running 状态拒/GET 正常回 {levels,current}/POST 正常回 {ok}/旧 daemon RemoteError→「请升级 daemon」文案/创建链断言（thinking_level 进 lease metadata 且不进 config——P1-8）；ws 层 mock 不依赖真 daemon'
acceptance:
  - 两端点路由注册且 _ENDPOINT_ORDER import 期硬校验过（启动不红）；GET/POST DTO 形态与 design §接口定义一致（current/error 可空）
  - 创建链逐跳断言绿：thinking_level 经 create 形参→placement lease metadata→claim payload 白名单透传，且 AgentSession.config 无此键（P1-8/NG-04）
  - gen:types 产物（backend/openapi.json + frontend/src/lib/api-types.ts）已提交，四个新 DTO/字段出现在 api-types.ts（P1-2）
  - pytest 新套件全绿 + 既有 test_session_compact_endpoint.py 零回归 + ruff/mypy 过
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_thinking_level_endpoint.py app/modules/daemon/tests/test_session_compact_endpoint.py -q
  - cd backend && uv run ruff check app/modules/daemon app/modules/agent
  - cd backend && uv run mypy app/modules/daemon
  - pnpm -C frontend gen:types
  - pnpm -C frontend exec tsc --noEmit
constraints:
  - thinking_level 不写 AgentSession.config 不落库（NG-04/P1-8 定案）；切换后档位由引擎 session 状态维持，平台不镜像——重启会话档位回引擎默认
  - 七档词表 backend 镜像常量与 daemon THINKING_LEVELS 以注释同源互指（改档位两侧同步钉死）；backend 不 import daemon 任何 TS 产物
  - 端点不直连 daemon 内部——一律经 ws RPC 方法名字符串派发（与 task-03 契约按名对接，跨 wave 无类型依赖）；旧 daemon RemoteError 映射「请升级 daemon」
  - openapi.json + api-types.ts 只经 gen:types 生成不手写；测试 mock ws 层不依赖真 daemon；Windows / Linux / macOS 兼容
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
