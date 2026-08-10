---
id: task-03
title: backend unit tests dual-format auth/url/strip/probe/set_default (mock httpx)
title_zh: 后端单测双格式鉴权/URL剥路径/候选URL/探测归一/set_default透传（mock httpx 不联网）
author: qinyi
created_at: 2026-08-09 01:31:00
priority: P0
depends_on: [task-02]
blocks: []
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/tests/test_api_format.py
related_tests:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/tests/test_api_format.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/tests/test_fetch_models.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/tests/test_probe.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/tests/test_llm_provider.py
goal: >
  新建 test_api_format.py 单测，mock httpx（不真实联网）覆盖：双格式鉴权头、完整 URL 剥路径、openai/anthropic 候选 URL、探测归一、create/update/set_default 透传 api_format；并保护 anthropic 既有行为零回归（FR-01~04, NFR-02）。
implementation:
  - 新建 tests/test_api_format.py，沿用既有 tests 目录的 fixture/conftest 风格（参考 test_fetch_models.py / test_probe.py 的 mock httpx 写法）
  - 鉴权头用例：_build_auth_headers(openai_chat) == {"Authorization": f"Bearer {key}"}；_build_auth_headers(anthropic, ANTHROPIC_API_KEY) 含 x-api-key + anthropic-version；_build_auth_headers(anthropic, ANTHROPIC_AUTH_TOKEN) 含 Bearer
  - 剥路径用例：_strip_openai_suffix("https://opencode.ai/zen/v1/chat/completions") == "https://opencode.ai/zen/v1"；尾斜杠 + 非 chat/completions 结尾的 URL 各一条
  - 候选 URL 用例：openai 产 [base/models, base/v1/models]（base 含/不含 /v1 各一例）；anthropic 候选 URL 输出与改动前逐字一致（取旧用例期望值钉死）
  - fetch_models 双形态：编辑态（provider 行 api_format=openai_chat）mock httpx 返回标准 OpenAI {data:[{id,owned_by}]}，断言请求头=Bearer + 请求 URL 在候选集；新建态传 api_format 缺省走 anthropic
  - probe_provider：openai 格式 mock 探测成功；anthropic 格式探测路径逐字不变
  - create/update/set_default 透传：create 带 api_format=openai_chat 写入后 read 回 openai_chat；set_default（anthropic，Wave1 阶段 openai set_default 的守护在 task-06）经 service 不报错；明文 key 不进响应/日志（断言 api_key_masked 仅 masked）
  - 所有外网请求一律 monkeypatch httpx（respx 或 monkeypatch Client.get），零真实联网（NFR-02 / 不依赖 opencode.ai 可用性）
acceptance:
  - test_api_format.py 全绿，覆盖双格式鉴权头 + 剥路径 + 候选 URL + fetch_models 双形态 + probe + create/update/set_default 透传
  - 既有 test_fetch_models/test_probe/test_llm_provider/test_router 零回归（anthropic 行为钉死）
  - 无任何用例真实联网（grep 用例不含 opencode.ai 真实域名命中网络；仅作字符串期望可）
verify:
  - cd backend && uv run pytest app/modules/llm_provider/tests/test_api_format.py -q --no-cov
  - cd backend && uv run pytest app/modules/llm_provider -q --no-cov（模块全绿）
constraints:
  - 仅新建 test_api_format.py + 必要时补既有用例调用签名（task-02 改了 helper 签名）；非测试逻辑本身有误禁止改测试凑通过（规则 9）
  - 明文 key 永不断言进响应（NFR-02）；mock httpx 不联网
  - 不碰 model/schema/service/probe/router 实现（task-01/02 范围）
provides:
  - test_api_format.py：双格式鉴权/URL 归一/候选 URL/fetch_models 双形态/probe/create-update-set_default 透传的单测覆盖
  - anthropic 零回归证据（既有用例 + 新用例 anthropic 分支钉死）
expects_from:
  task-02: [schema api_format 字段（Create/Update/Read/FetchModelsRequest），_build_auth_headers(api_key,auth_field,api_format)，_candidate_urls(base_url,api_format)，_strip_openai_suffix(base_url)，fetch_models/probe_provider 透传 format]
---

# task-03 实现笔记

design 锚点：§6 文件清单第 13 行（新增 tests/test_*）/ §9 兼容策略（anthropic 零回归）/ plan 任务总表 task-03 行（FR-01~04, NFR-02）。

mock httpx 写法照既有 test_fetch_models.py / test_probe.py（respx 或 monkeypatch），保持模块测试风格一致。完整 URL 剥路径期望值用 design §1 实测的 opencode.ai 形态作字符串锚点（不入网，仅断言归一函数输出）。

本任务只新增测试文件 + 必要的既有测试签名跟进；helper/签名契约由 task-02 提供，expects_from 列的字段/函数名是硬依赖。若 task-02 实现命名与 expects_from 不符，先回 task-02 对齐契约再写测试，勿在测试里包一层别名掩盖。
