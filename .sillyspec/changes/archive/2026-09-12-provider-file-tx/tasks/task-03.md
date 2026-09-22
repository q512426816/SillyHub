---
id: task-03
title: 'Managed marker: .sillyhub-managed write ordering in ForReload branches'
title_zh: '生效标记——provider-file-settings 落 .sillyhub-managed（分支一后置/分支四先行）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-12 11:21:23
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-004@v2]
allowed_paths:
  - sillyhub-daemon/src/provider-file-settings.ts
  - sillyhub-daemon/tests/provider-file-settings-reload.test.ts
target_files:
  - sillyhub-daemon/src/provider-file-settings.ts
  - sillyhub-daemon/tests/provider-file-settings-reload.test.ts
goal: >
  在 ForReload 成功路径落 .sillyhub-managed 生效标记：分支一（非 null 写盘）标记
  后置 best-effort；分支四（codex-null 镜像）标记先行——标记写失败则跳过整个镜像
  （含删除动作）返回 prior CODEX_HOME（FR-04 前半 / D-004@v2，R-03 双失败从根消除）。
implementation:
  - provider-file-settings.ts：导出 MANAGED_MARKER_FILENAME 常量 .sillyhub-managed；标记内容 JSON 含 envKey 与 switchedAt ISO 时间，经 writeFileAtomic 写
  - 分支一（writer.write 成功后）后置写标记（失败 warn 不抛，写盘主体已成功）
  - 分支四（codex null 镜像）：先写标记——失败则 error 日志 + 直接返回 priorFileEnv（跳过 mirrorCodexHostAuth，删除类动作不发生）；成功再镜像
  - 门槛缺跳过（分支三）与官方端点跳过零标记；tests/provider-file-settings-reload.test.ts 扩展：分支一后置序 / 分支四先行序（标记写失败→镜像不执行且返回 prior）/ 门槛缺不落标记
acceptance:
  - 三组标记序断言全绿；「标记失败→无删除动作」不变量锁定
  - 既有 provider-file-settings-reload 套件其余断言不改预期全绿
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/provider-file-settings-reload.test.ts && pnpm typecheck
constraints:
  - 不改 ForReload 五分支返回值语义（分支四标记失败返回 prior 键 = 既有「镜像失败=等同未切」语义延伸）
  - 标记对 codex/pi CLI 透明（点前缀隐藏文件）
provides:
  - symbol: MANAGED_MARKER_FILENAME
    file: sillyhub-daemon/src/provider-file-settings.ts
    contract: 常量 .sillyhub-managed；存在于 per-session 目录 ⟺ 文件层曾真实建立（task-04 回滚删除 / task-05 restore 探测消费）
expects_from:
  - task-01: writeFileAtomic 接口
---


