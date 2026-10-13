---
author: flow-machine-draft
created_at: 2026-10-13T02:34:28.398Z
---
# 需求规格（Requirements）— 2026-10-13-session-scroll-layout-storm

## 功能需求

### FR-01: scroll 事件处理器（onScroll 及其同步调用链 handleLoadEarlier 的锚捕获段）内不再有同步强制布局：锚点重申与锚捕获的 DOM 遍历/几何读取全部改 rAF 合帧执行

- onScroll 程序性滚动分支（非 isTrusted）必须不再同步调用 anchorPin 的 apply（读 offsetTop + 写 scrollTop 均为强制布局），必须改 rAF 合帧执行且同帧多次 scroll 事件只排程一个 rAF 回调；锚捕获段（handleLoadEarlier 内，fetch await 之后）经核查不在 scroll 事件栈内、每页至多一次，属可接受布局点，本变更禁止扩大改动面。

#### 场景：程序性 scroll 高频风暴合帧

- Given：会话面板已建 prepend 滚动锚（锚定期内 anchorPinRef 指向 apply）；
- When：同帧连续派发多个程序性 scroll 事件（jsdom new Event 为 isTrusted=false）；
- Then：requestAnimationFrame 排程至多一次（合帧），rAF 回调执行前 apply 不跑（零同步布局）。

### FR-02: 行为零回归：触顶翻页仍按 scrollTop<=48 触发、prepend 后视口钉回语义不变、用户真实滚动（isTrusted）弃锚逻辑不变

- 触顶判定（scrollTop <= LOAD_EARLIER_TRIGGER_PX 触发 handleLoadEarlier）必须保持不变；rAF 合帧只影响钉回重申时机（延迟至多一帧，16ms 量级），钉回目标与语义必须不变；用户真实滚动（isTrusted=true）必须立即弃锚并取消挂起的钉回 rAF 回调（不产生迟到的程序性钉回）。

#### 场景：用户接管弃锚

- Given：锚定期内有一个已排程未执行的钉回 rAF；
- When：用户真实滚动（isTrusted scroll 事件）到达；
- Then：挂起 rAF 被取消，用户滚动不被迟到的 apply 拉回。

### FR-03: anchorPin rAF 句柄有清理（卸载/锚失效不泄漏 rAF 回调）

- 钉回 rAF 句柄必须在三处清理：用户真实滚动弃锚分支取消挂起句柄；滚动监听 effect cleanup（现有 activeTurnRaf 取消处同点）一并取消；组件卸载不遗留回调。

#### 场景：主路径

- Given：挂起钉回 rAF 存在；
- When：滚动监听 effect 清理（换会话/卸载）执行；
- Then：句柄被 cancelAnimationFrame 取消并置空，无幽灵回调。

### FR-04: 相关既有测试（session-panel 触顶加载/锚定/跳转用例）全绿

- session-history-scroll.test.tsx 全部既有用例（触顶翻页/游标推进/锚定期 interval 配对/回到会话开头）必须保持绿——它们是零回归的行为锁。

#### 场景：主路径

- Given：本变更合入后；
- When：运行 session-history-scroll.test.tsx；
- Then：既有用例零失败，新增合帧用例通过。

### FR-05: 单页 4 份 useDaemonMachines 轮询合并不在本变更范围（另立变更），本变更不动轮询

- 本变更必须不触碰 useDaemonMachines 及其调用方（轮询合并属独立优化，另行立项），只收敛 scroll 布局风暴路径。

#### 场景：主路径

- Given：本变更 diff；
- When：审查改动面；
- Then：仅 session-panel-page.tsx 滚动监听段与 session-history-scroll.test.tsx 变化，轮询相关零改动。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx「程序性 scroll 钉回改 rAF 合帧：事件内零同步 scrollTop 写入、下一帧才执行（2026-10-13-session-scroll-layout-storm）」
FR-02: test/frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx「scroll to top triggers loadEarlier with before cursor, older content prepends」（触顶判定零回归）+「程序性 scroll 钉回改 rAF 合帧…」（钉回仍执行且在下一帧，语义保留）；isTrusted 弃锚分支（jsdom 无法构造 isTrusted=true 事件，浏览器安全限制）不适用：由代码审查覆盖弃锚取消行（design 已记录）
FR-03: 不适用：jsdom 下全局 requestAnimationFrame/cancelAnimationFrame 被锚 effect 双层 rAF 等多消费者共用，句柄归属单测不可辨（实测 spy 方案被污染失败）；三处清理为同款单行守卫，由代码审查覆盖 + FR-01 用例的行为断言间接锁定（rAF 回调存在且执行）
FR-04: test/frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx「既有触顶翻页/游标推进/锚定期 interval 配对/回到会话开头全部用例（回归锁）」
FR-05: 不适用：范围排除声明（轮询合并另立变更），由 design 文件变更清单的改动面审查覆盖
