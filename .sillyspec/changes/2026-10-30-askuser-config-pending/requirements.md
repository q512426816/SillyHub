---
author: qinyi
created_at: 2026-10-30T11:55:00+08:00
---
# 需求规格（Requirements）— 2026-10-30-askuser-config-pending

背景：会话配置暂存能力已全量交付（2026-10-25-session-config-deferred-switch：空闲点选仅暂存随下一条消息生效；2026-10-26-config-staged-all-states：运行中含思考档位全部放开为暂存、模型下拉跟随暂存供应商），但暂存**完全静默**（D-001 静默决策）——用户点选后无任何「已记住待生效」反馈，且暂存为面板内存 state 刷新即丢。用户裁决（2026-10-30）：补逐控件待生效高亮（不加文字角标）+ sessionStorage 短期持久化；生效时机维持「随下一条消息」语义不动；范围仅主会话页面（page 模式）。

## 功能需求

### FR-01: 有暂存的控件渲染待生效高亮（brand 描边+浅底，无文字角标）

SessionConfigBar 四控件（供应商/模型/思考档位/档案）在暂存模式（staged prop 挂载）下，**必须**对存在暂存字段的控件（`staged[field] !== undefined`）渲染高亮态：控件胶囊 `ring-1 ring-brand-400`（brand 语义阶，随 data-theme 换肤）+ `bg-brand-50` 浅底，悬停 title 改为「已记住，将随下一条消息发送时生效」；**禁止**加常驻文字角标/汇总说明行（用户裁决 2026-10-30）。无暂存字段控件外观与现状逐类名一致（零回归）。

#### 场景：暂存供应商后控件高亮

- Given 会话配置条挂载暂存模式、当前无任何暂存
- When 用户点选供应商 A（onStagedSwitch 上抛 llm_provider_id=A）
- Then 供应商控件胶囊亮 brand 描边+浅底，title=「已记住，将随下一条消息发送时生效」；模型/思考档位/档案控件外观不变

#### 场景：取消暂存高亮消失

- Given 供应商已暂存 A（控件高亮）
- When 用户选回当前生效供应商（cancel 上抛，字段删除）
- Then 供应商控件高亮消失，回现状外观

### FR-02: 发送成功后高亮全部消失、配置条回显新生效值

消息发送受理成功（现有 settleStagedAfterSend 收敛点）后，**必须**清空暂存（既有行为）并同步清除持久化条目，全部高亮消失；配置条经会话详情刷新回显新生效值（既有行为零改动）。思考档位切换失败保留暂存的既有例外语义不变（该档位高亮保留）。

#### 场景：暂存后发送成功

- Given 四控件均有暂存（全高亮）
- When 用户发送消息且受理成功
- Then 高亮全部消失、sessionStorage 对应条目清除、配置条回显新生效值

### FR-03: 暂存实时持久化到 sessionStorage（按会话隔离，含档案显示名）

暂存状态变更**必须**实时写入 sessionStorage：key 按会话 id 隔离（`sh:config-staged:<sessionId>` 命名族），值为 `{ config: SessionConfigStaged, labels: 档案/供应商显示名 }` JSON；恢复点=面板挂载/sessionId 切换时读取（SSR 环境守卫 typeof window）；清除点=发送成功收敛、会话切换；关闭标签页由浏览器自动清除（不残留）。**禁止**跨会话复用（sessionId 不匹配的条目不读）。

#### 场景：暂存后刷新页面恢复

- Given 供应商+档案已暂存（高亮显示中）
- When 用户刷新页面（F5）
- Then 暂存恢复，两控件重新亮高亮、显示暂存值；发送下一条消息时配置照常随消息生效

#### 场景：切换会话不串台

- Given 会话 A 有暂存
- When 用户切换到会话 B
- Then 会话 B 配置条无高亮（不读 A 的条目）；切回 A 时恢复

#### 场景：持久化数据损坏静默丢弃

- Given sessionStorage 条目 JSON 非法/结构异常
- When 面板挂载读取
- Then 静默按空暂存处理、清除坏条目，不抛错不弹提示

### FR-04: askuser 待答场景行为零逻辑改动（仅受益于可视化）

askuser 待答期间（PendingDialogDock 互斥替换输入框）配置条**保持**现有可点可暂存行为（2026-10-26 已交付），本次**零**交互/链路改动：不响应答复提交（respondSessionPermission 不携带配置、不清暂存）、不改同轮回喂语义；问答期间暂存的控件亮 FR-01 高亮，提交回答后 AI 无缝继续（当前段旧配置跑完），下一条消息自动用新配置（高亮到那时消失）。

#### 场景：问答期间暂存思考档位

- Given askuser 待答中、思考档位控件可点（staged 模式）
- When 用户点选档位「高」
- Then 档位控件亮高亮、无网络请求；提交回答后 AI 无缝继续；用户下一条消息发送时档位生效、高亮消失

### FR-05: 现有行为零回归

未挂 staged 的存量调用面（点选即切换旧行为）、空闲暂存、忙轮排队携带配置、模型下拉跟随暂存供应商、发送时暂存并入 inject options、思考档位失败保留语义——**必须**全部保持不变；相关既有测试全绿。

#### 场景：存量调用面回归

- Given 未挂 onStagedSwitch 的 SessionConfigBar 调用点
- When 全量重跑相关测试
- Then 全部通过、无高亮渲染（无 staged 无标记）

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「暂存供应商后控件亮待生效高亮（ring+bg-brand-50+title）」「取消暂存后高亮消失回现状类名」「未挂 staged 调用面无高亮」
FR-02: frontend/src/components/daemon/__tests__/session-panel-staged-list-refresh.test.tsx「发送成功后暂存清空且 sessionStorage 条目清除」「思考档位失败保留时残留态照写持久化」
FR-03: frontend/src/components/daemon/__tests__/session-panel-staged-list-refresh.test.tsx「暂存变更实时写 sessionStorage（含 labels）」「刷新挂载按会话恢复暂存」「切换会话不串台/切回恢复」「坏 JSON 静默丢弃清坏条目」
FR-04: frontend/src/components/daemon/__tests__/pending-dialog-dock.test.tsx（既有用例零改动回归——本 FR 为零改动承诺，由既有 askuser 链路测试全绿 + design task-03 代码核对保障）
FR-05: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx（既有全部用例零回归）+ frontend/src/components/daemon/__tests__/session-panel-staged-list-refresh.test.tsx（既有全部用例零回归）
