---
author: qinyi
created_at: 2026-07-08T21:55:21
id: task-08
title: 测试写安全兜底（越界写 deny + 临时路径 allow）
priority: P0
estimated_hours: 2
depends_on: []
blocks: []
allowed_paths:
  - sillyhub-daemon/tests/permission-rules-temp-paths.test.ts
  - sillyhub-daemon/tests/policy/allowed-roots-temp-paths.test.ts
goal: 验证写安全兜底——临时路径写 allow、越界写 deny，CLI deny 与 PolicyEngine allowed_roots 双重校验均生效
implementation: 新建 permission-rules-temp-paths.test.ts 3 用例覆盖临时路径 allow、越界写 deny、不放行任意路径；新建 policy/allowed-roots-temp-paths.test.ts 3 用例覆盖 PolicyEngine 放行临时路径写、越界写 deny、工作区外临时路径外 deny
acceptance: pnpm test 全绿（新 2 文件 + 现有 permission-rules 不回归）；临时路径写 allow；越界写 deny；deny 列表仍含 Write(**) 通配；PolicyEngine 与 CLI deny 双重均有用例覆盖
verify: pnpm test 全绿，断言临时路径 allow + 越界 deny + Write(**) 通配兜底保留
constraints: 系统 temp 跨平台不同用 os.tmpdir() 等价避免平台耦合；c:\dev\null 是 Windows 专用 POSIX 上条件 skip 或 process.platform 分支；断言点随 task-03/04 实现方式调整
covers: [FR-007]
---
# task-08: 测试写安全兜底（越界写 deny + 临时路径 allow）

## 文件
新增 sillyhub-daemon/tests/permission-rules-temp-paths.test.ts
新增 sillyhub-daemon/tests/policy/allowed-roots-temp-paths.test.ts

## 操作步骤
### permission-rules（CLI deny/allow）
1. 新建 `sillyhub-daemon/tests/permission-rules-temp-paths.test.ts`，vitest 风格，参考 `tests/permission-rules.test.ts`（line 1-53 的 `buildWritePermissionRules` / `buildCcSettingsJson` 用法）。
2. 用例 1 `临时路径在 allow 列表`（FR-007 + task-03 验证）：
   - 调 `buildWritePermissionRules(['/tmp', 'c:\\dev\\null', '<系统 temp>', '~/.sillyspec/.runtime'])`（task-03 落地后支持临时路径）。
   - 断言 `allow` 含 `Write(c:/dev/null/**)`、`Write(<系统 temp>/**)`、`Write(.sillyspec/.runtime/**)`（Windows 反斜杠规范化为正斜杠，参考 permission-rules.test.ts:34-37）。
3. 用例 2 `越界写仍 deny`：
   - `allow` 含临时路径后，`deny` 仍含 `Write(**)` + `Edit(**)`（通配 deny 不变，临时路径靠 allow 优先匹配）。
   - 断言 `buildCcSettingsJson` 产出的 JSON `permissions.deny` 含 `Write(**)`，`permissions.allow` 含临时路径。
4. 用例 3 `不放行任意路径`：仅放行已知临时路径（c:\dev\null、系统 temp、.sillyspec/.runtime），断言 `Write(/etc/**)` 不在 allow（R-02 应对）。

### PolicyEngine allowed_roots
5. 新建 `sillyhub-daemon/tests/policy/allowed-roots-temp-paths.test.ts`，参考 `tests/policy/filesystem-policy.test.ts` / `tests/policy/runtime-policy.test.ts` 风格。
6. 用例 1 `临时路径在 allowed_roots 放行写`（task-04 验证）：
   - PolicyEngine configured `allowed_roots` 含临时路径。
   - 构造写请求（如 `Write` tool 写 `c:\dev\null\foo`），断言 PolicyEngine 判 allow。
7. 用例 2 `越界写 deny`：
   - `allowed_roots` 含临时路径 + 工作区根，写 `/etc/passwd` 或 `C:\Windows\System32\xxx`。
   - 断言 PolicyEngine 判 deny（R-01 应对：ask_user_only=true 时写工具 allow-through，写安全靠 PolicyEngine + CLI deny 双重）。
8. 用例 3 `工作区根外、临时路径外的路径 deny`：写 `~/Documents/secret` 断言 deny。

## 验收标准
- `pnpm test` 全绿（新 2 文件 + 现有 permission-rules.test.ts 不回归）。
- 临时路径（c:\dev\null / 系统 temp / .sillyspec/.runtime）写操作 allow。
- 越界写（/etc、C:\Windows、~/Documents 等）deny。
- `deny` 列表仍含 `Write(**)` 通配（allow 优先匹配临时路径，不破坏通配兜底）。
- PolicyEngine 与 CLI deny 双重校验都有用例覆盖。

## 验证
- vitest run sillyhub-daemon/tests/permission-rules-temp-paths.test.ts
- vitest run sillyhub-daemon/tests/policy/allowed-roots-temp-paths.test.ts
- 越界写 deny + 临时路径 allow 双断言通过

## 依赖
task-03（CLI deny 放行临时路径）、task-04（PolicyEngine allowed_roots 放行）。本 task 验证这两者落地效果，且证明 R-01（ask_user_only=true 写工具 allow-through 的写安全兜底）有效。

## 风险
- 系统 temp 路径跨平台不同（Windows `%TEMP%` / POSIX `/tmp`）：测试用 `os.tmpdir()` 等价或硬编码典型值，避免平台耦合（CLAUDE.md 规则 12 兼容三平台）。
- `c:\dev\null` 是 Windows 专用，POSIX 上该路径无意义：测试可条件 skip 或用 `process.platform` 分支。
- 若 task-03/04 实现选择"扩展 allowed_roots 列表"而非"独立放行规则"，测试断言点要跟着调整（断言 allowed_roots 含临时路径 vs 断言 allow 规则含临时路径）。
