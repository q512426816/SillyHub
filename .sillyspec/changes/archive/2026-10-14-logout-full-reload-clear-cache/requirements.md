---
author: flow-machine-draft
created_at: 2026-10-14T02:34:28.807Z
---
# 需求规格（Requirements）— 2026-10-14-logout-full-reload-clear-cache

## 功能需求

### FR-01: 桌面端确认退出后整页跳转 /login，内存缓存（QueryClient/zustand/模块级）随页面重置，不再 SPA 内跳

- 桌面端用户在退出确认弹窗点「确认退出」后，页面必须通过 `window.location.assign("/login")` 整页跳转回登录页（内存中的 React Query 缓存、zustand store、模块级缓存随页面销毁重置），禁止使用 next/router 的 `router.replace` 在 SPA 内跳转完成登出。

#### 场景：主路径

- Given：已登录用户在桌面端打开退出确认弹窗
- When：点击「确认退出」（logout 接口调用完成后，即使失败也走 finally）
- Then：`window.location.assign` 收到 `"/login"`，且登出跳转未走 `router.replace`

### FR-02: 移动端退出后整页跳转 /m/login，同上

- 移动端账号页点「退出登录」后，页面必须通过 `window.location.assign("/m/login")` 整页跳转回移动登录页（内存缓存随页面销毁重置），禁止使用 `router.replace` 在 SPA 内跳转完成登出。

#### 场景：主路径

- Given：已登录用户在移动端账号页
- When：点击「退出登录」（`logout()` 完成后，即使失败也走 finally）
- Then：`window.location.assign` 收到 `"/m/login"`，且登出跳转未走 `router.replace`

### FR-03: 补登出跳转方式测试：两处断言 window.location.assign 被调用且不再走 router.replace

- 桌面端（app-shell）与移动端（m/account）各自必须有一条测试用例，明确断言登出跳转通过 `window.location.assign` 整页跳转发生、且 `router.replace` 未被调用（登出路径上），防止后续改回 SPA 跳转导致缓存残留回归。

#### 场景：主路径

- Given：登出流程测试环境（fetch 与 window.location 已 stub）
- When：触发两处登出入口
- Then：两条用例分别断言 `window.location.assign` 的目标地址，且 `router.replace` 零调用

### FR-04: 现有相关测试（app-shell / m-account / auth）不回归

- 本次改动完成后，受影响测试文件（`app-shell.test.tsx`、`m/account/page.test.tsx`、`lib/__tests__/auth.test.ts`）的全部既有用例必须保持通过；因 mock 结构调整（如 next/navigation mock 改为可断言的 hoisted 对象）需要同步适配时，适配后断言语义不得弱化。

#### 场景：主路径

- Given：本次改动前上述测试文件全部通过
- When：登出跳转方式改动落地后按同口径重跑
- Then：全部用例通过，无新增失败

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/__tests__/app-shell.test.tsx「确认退出 → window.location.assign 整页跳转 /login（不走 router.replace）」
FR-02: frontend/src/app/m/account/page.test.tsx「退出登录 → window.location.assign 整页跳转 /m/login（不走 router.replace）」
FR-03: frontend/src/components/__tests__/app-shell.test.tsx「确认退出 → window.location.assign 整页跳转 /login（不走 router.replace）」
FR-03: frontend/src/app/m/account/page.test.tsx「退出登录 → window.location.assign 整页跳转 /m/login（不走 router.replace）」
FR-04: frontend/src/lib/__tests__/auth.test.ts「logout 清空 session（不回归基线）」
FR-04: frontend/src/components/__tests__/app-shell.test.tsx「侧边栏菜单高亮 — 最长匹配独占（ql-20260903-011-66a4）」（全文件回归）
