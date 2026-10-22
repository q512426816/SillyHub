---
author: flow-machine-draft
created_at: 2026-10-21T07:45:00.000Z
---
# 需求规格（Requirements）— 2026-10-21-provider-default-ui-hint

## 功能需求

### FR-01: 已设默认供应商时，各「不指定」下拉项文案显示「不指定（默认：{默认供应商名}）」；未设默认保持「不指定（本机默认）」

- 会话配置栏（session-config-bar）、群聊建群向导成员卡（create-group-wizard）、群成员面板（member-panel）的「不指定（本机默认）」固定文案**必须**改为按用户 is_default 供应商动态显示：有默认显示「不指定（默认：{name}）」，无默认保持「不指定（本机默认）」；文案计算**必须**收敛为 lib 单一 helper（`noProviderLabel`）。

#### 场景：有默认

- Given：用户 is_default 供应商为「智谱 GLM」
- When：打开会话配置栏供应商下拉 / 群聊成员卡供应商下拉
- Then：兜底项文案为「不指定（默认：智谱 GLM）」

#### 场景：无默认零回归

- Given：用户未设默认供应商
- When：同上
- Then：兜底项文案为「不指定（本机默认）」（现状）

### FR-02: 会话轮 timeline 的未选供应商显示对齐（null 时显示默认供应商名，无默认保持本机默认）

- 会话轮 whoLine 的 providerName（page-helpers 组装，llm_provider_id null → null）**必须**改为：null 时回填用户默认供应商名（llmProviders 中 is_default 项）；无默认保持 null（TurnTimeline 既有 fallback「本机默认」）。历史轮用当前默认名标注的轻微失真**可以**接受（优于恒显「本机默认」的误导）。

#### 场景：未选供应商轮显示默认名

- Given：用户默认供应商「智谱 GLM」，历史轮 llm_provider_id=null
- When：timeline 渲染该轮
- Then：轮头显示「智谱 GLM」而非「本机默认」

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/lib/api/__tests__/llm-providers.test.ts「noProviderLabel 有默认/无默认分支」；frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「兜底项文案动态化」（若该测试文件存在，动码时按实际文件落位）
FR-02: frontend/src/components/daemon/__tests__ 相关 page-helpers 用例（动码时按实际测试文件落位，断言 null 时回填默认名）
