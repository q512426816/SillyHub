---
author: flow-machine-draft
created_at: 2026-10-23T02:51:38.964Z
---
# 需求规格（Requirements）— 2026-10-23-session-input-clear-fix

## 功能需求

### FR-01: 点击/回车发送后输入框文本立即清空，不等网络响应

- 会话面板（page 模式，含真会话直发/忙轮排队/预会话首句创建）与群聊面板发送动作受理时，必须同步清空输入框文本（setInput("")），禁止等待 injectSession/createSession/sendGroupMessage 的 HTTP 响应到达后才清空；附件 chips 与 @ 联想选中仍按原时序（响应成功后清），失败路径保留可重试。

#### 场景：真会话直发立即清空

- Given: 真会话输入框已填 "AAA"，会话空闲
- When: 点击发送按钮（injectSession 请求在途未响应）
- Then: 输入框立即显示为空，无 "AAA" 残留

#### 场景：忙轮排队同样立即清空

- Given: 会话 running（忙轮），输入框已填 "AAA"
- When: 点击发送（消息入服务端排队，HTTP 在途）
- Then: 输入框立即清空

#### 场景：群聊发送立即清空

- Given: 群聊输入框已填 "AAA"
- When: 回车发送（sendGroupMessage 在途）
- Then: 输入框立即清空

### FR-02: 发送失败（网络错误/后端拒绝）时输入文本恢复到输入框可重试，附件 chips 全程保留

- 发送请求失败（catch 分支）时，必须将发送时的原文恢复到输入框（仅当输入框当前为空——不覆盖用户在失败窗口期新输入的内容），并同步写回 localStorage 草稿键；附件 chips 在失败路径必须全程保留（立即清空只针对文本）。

#### 场景：直发失败恢复

- Given: 真会话输入框 "AAA"，点击发送后输入框已立即清空
- When: injectSession 以网络错误/4xx 拒绝
- Then: 输入框恢复 "AAA"（或保留用户新输入），可再次点击发送

#### 场景：预会话首句创建失败恢复

- Given: 预会话输入 "AAA" 点击发送（createSession 在途，输入框已清空）
- When: createSession 失败
- Then: 输入框恢复 "AAA"，内联错误提示展示，可重试

### FR-03: 发送受理即同步清 localStorage 草稿键（含预会话 __pre__:scope 键），切换会话/组件卸载后草稿不残留已发送内容

- 发送动作受理瞬间必须同步调用 writeSessionDraft 清空当前会话草稿键（真会话按 sessionId 组装的键；预会话 __pre__:<workspaceId|'-'>:<runtimeId> 键），禁止依赖「setState → 写草稿 effect」链路清草稿（组件因会话切换卸载时该 effect 不执行，草稿残留——本次修复的根因）。

#### 场景：预会话发送成功后草稿键不残留

- Given: 预会话输入 "AAA" 发送，createSession 成功后组件随选中切换卸载
- When: 用户再次点「＋」以同工作区+同智能体进入预会话
- Then: 输入框为空白（__pre__:scope 键已被清）

#### 场景：真会话发送在途切换后切回不残留

- Given: 真会话 A 发送 "AAA"（HTTP 在途），期间用户切换到会话 B
- When: 切回会话 A
- Then: 输入框为空（消息已在服务端受理/排队，不重复显示在输入框）

### FR-04: 新建会话（预会话态）输入框恒空白：不回读旧草稿，且每次重新进入预会话（同机器同引擎）输入框重置

- 预会话态（sessionId=null）挂载时输入框必须初始化为空白，禁止回读 localStorage 预会话草稿（未发送草稿跨「重新新建」回读是用户报障场景）；每次重新进入预会话（即使同 workspace+runtime、React key 值相同）必须重挂载组件重置全部输入态（门户对预会话 key 追加自增 nonce）；真会话草稿持久化（切换/刷新恢复）必须保持既有行为不回归。

#### 场景：填写未发送后重新新建为空白

- Given: 预会话输入 "AAA" 未发送，用户切走到会话列表其他会话
- When: 再次点组头「＋」选择同机器同智能体新建会话
- Then: 输入框为空白，不显示 "AAA"

#### 场景：真会话草稿不回归

- Given: 真会话 A 输入 "BBB" 未发送
- When: 切换到会话 B 再切回 A
- Then: 输入框恢复 "BBB"（草稿持久化特性保留）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「发送受理即清输入框文本（FR-01）」+ frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx「发送受理即清：sendGroupMessage 未响应时输入框已空且草稿键已清」
FR-02: frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「发送失败恢复文本（FR-02）」+ frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx「发送失败：文本恢复到输入框可重试」
FR-03: frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「受理即同步清草稿键（FR-03）」
FR-04: frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「page 预会话草稿入口隔离（task-01 / D-001）> 同一入口重进：输入框恒空白」+ frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「同机器同智能体再次「＋」新建：预会话输入框重置（nonce 强制重挂载）」+ frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「page 真会话草稿切换时序（R-01 基线锁定）」（真会话草稿不回归）
