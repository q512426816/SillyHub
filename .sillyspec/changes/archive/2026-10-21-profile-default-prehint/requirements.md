---
author: flow-machine-draft
created_at: 2026-10-21T08:50:00.000Z
---
# 需求规格（Requirements）— 2026-10-21-profile-default-prehint

## 功能需求

### FR-01: provisional 态未选档案时，档案按钮显示用户默认档案名（无默认保持「未指定」）

- 预会话（provisional，发首句前）配置栏档案按钮**必须**在未选档案且用户有默认档案时显示默认档案名（创建会话将注入它）；无默认保持「未指定」现状。

#### 场景：预会话显示默认

- Given：用户默认档案「SillySpec 极速变更」，悬浮面板预会话态
- When：渲染配置栏（未选档案）
- Then：档案按钮显示「SillySpec 极速变更」

### FR-02: 运行中/已结束会话未选档案保持「未指定」；下拉「不指定」项 provisional 且有默认时显示「不指定（默认：{名}）」

- 非 provisional 会话（已创建）未选档案**必须**保持「未指定」（默认档案只在创建时注入，存量会话不追溯，显示真值）；档案下拉兜底项文案：provisional 且有默认 →「不指定（默认：{名}）」，否则保持「不指定（无人格）」（运行中切到不指定=本会话无人格，语义准确）。

#### 场景：运行中会话真值

- Given：默认档案已设，某运行中会话 agent_profile_id=null（默认设置前创建）
- When：渲染配置栏
- Then：档案按钮显示「未指定」

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「provisional 未选档案显示默认档案名」
FR-02: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「非 provisional 未选保持未指定」「下拉兜底项 provisional 动态文案」
