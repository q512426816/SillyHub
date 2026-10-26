---
author: flow-machine-draft
created_at: 2026-10-26T05:16:17.246Z
---
# 需求规格（Requirements）— 2026-10-26-config-staged-all-states

背景：上一变更（2026-10-25-session-config-deferred-switch，已归档）实测两处缺口：①轮**运行中**点选供应商/模型/档案仍走旧路径立即 `injectSession`（忙轮排队条目派发后建静默切换 run，用户看到新增轮次）；②暂存供应商后模型子下拉不显示（渲染条件与会话真值供应商绑定，未跟随暂存值）。用户定调：**四个控件、任何状态点选都只暂存，绝不触发请求与新轮次**。

## 功能需求

### FR-01: 轮运行中点选供应商/模型/档案/思考级别不发任何网络请求(不 inject 不 POST),仅暂存

轮运行中（running）点选供应商/模型/档案/思考级别**必须**与空闲态一致：不发任何网络请求（不 `injectSession`、不 POST thinking-level）、不产生排队条目与静默切换轮，仅前端暂存上抛（onStagedSwitch）；思考档位控件在暂存模式挂载时**禁止**因 running 禁用（ended/离线仍禁用）。

#### 场景：运行中点选供应商

- Given 会话有进行中轮、配置条挂载暂存模式
- When 用户点选供应商 A
- Then 无网络请求、无排队条目、无新增轮次；onStagedSwitch 上抛 llm_provider_id=A；控件显示 A

#### 场景：运行中点选思考档位

- Given 会话有进行中轮、思考档位控件渲染
- When 用户点选档位「高」
- Then 档位控件可点（不因 running 禁用）、无 POST 请求、暂存上抛 thinking_level=high

### FR-02: 暂存供应商后模型子下拉立即显示,候选为暂存供应商的模型列表

暂存供应商后（staged.llm_provider_id 存在），模型子下拉**必须**立即按暂存供应商渲染：显示条件（暂存供应商存在于列表）、候选模型列表（暂存供应商的 models）、候选缺失兜底全部以暂存供应商为基准派生；当前值显示维持暂存模型优先（既有行为零回归）。取消暂存（选回当前生效供应商）后回退会话真值供应商派生。

#### 场景：暂存供应商后模型下拉出现且候选正确

- Given 会话真值无供应商（模型下拉隐藏）、暂存模式挂载
- When 用户点选供应商 A（列表含 A，A 有模型 m1/m2）
- Then 模型子下拉立即显示，候选项为「默认 + m1 + m2」

#### 场景：取消暂存回退真值

- Given 供应商已暂存 A、真值为 B
- When 用户选回 B（cancel 暂存）
- Then 模型下拉候选回退为 B 的模型列表

### FR-03: 发送时暂存配置随消息一并生效(含排队路径),不产生静默切换轮

暂存配置（含运行中暂存的）随用户下一条消息发送时**必须**一并生效：空闲直发路径随 injectSession options；忙轮排队路径随排队条目配置字段（后端派发建**带消息的正常轮**，非空 prompt 静默切换轮）；暂存为空时请求形态与现状逐字段一致（零回归）。

#### 场景：运行中暂存后发送

- Given 运行中暂存供应商 A，用户发送消息（走排队路径）
- Then 排队条目携带 llm_provider_id=A 与消息文本；本轮结束后派发为正常消息轮，时间线无静默切换轮

### FR-04: 空闲态行为零回归

空闲态点选/取消暂存/受控显示/切换说明行（上一变更 FR-01..07 全部行为）**必须**保持不变；未挂 onStagedSwitch 的存量调用面保持点选即切换旧行为（兼容锚）。

#### 场景：空闲态回归

- Given 上一变更全部既有测试
- When 全量重跑
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「running 点选供应商/模型/档案/档位 → 仅暂存上抛不 inject 不 POST」
FR-02: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「暂存供应商后模型下拉显示且候选为新供应商模型；取消暂存回退」
FR-03: frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx「发送并入暂存（含排队路径）零回归」
FR-04: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「空闲态与既有兼容锚全量回归」
