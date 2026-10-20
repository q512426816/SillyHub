---
author: flow-machine-draft
created_at: 2026-10-20T04:50:02.475Z
---
# 需求规格（Requirements）— 2026-10-20-codex-models-fetch-candidates

## 功能需求

### FR-01: api_format=anthropic 且 base_url 以版本段结尾（如 /api/v1）的供应商，「获取模型列表」能拉到模型列表（候选含 base+/models）

- fetch_models 的 anthropic 分支候选 URL 列表必须追加 `base_url + "/models"` 兜底候选（置于既有候选之后），使 base 已含版本段的 OpenAI 风格端点（智谱 coding-plan `https://open.bigmodel.cn/api/v1` → `/api/v1/models`，实测 200）可命中；既有候选（`base+/v1/models`、剥 `/anthropic`/`/compatibility`/`/api` 后缀）顺序与内容必须保持不变（零回归）。

#### 场景：智谱 coding-plan 范式

- Given 供应商 api_format=anthropic、base_url=`https://open.bigmodel.cn/api/v1`
- When 用户点「获取模型列表」（fetch_models）
- Then 候选依次尝试 `/api/v1/v1/models`（404）→ `/api/v1/models`（命中 200），返回模型列表而非「该供应商不支持拉取模型列表」

### FR-02: base_url 尾部含 /openai/v1 的 OpenCode 范式供应商能拉到（候选含剥 /openai/v1 后拼 /v1/models）

- `_STRIP_SUFFIXES` 必须追加 `"/openai/v1"`，使 OpenCode Go Codex 范式（base=`https://opencode.ai/inference/go/openai/v1`，真实 models 在 `/inference/go/v1/models`，实测 200）经剥离候选命中；既有三个后缀的剥离行为不变。

#### 场景：OpenCode Go Codex 范式

- Given 供应商 api_format=anthropic、base_url=`https://opencode.ai/inference/go/openai/v1`
- When fetch_models
- Then 候选 `/openai/v1/v1/models`（404）→ 剥 `/openai/v1` 得 `/inference/go/v1/models`（命中 200）

### FR-03: 既有候选行为零回归（claude 条目 /api/anthropic 等既有命中路径不变）

- 既有命中路径禁止变化：Anthropic 官方根（base=无版本段）第一候选 `/v1/models` 命中；中转站 `/anthropic` 尾缀条目经剥离候选命中（cc-switch 范式既有用例断言的 URL 序列与 await_count 不变即视为零回归）。

#### 场景：既有用例零回归

- Given 既有 fetch_models 测试全集（test_fetch_models.py）与候选锚用例（test_api_format.py TestCandidateUrls）
- When 改动后跑 llm_provider 模块套件
- Then 全部通过——test_fetch_models.py 既有用例零断言改动；test_api_format.py 三个候选锚用例同步尾候选期望（前缀顺序仍被守卫）

### FR-04: 候选返回 200 但响应非 models 结构时必须继续尝试下一候选（智谱网关 200 兜底形态）

- 候选返回 200 但 body 不可解析或缺少模型列表字段（智谱网关对未知路径 200 兜底返错误 JSON，实测 2026-10-20 `/api/v1/v1/models` 返 `{"code":500,"msg":"404 NOT_FOUND"}`）时，必须视为本候选失败继续下一候选；全候选耗尽按解析失败（AllFailed）收口，禁止在首个 200-坏-body 候选直接终报。

#### 场景：智谱 coding 真实链路

- Given base_url=`https://open.bigmodel.cn/api/v1`，候选1 返回 200 错误 JSON、候选2 返回 200 真实 models
- When fetch_models
- Then 候选1 被跳过、候选2 命中返回模型列表（智谱用例即按此真实行为 mock）

### FR-05: 解析必须兼容智谱 coding 端点 `{models: [{slug, ...}]}` 形态

- 解析器在 body 无 `data` 列表字段时必须回退读 `models` 列表字段；条目无 `id` 字段时必须回退取 `slug` 作模型名（智谱 coding `/api/v1/models` 带认证真实返回该结构，实测 2026-10-20）；`data` 字段（OpenAI/Anthropic 标准）优先级不变。

#### 场景：智谱 models 形态解析

- Given 上游 200 返回 `{"models": [{"slug": "glm-5.3", "display_name": "glm-5.3"}]}`
- When 解析
- Then 返回模型列表 id=["glm-5.3"]

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/llm_provider/tests/test_fetch_models.py「智谱 coding 范式：base=/api/v1 候选含 base+/models 兜底命中」（新增）
FR-02: backend/app/modules/llm_provider/tests/test_fetch_models.py「OpenCode 范式：base 尾缀 /openai/v1 剥离候选命中」（新增）
FR-03: backend/app/modules/llm_provider/tests/test_fetch_models.py「test_404_candidate_fallback_succeeds」（既有用例零改动通过=零回归守卫）+「test_all_candidates_404_raises_unsupported」（既有恒定 mock 全候选耗尽守卫）
FR-04: backend/app/modules/llm_provider/tests/test_fetch_models.py「test_zhipu_coding_base_models_fallback_succeeds」（候选1 200 错误 JSON → 跳过 → 候选2 命中，真实链路 mock）
FR-05: backend/app/modules/llm_provider/tests/test_fetch_models.py「test_zhipu_coding_base_models_fallback_succeeds」（候选2 mock 为 {models:[{slug}]} 真实形态，断言 id=["glm-5.3"]）
