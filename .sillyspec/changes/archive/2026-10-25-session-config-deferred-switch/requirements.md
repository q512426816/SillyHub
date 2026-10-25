---
author: flow-machine-draft
created_at: 2026-10-25T11:14:01.126Z
---
# 需求规格（Requirements）— 2026-10-25-session-config-deferred-switch

背景：会话页空闲态点选供应商/模型/档案/思考级别时，现实现立即调 `injectSession`（空 prompt 静默切换），后端建一个空的「切换轮」，时间线立刻多出一个无内容轮次，干扰浏览。用户要求：点选只在前端记住，发送下一条消息时才随消息生效；发送成功后由时间线显示切换说明（D-001：不做「待生效」标记，静默记住）。

## 功能需求

### FR-01: 空闲点选仅前端记住不发请求

会话空闲态（非 running、非 ended、非 provisional）点选供应商/模型/档案/思考级别四个控件时，前端**禁止**发起任何网络请求（不调 `injectSession`、不调 `setSessionThinkingLevel`），**必须**将所选值暂存（控件直接显示所选值；D-001：**禁止**渲染「待生效」类标记、**禁止**弹暂存 toast——控件值变化即反馈）；时间线**禁止**出现新增轮次。

#### 场景：空闲点选供应商

- Given 会话空闲（无进行中轮）、引擎在切换白名单内
- When 用户在供应商下拉点选某供应商
- Then 无网络请求、时间线无新增轮次、供应商控件直接显示该供应商名（无任何暂存标记）

#### 场景：空闲点选思考级别

- Given 会话空闲、引擎支持思考级别
- When 用户在思考档位下拉点选某档
- Then 不调 thinking-level 端点、档位控件直接显示暂存档

### FR-02: 发送消息时暂存配置随消息生效

用户发送下一条消息时，暂存的供应商/模型/档案**必须**并入该次 `injectSession` 请求（随消息一轮生效，不单独建切换轮；运行中排队路径同并入——后端排队条目按字段保存、派发重放生效）；暂存的思考级别**必须**在该次发送时先调 `setSessionThinkingLevel` 再 inject（档位失败仅警告不阻塞消息发送，档位暂存保留）；发送受理成功（直发建轮/排队/引导任一路）后**必须**清空暂存并刷新会话详情；发送失败时暂存**必须**保留可重试。暂存为空时请求形态与现状完全一致（不多传任何字段，零回归）。

#### 场景：暂存后发送

- Given 用户已暂存供应商 A 与思考级别「高」
- When 用户发送一条消息
- Then 请求先调 thinking-level 设「高」，injectSession 带供应商 A 字段与消息文本，成功后暂存清空、配置条显示 A 与「高」

#### 场景：无暂存发送零回归

- Given 无任何暂存
- When 用户发送一条消息
- Then injectSession 请求参数形态与改动前一致（不带配置字段）

### FR-03: 选回当前生效值即取消暂存

某字段存在暂存时，再次在下拉中选回该字段的当前生效值**必须**清除该字段暂存（控件回显当前生效值）；其余字段暂存不受影响。

#### 场景：取消供应商暂存

- Given 供应商已暂存为 A（当前生效为 B）
- When 用户在供应商下拉点选 B
- Then 供应商暂存清除、显示 B；已暂存的档案/模型/思考级别保持不变

### FR-04: 运行中点选保持忙轮排队现状

轮运行中点选供应商/模型/档案**必须**保持现状：立即发 `injectSession` 纯切换请求，由后端忙轮排队覆盖合并（本轮结束后生效），不产生切换轮次；运行中思考档位控件保持禁用（D-002 档位切换仅空闲）。

#### 场景：运行中点选供应商

- Given 当前有进行中轮
- When 用户点选供应商 A
- Then injectSession 空 prompt 纯切换请求发出、toast 提示「本轮结束后生效」、无新增轮次

### FR-05: 结束/离线态不可切

会话已结束/失败或机器离线时，四个控件**必须**保持禁用且 title 说明原因（现状保持，零变化）。

#### 场景：会话已结束

- Given 会话 ended 或机器离线
- When 用户查看配置条
- Then 控件禁用、title 提示「会话已结束或机器离线，不可切换」

### FR-06: 发送后时间线显示配置切换说明行（D-001）

发送成功且本次生效配置相对上一轮有变化时，新轮块顶部**必须**独占一行显示配置切换说明（如「模型已切换 GLM-5.3(个人套餐) → GLM-5.3-FlashX(个人套餐)」，多维变化用「 · 」连接），视觉形态对齐轮次 meta 信息（居中虚线圆角药丸、muted 小字）；实时路（本次发送带暂存）由发送方前端权威生成（含会话级模型覆盖维度），历史路由轮次快照相邻对比生成（供应商/档案维度）；无变化 / 无前轮快照 / 未带暂存的轮**禁止**渲染该行。

#### 场景：暂存模型后发送

- Given 当前生效模型 A，用户暂存模型 B 后发送消息
- When 新轮受理建轮
- Then 该轮块顶部独占一行显示「模型已切换 A → B」

#### 场景：无配置变化不显示

- Given 无暂存直接发送消息
- When 新轮受理建轮
- Then 轮块顶部无切换说明行

### FR-07: 单测覆盖暂存与切换行行为

相关单测**必须**更新并通过：`session-config-bar.test.tsx` 空闲点选断言从「injectSession 调用」改为「暂存上抛且不 inject」；新增暂存显示/取消暂存/切换行文案与渲染/发送并入用例；运行中、ended、provisional 既有用例保持通过。

#### 场景：组件测试更新

- Given SessionConfigBar 挂载暂存模式（传 onStagedSwitch）
- When 空闲点选供应商
- Then 测试断言 onStagedSwitch 收到正确 patch 且 injectSession 未被调用

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「idle 点选供应商/档案/模型/档位 → 暂存上抛不 inject 无 toast」
FR-02: frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx「发送消息并入暂存配置并清空」
FR-03: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「选回当前生效值 → 取消该字段暂存」
FR-04: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「running 点选供应商照常 injectSession 忙轮排队」
FR-05: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「ended 全部禁用」
FR-06: frontend/src/components/daemon/__tests__/page-helpers-config-change-line.test.ts(x)「buildConfigChangeLine 文案 + enrich 相邻对比」
FR-07: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「暂存模式全量回归」
