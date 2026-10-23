---
author: flow-machine-draft
created_at: 2026-10-23T03:33:04.639Z
---
# 需求规格（Requirements）— 2026-10-23-session-dialog-input-align

## 功能需求

### FR-01: dialog 模式发送受理即清空输入框文本，不等网络响应

- 会话浮窗（session-panel-dialog.tsx，mode="dialog"）在发送动作受理时（守卫全通过、请求尚未发出/在途）必须同步清空输入框文本（setInput("")），禁止依赖 onSendSettled 在 injectSession 响应到达后才清空；覆盖活跃轮直发（submitFollowup）、忙轮排队/引导（sendToServerQueue）、空闲首句创建（createSession）三条路径。附件 chips 与 @ 联想选中仍按原时序（响应成功后由 onSendSettled 清理），失败路径保留可重试。

#### 场景：活跃轮直发立即清空

- Given: dialog 关联真会话且空闲（无 currentRunId），输入框已填 "AAA"
- When: 点击发送（injectSession 请求在途未响应）
- Then: 输入框立即显示为空，无 "AAA" 残留

#### 场景：忙轮排队立即清空

- Given: dialog 关联真会话且 running（currentRunId 非空），输入框已填 "AAA"
- When: 点击发送（sendToServerQueue 请求在途）
- Then: 输入框立即清空

#### 场景：空闲首句创建保持立即清空

- Given: dialog 处 idle（无会话），输入框已填 "AAA"
- When: 点击发送（createSession 在途）
- Then: 输入框立即清空（既有语义保持）

### FR-02: dialog 模式发送失败时原文恢复到输入框可重试，附件 chips 保留

- dialog 三条发送路径失败时必须将发送原文恢复到输入框：空闲首句 createSession 失败（既有实现清空后不恢复，属丢文本缺陷）、活跃轮 submitFollowup 失败（抛错由 handleSend 捕获）、忙轮 sendToServerQueue 失败；恢复必须仅当输入框当前为空（不覆盖失败窗口期用户新输入），并同步写回 localStorage 草稿键；附件 chips 在失败路径必须保留。

#### 场景：空闲首句创建失败恢复

- Given: dialog idle，输入 "AAA" 点击发送（输入框已受理即清）
- When: createSession 以网络错误/4xx 失败
- Then: 输入框恢复 "AAA"，view.errorMsg 展示错误，可再次点击发送

#### 场景：活跃轮直发失败恢复

- Given: dialog 活跃轮空闲态，输入 "AAA" 点击发送
- When: injectSession 失败
- Then: 输入框恢复 "AAA"（占位轮已回滚），可重试

#### 场景：忙轮排队失败恢复

- Given: dialog 忙轮态，输入 "AAA" 点击发送
- When: injectSession 满员 409 / 网络错误
- Then: 输入框恢复 "AAA"，errorMsg 提示，可重试

### FR-03: dialog 模式受理即同步清 localStorage 草稿键，发送在途卸载/切走再切回不残留

- dialog 发送受理瞬间必须同步调用 writeSessionDraft 清空当前草稿键（真会话按 view.sessionId 组装；idle 态 `__pre__:<workspaceId|'-'>`），禁止只依赖「setState → 写草稿 effect」链路（浮窗卸载时 effect 不执行，草稿残留已发送文本——与 page 模式同源根因）；失败恢复时同步写回原文，保证卸载后切回仍可重试。

#### 场景：真会话受理即清草稿键

- Given: dialog 关联会话 A，输入 "AAA" 点击发送（请求在途）
- When: 浮窗在途卸载（关闭/切换到其它会话）后重新打开会话 A
- Then: 输入框为空，localStorage `sillyhub.sessions.draft.<sessionIdA>` 无 "AAA" 残留

#### 场景：idle 受理即清 __pre__ 草稿键

- Given: dialog idle（workspaceId=ws-1），输入 "AAA" 点击发送（createSession 在途）
- When: 创建成功后浮窗切到真会话
- Then: `__pre__:ws-1` 键已被清空，重开新建浮窗不显示 "AAA"

### FR-04: dialog idle 态（无会话）输入框恒空白：不回读 __pre__ 草稿并清残留键；真会话草稿持久化不回归

- dialog idle 态（view.sessionId 为 null）挂载或从真会话重置回 idle 时，输入框必须初始化为空白，禁止回读 `__pre__:<workspaceId|'-'>` 草稿（新建=全新开始的用户预期，对齐 page 模式语义），并清空该残留键；真会话态（view.sessionId 非空）草稿持久化（切换/刷新恢复）必须保持既有行为不回归。

#### 场景：带残留草稿重新打开新建浮窗为空白

- Given: localStorage `__pre__:ws-1` 存在未发送草稿 "旧内容"
- When: 打开 dialog 新建浮窗（idle，workspaceId=ws-1）
- Then: 输入框为空白，且该键被清空

#### 场景：真会话草稿不回归

- Given: dialog 关联会话 A，输入 "BBB" 未发送
- When: 关闭浮窗后重新打开会话 A
- Then: 输入框恢复 "BBB"（草稿持久化特性保留）

## 成功标准承接（原文逐字，来源 flow start --input）

- 发送受理即清：dialog 活跃轮直发/忙轮排队/steered 路径在请求在途时输入框即空，不等响应 → FR-01
- 失败恢复：submitFollowup / sendToServerQueue / idle 首句创建失败时原文回到输入框（输入框已有新内容则不覆盖）可原地重试 → FR-02
- 受理即同步清 localStorage 草稿键（真会话 view.sessionId / 预会话 __pre__:<workspaceId>），发送在途切走再切回不残留 → FR-03
- dialog idle 态（无会话）输入框恒空白：不回读 __pre__ 草稿并清残留键；真会话草稿持久化（切换/刷新恢复）不回归 → FR-04
- 既有 dialog 相关用例按新语义修订，新增 FR-01~04 行为用例；tsc --noEmit 零错，相关测试全绿 → 测试绑定四行 + 任务注册表 task-05

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「dialog 发送受理即清输入框文本（FR-01）」
FR-02: frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「dialog 发送失败恢复文本（FR-02）」
FR-03: frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「dialog 受理即同步清草稿键（FR-03）」
FR-04: frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「dialog idle 态恒空白 + 真会话草稿不回归（FR-04）」
