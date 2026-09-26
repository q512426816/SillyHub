---
author: flow-machine-draft
created_at: 2026-09-26T07:26:45.050Z
---
# 需求规格（Requirements）— 2026-09-26-assets-test-binding-raw-text

## 功能需求（agent 填写——每条 FR 格式 ### FR-NN: 标题 + Given/When/Then；FR 进知识索引，写清行为语义）

<!--AGENT:FR区 agent 填写功能需求（直接书写，不走 amend） -->
<!-- 参考摘录 8 条合并为 FR-01~04（FR-01 吸收 01~02、FR-02 对应 03、FR-03 吸收 04~06、FR-04 对应 07~08） -->

### FR-01: 测试绑定行附带手写原文（raw_binding）
Given test-trace.json 摘录时截断 `::用例` 后缀，tests 数组只剩文件级路径，而含测试类/用例与描述的手写原文就在归档变更目录 requirements.md 的 AGENT 测试绑定槽里，
When assets 聚合服务解析测试绑定（GET /changes/{cid}/assets），
Then 每条 ChangeTestRow 按锚点（FR-NN）匹配挂上新字段 `raw_binding`（绑定槽注释行之后的内容行原文，多行拼接）；requirements.md 缺失、槽不存在或解析失败时 `raw_binding` 为 None，既有字段与行为零变化（fail-open）。

### FR-02: 类型契约同步
Given ChangeTestRow schema 新增字段，
When 后端 schema 变更落盘，
When 按 CLAUDE.md 规则 21 运行 `pnpm gen:types`，
Then `frontend/src/lib/api-types.ts` 与 `backend/openapi.json` 随提交更新，不落手写类型债。

### FR-03: 前端资产卡显示原文
Given 测试绑定行的 raw_binding 存在且与 tests 文件路径列表不同值（即原文含用例级/描述信息），
When 资产卡渲染测试绑定组，
When 该行下方显示原文小字（muted 色，超长截断，悬停 title 可见全文）；raw_binding 为 None 或与 tests 等价时不渲染该行。

### FR-04: 测试与类型门禁全绿
Given 三处改动落盘，
When 运行后端 change 聚焦测试（test_assets 补「含绑定槽原文的 requirements 提取、无 requirements 容错为 None」两用例）与前端 change-assets-card 套件（补原文显示断言，既有 15 用例不回归）及 `tsc --noEmit`，
Then 全部通过且 0 类型错误。



## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
backend/tests/modules/change/test_assets.py::raw_binding 槽原文提取 用例 与 ::无 requirements 容错 None 用例

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
生成物同步由 gen:types 幂等零漂移承担（backend/openapi.json + frontend/src/lib/api-types.ts 提交面肉眼可核）;无行为断言面,不适用:纯生成物

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::raw_binding 原文显示 用例(行下小字含原文与 title 悬停;None 时行不渲染断言)

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
backend uv run pytest tests/modules/change/ 聚焦全绿 + 前端资产卡全套一次跑过 + pnpm exec tsc --noEmit exit 0(2026-09-26 实测)
