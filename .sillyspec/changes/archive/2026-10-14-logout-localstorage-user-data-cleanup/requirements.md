---
author: flow-machine-draft
created_at: 2026-10-14T02:52:48.814Z
---
# 需求规格（Requirements）— 2026-10-14-logout-localstorage-user-data-cleanup

## 功能需求

### FR-01: 全仓清查 localStorage 键并区分用户域（按 sessionId/groupId/会话内容索引）与设备级偏好（主题/输入框高度/浮球位置等），清单落 design

- 清查结论必须落入 design.md 的用户域前缀注册表（带来源文件锚点）：用户域=键名含动态资源 id（sessionId/groupId）或承载用户输入内容的键；设备级=跨登录语义上有意保留的全局偏好。禁止在代码或文档之外维护第二份清单。

#### 场景：主路径

- Given：frontend/src 全量源码
- When：按 `localStorage|sessionStorage` 全量扫描并按「键名是否含动态资源 id / 用户内容」二分
- Then：design.md 记录 6 个用户域前缀（单聊草稿/会话视图模式/群聊草稿/群打开锚点/会话活性状态/未读标记）与保留面（主题/记住登录名/侧边栏折叠/输入框高度/浮球/宠物/各面板宽度/详情面板开合/新建会话默认机器）

### FR-02: 主动登出（桌面+移动）与 401 被动登出在整页跳转前统一清理全部用户域键，设备级偏好保留

- 三条登出路径（桌面 app-shell 确认退出、移动账号页退出、lib/api.ts 401 单飞失败分支）必须在整页跳转前调用统一清理函数；清理必须删除全部用户域前缀键、禁止触碰设备级键与 session store persist 键（后者由既有 clear() 置空）。

#### 场景：主路径

- Given：localStorage 同时存在 6 类用户域键与设备级键
- When：任一登出路径执行到跳转前
- Then：用户域键全部消失，设备级键原样保留

#### 场景：storage 异常容错

- Given：localStorage 某键 removeItem 抛错（隐私模式/配额异常）
- When：清理函数执行
- Then：不向上抛错（登出跳转不被阻断），其余可删键仍被清

### FR-03: 清理逻辑集中一处注册表实现，新增用户域键只改注册表不散落

- 用户域键必须以「前缀注册表 + 单一清理函数」集中在一个 lib 模块（frontend/src/lib/logout-storage.ts）；三处登出调用点只 import 函数，禁止各自枚举键名。

#### 场景：主路径

- Given：清理实现
- When：审读三处调用点代码
- Then：调用点均无键名硬编码，注册表为唯一键清单源

### FR-04: 补清理行为测试：登出后用户域键被清、设备级键保留

- 必须有单测覆盖：6 类用户域前缀（含预会话草稿变体）被清、设备级键（含 `sillyhub.sessions.new.machineId` 这类同命名空间但非用户域的键）保留、前缀精确匹配不误删、storage 异常容错；且两处主动登出组件用例断言清理函数被调用。

#### 场景：主路径

- Given：logout-storage 单测与两处登出组件用例
- When：执行测试
- Then：全部断言通过（清理函数被调 + 键面变化符合预期）

### FR-05: 现有相关测试不回归

- 改动完成后，logout-storage / app-shell / m-account / api / token-refresh / auth 相关测试必须全部通过；typecheck 必须通过。

#### 场景：主路径

- Given：本次改动前上述测试全部通过
- When：改动落地后按同口径重跑
- Then：全部用例通过，无新增失败

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：本条为清查+落档要求，验证面是 design.md 注册表内容本身（归档评审核对），无独立可执行测试
FR-02: frontend/src/lib/__tests__/logout-storage.test.ts「6 类用户域前缀全清、设备级键保留、前缀精确匹配」
FR-02: frontend/src/components/__tests__/app-shell.test.tsx「确认退出 → window.location.assign 整页跳转 /login（不走 router.replace）」（扩展：断言清理函数被调）
FR-02: frontend/src/app/m/account/page.test.tsx「退出登录 → window.location.assign 整页跳转 /m/login（不走 router.replace）」（扩展：断言清理函数被调）
FR-03: frontend/src/lib/__tests__/logout-storage.test.ts「removeItem 抛错时容错继续清理其余键（不阻断登出）」
FR-04: frontend/src/lib/__tests__/logout-storage.test.ts「6 类用户域前缀全清、设备级键保留、前缀精确匹配」
FR-05: frontend/src/lib/__tests__/api.test.ts（既有全量回归）
FR-05: frontend/src/lib/__tests__/token-refresh.test.ts（401 单飞分支回归）
