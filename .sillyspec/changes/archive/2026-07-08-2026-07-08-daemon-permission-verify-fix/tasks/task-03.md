---
author: qinyi
created_at: 2026-07-08T21:55:21
id: task-03
title: CLI deny 放行临时路径
priority: P0
estimated_hours: 2
depends_on: []
blocks: []
allowed_paths:
  - sillyhub-daemon/src/permission-rules.ts
goal: 在 CC --settings 的 permissions.allow 追加 sillyspec 临时路径（c:\dev\null / /dev/null / tmpdir），让 sillyspec 写临时文件放行。
implementation: |
  1. 定位 permission-rules.ts:40-54 buildWritePermissionRules。
  2. 文件顶部 WRITE_TOOLS 常量后新增 SILLYSPEC_TEMP_PATTERNS（C:/dev/null、/dev/null、tmpdir() 反斜杠转正斜杠），import tmpdir from node:os。
  3. buildWritePermissionRules 内循环后、deny 构造前，对每个 temp × WRITE_TOOLS 追加 allow `${tool}(${temp}/**)` 和 `${tool}(${temp})`。
  4. .sillyspec/.runtime 已在 homedir 兜底白名单内，无需重复加；若 task-07 发现仍 deny 再补 ~/.sillyhub/**/.sillyspec/.runtime/**。
  5. buildCcSettingsJson 不动，调 buildWritePermissionRules 自动继承。
acceptance: |
  - buildCcSettingsJson 输出 permissions.allow 含 Write(C:/dev/null/**)、Write(/dev/null/**)、Write(<tmpdir>/**)。
  - 单测构造 allowedRoots=['C:/Users/test']，断言 allow 含上述临时路径条目。
  - task-08 写安全测试：临时路径 allow + 越界写（D:/evil/**）仍 deny。
  - task-07 端到端：sillyspec CLI 写 c:\dev\null 不再被 CC permission 拦截。
verify: vitest
constraints: 跨平台临时路径（Windows C:/dev/null + os.tmpdir()；Linux/macOS /tmp + /dev/null + os.tmpdir()）；只放行已知 3 类路径不扩大通配；Windows 大小写敏感需确认 sillyspec 实际写入路径大小写。
covers: [FR-003]
---
# task-03: CLI deny 放行临时路径

## 文件
修改 `sillyhub-daemon/src/permission-rules.ts`

## 背景
`buildWritePermissionRules`（permission-rules.ts:40-54）生成 CC `--settings` 的 permissions：`deny Write(**) + Edit(**)` 通配，`allow Write(root/**)` 按白名单 root 放行。sillyspec CLI 执行时会写临时文件到 `c:\dev\null`（Windows 占位/null 设备路径）、系统 temp 目录、`.sillyspec/.runtime/` 下，这些路径不在 daemon config.allowed_roots 白名单内 → 被 `deny Write(**)` 拦截（根因 4，permission-rules.ts）。

CC permission 优先级：allow 具体路径覆盖 deny 通配（permission-rules.ts:8-9 注释）。本 task 在 allow 数组追加临时路径条目，让 sillyspec 写临时文件放行。

## 操作步骤
1. 读 `sillyhub-daemon/src/permission-rules.ts:40-54`，定位 `buildWritePermissionRules`。
2. 在文件顶部（`WRITE_TOOLS` 常量后，permission-rules.ts:17 附近）新增跨平台临时路径常量：
   ```typescript
   /**
    * sillyspec 临时路径放行（FR-003）。sillyspec CLI 执行时写 c:\dev\null（Windows
    * null 设备占位）、系统 temp、.sillyspec/.runtime 下临时文件，不在
    * config.allowed_roots 白名单内。CC permission allow 覆盖 deny 通配，此处显式放行。
    * 跨平台：Windows c:\dev\null + os.tmpdir()；Linux/macOS /tmp + /dev/null +
    * os.tmpdir()；统一加 .sillyspec/.runtime 相对段（expandRoot 已展开 ~）。
    */
   import { tmpdir } from 'node:os';
   import { join } from 'node:path';

   const SILLYSPEC_TEMP_PATTERNS: string[] = [
     // Windows null 设备占位（sillyspec 写 c:\dev\null 触发 deny）
     'C:/dev/null',
     // POSIX null 设备
     '/dev/null',
     // 系统临时目录（os.tmpdir()，跨平台）
     tmpdir().replace(/\\/g, '/'),
   ];
   ```
3. 在 `buildWritePermissionRules` 内（permission-rules.ts:44-51 循环后、`deny` 构造前）追加临时路径到 allow：
   ```typescript
   // FR-003：sillyspec 临时路径放行（allow 覆盖 deny 通配）
   for (const temp of SILLYSPEC_TEMP_PATTERNS) {
     for (const tool of WRITE_TOOLS) {
       allow.push(`${tool}(${temp}/**)`);
       allow.push(`${tool}(${temp})`);
     }
   }
   ```
4. `.sillyspec/.runtime` 路径：`.sillyspec` 目录在 daemon 侧位于 `~/.sillyhub/<...>/.sillyspec/.runtime`（spec-sync-strategy），已在 homedir 兜底白名单内（config.ts:332 `allowed_roots: [homedir()]`），无需重复加。若执行时发现仍有 deny，task-07 再补 `~/.sillyhub/**/.sillyspec/.runtime/**` 模式。
5. `buildCcSettingsJson`（permission-rules.ts:61-64）不动——它调 `buildWritePermissionRules`，自动继承。

## 验收标准
- `buildCcSettingsJson([...])` 输出的 JSON `permissions.allow` 数组包含 `Write(C:/dev/null/**)`、`Write(/dev/null/**)`、`Write(<tmpdir>/**)` 等条目（tmpdir 按 os 展开实际值）。
- 单测 `sillyhub-daemon/tests` 新增/更新用例：构造 `allowedRoots=['C:/Users/test']`，调 `buildWritePermissionRules`，断言 allow 含上述临时路径条目。
- task-08 写安全测试：临时路径 allow + 越界写（如 `D:/evil/**`）仍 deny。
- task-07 端到端：sillyspec CLI 写 `c:\dev\null` 不再被 CC permission 拦截。

## 依赖
task-01（Wave 1 完成后 Wave 2，逻辑上 scan 模式先行）。实际代码层面无硬依赖，可并行编码，但验收需 task-01 部署后端到端跑。

## 风险
- R-02（design 风险登记）：临时路径放行扩大写安全范围。应对：只放行已知 3 类路径（c:\dev\null / /dev/null / tmpdir），不放行任意通配；task-08 测试越界写仍 deny。
- Windows `C:/dev/null` 大小写：CC permission 路径匹配大小写敏感（permission-rules.ts:24-27 统一正斜杠但不归一大小写）。若 sillyspec 实际写小写 `c:\dev\null`，allow 用大写 `C:/dev/null` 可能不匹配。执行时确认 sillyspec 实际写入路径大小写，必要时补小写变体或改 `expandRoot` 加大小写归一。
- `tmpdir()` 在不同平台返回值不同（Windows `C:\Users\xxx\AppData\Local\Temp` / macOS `/var/folders/...` / Linux `/tmp`），已用 `replace(/\\/g,'/')` 统一斜杠，但需确认 CC 能正确匹配带空格路径（macOS `/var/folders/xx/T`）。
