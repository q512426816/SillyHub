---
author: flow-machine-draft
created_at: 2026-11-04T05:57:52.066Z
---
# 需求规格（Requirements）— 2026-11-04-session-quota-pill-follow-provider

## 功能需求

### FR-01: 配置条切换供应商（暂存未发送）后，底部额度胶囊立即按新供应商展示，不再显示其他供应商的数据

- 必须：额度胶囊的「当前供应商」来源改为「配置条暂存值优先，未暂存时用会话已生效值」；切换暂存供应商后胶囊立即按新供应商渲染，禁止继续展示旧供应商或其他供应商的数据。

#### 场景：暂存切换供应商

- Given 会话当前供应商为 A，用户在配置条把供应商切到 B（尚未发送）
- When 配置条暂存状态更新
- Then 底部额度胶囊立即按 B 展示（B 可查则展示 B 的额度；B 不可查则展示 B 的「暂不支持额度查询」状态），不再显示 A 的数据

#### 场景：取消暂存

- Given 已暂存供应商 B
- When 用户取消暂存（回到 A）
- Then 胶囊立即回到 A 的展示状态

### FR-02: 选中供应商不支持额度查询时，胶囊明确显示该供应商名与「暂不支持额度查询」，不渲染其他家额度数据

- 必须：当选中供应商存在但不在后端可查名单（`detectUsageProvider` 返回 null）时，胶囊面显示简短状态「不支持」（供应商名与完整说明「暂不支持额度查询」在悬停 title 与点击浮层）；禁止以其他可查供应商的额度数据顶替胶囊面。

#### 场景：选中 OpenCode Go

- Given 会话选中 OpenCode Go（base_url 不在可查名单），同时智谱可查且有数据
- When 额度胶囊渲染
- Then 胶囊面显示「不支持」，悬停 title 包含「OpenCode Go｜暂不支持额度查询」，不显示智谱的百分比或余额

### FR-03: 选中供应商可查但本次无数据时，胶囊显示该供应商名与「额度暂无数据」

- 必须：选中供应商属于可查名单但本轮查询未返回数据（弱依赖降级 / 鉴权失效清除条目）时，胶囊面显示简短状态「无数据」（供应商名与完整说明「额度暂无数据」在悬停 title 与点击浮层）；禁止回落为展示其他供应商数据或全局灰字提示。

#### 场景：智谱 quota 为空

- Given 选中智谱，quota 端点返回 null，同时 Kimi 可查且有数据
- When 额度胶囊渲染
- Then 胶囊面显示「无数据」，悬停 title 包含「智谱GLM｜额度暂无数据」，不显示 Kimi 的百分比

### FR-04: 点击胶囊浮层仍可查看其余可查供应商的额度，且选中供应商置顶

- 必须：浮层第一节必须是当前选中供应商（有数据展示明细；无数据/不可查展示状态说明），其后按名称列出其余可查供应商及其额度；选中供应商不得重复出现。

#### 场景：选中不可查供应商 + 其他家可查

- Given 选中 OpenCode Go，智谱与 Kimi 可查
- When 用户点击胶囊
- Then 浮层依次显示「OpenCode Go（暂不支持额度查询）」「智谱GLM 明细」「Kimi 明细」

### FR-05: 未指定供应商（本机默认）时保持原有全部可查供应商聚合展示行为

- 必须：`providerId` 为空（本机默认 / 暂存「本机默认」）时，胶囊与浮层行为与变更前一致：聚合全部可查供应商、面取排序第一家、空数据显示「暂无供应商额度信息」。

#### 场景：本机默认

- Given providerId 为 null，智谱可查
- When 胶囊渲染
- Then 显示智谱额度百分比（与变更前一致）

### FR-06: 相关单测更新并通过，lint 通过

- 必须：更新 `ctx-usage-bar.test.tsx` 中因口径变化失效的用例，并新增 FR-01~FR-05 的覆盖；相关测试与 lint 全部通过。

#### 场景：回归

- Given 代码修改完成
- When 运行相关单测与 lint
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx「配置条暂存切换供应商（providerId 变化）→ 胶囊面立即改用新供应商数据」
FR-02: frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx「选中不可查供应商 → 面显示「不支持」，不发起额度查询、不顶替其他家数据」
FR-03: frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx「选中可查供应商无数据（quota=null）→ 面显示「无数据」，不顶替其他家数据」
FR-04: frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx「选中不可查供应商 → 浮层仍可查看其余可查供应商，且选中供应商置顶」
FR-05: frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx「providerId=null（本机默认）→ 照常聚合展示全部可查供应商额度」
FR-06: frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx「QuotaPill 全套用例」+ eslint
