---
author: flow-machine-draft
created_at: 2026-10-12T01:51:16.320Z
---
# 需求规格（Requirements）— 2026-10-12-ws-ref-atomic-caret

## 功能需求

### FR-01: 点击标签内部任意位置，光标吸附到标签前或后边界（不进入内部）

- 必须：光标无选区且落在标签内部时，落位事件（click/keyup/select）必须把光标吸附到最近边界（前半去头、后半去尾）；禁止光标停留在标签内部。

#### 场景：主路径

Given 标签在场且光标被点击/键盘落入内部 / When 落位吸附触发 / Then selectionStart 位于标签边界之一。

### FR-02: 左/右方向键在标签边界处一次跳过整块（贴尾按左到块头，贴头按右到块尾）；shift 选区扩展不受影响

- 必须：无选区时 ←/→ 触碰标签区间必须整块跳过（preventDefault + 复位光标到对侧边界）；shift/meta/ctrl/alt 组合与有选区时禁止拦截。

#### 场景：主路径

Given 光标贴标签尾 / When 按 ← / Then 光标到块头；对称 → 从块头到块尾。

### FR-03: 标签内部打字/删字/IME 组字/粘贴（目标 range 与标签部分重叠）一律拒绝；选区完整覆盖整块的删除放行

- 必须：beforeinput 目标 range 与任一标签部分重叠（交集非空且未完整覆盖）必须 preventDefault；选区完整覆盖整块（含两侧额外文本）必须放行。

#### 场景：主路径

Given 目标 range 部分触碰标签 / When beforeinput / Then 输入被拒绝、value 不变；Given range 完整覆盖标签 / Then 放行随选区删除。

### FR-04: Home/End/Ctrl+方向落入标签内部时兜底吸附到最近边界

- 必须：非 ←/→ 键移动（Home/End/Ctrl+方向）落位后由同一吸附逻辑兜底；SHOULD 吸附幂等（位置未变不重复 set）。

#### 场景：兜底

Given Home 落入标签内部 / When select 事件触发吸附 / Then 光标到最近边界。

### FR-05: 退格贴尾整删/× 角标删除/发送置换等既有行为零回归

- 必须：既有退格整删、× 角标删除、mention 联想、IME 组合期守卫行为必须零变化；相关既有测试必须全绿。

#### 场景：零回归

Given 贴尾按退格 / Then 整枚标签删除（既有）；Given 联想浮层激活 / Then ↑↓/Enter/Tab/Esc 归浮层（既有）。

### FR-06: 单聊+群聊两输入区一致；相关测试全绿

- 必须：两输入区必须接同一 hook 同款行为；hook 测试 + 两输入区既有套件合跑全绿。

#### 场景：主路径

Given 群聊输入框 / Then 与单聊同款跳块/吸附/拒绝行为。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/daemon/__tests__/use-atomic-ref-caret.test.tsx「光标落入标签前半 → 吸附块头；后半 → 吸附块尾」
FR-02: test/frontend/src/components/daemon/__tests__/use-atomic-ref-caret.test.tsx「贴尾按 ← 跳到块头；再按一次才离开标签」+「贴头按 → 跳到块尾」+「shift+方向（选区扩展）与普通文本处方向键不拦截」
FR-03: test/frontend/src/components/daemon/__tests__/use-atomic-ref-caret.test.tsx「标签内部打字/删字（部分重叠）拒绝」+「选区完整覆盖整块放行；无 token 区间放行；无目标区间放行」
FR-04: test/frontend/src/components/daemon/__tests__/use-atomic-ref-caret.test.tsx「光标落入标签前半 → 吸附块头」keyUp 路径（select 兜底同函数）
FR-05: test/frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx + session-input-bar-mention.test.tsx + group-chat-panel.test.tsx 既有套件合跑 126/126（logs/atomic-final.log）
FR-06: test/frontend/src/components/daemon/__tests__/use-atomic-ref-caret.test.tsx 全文件 + 两输入区接线（onKeyDown 首位/IME 守卫后）——同上合跑覆盖
