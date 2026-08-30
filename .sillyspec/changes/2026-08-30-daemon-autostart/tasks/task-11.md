---
id: task-11
title: '模块文档同步——新增 .sillyspec/docs/sillyhub-daemon/modules/autostart.md 模块卡 + 更新 cli.md（命令清单）/preflight.md（supervisor 表述）/CONCERNS.md（L51 隐患条目）'
title_zh: '模块文档同步——新增 .sillyspec/docs/sillyhub-daemon/modules/autostart.md 模块卡 + 更新 cli.md（命令清单）/preflight.md（supervisor 表述）/CONCERNS.md（L51 隐患条目）'
author: 'qinyi'
created_at: 2026-08-30 23:01:28
priority: P0
depends_on: ['task-01', 'task-05']
blocks: []
requirement_ids: [FR-09]
decision_ids: [D-002@v1, D-005@v1]
allowed_paths:
  - .sillyspec/docs/sillyhub-daemon/modules/autostart.md
  - .sillyspec/docs/sillyhub-daemon/modules/cli.md
  - .sillyspec/docs/sillyhub-daemon/modules/preflight.md
  - .sillyspec/docs/SillyHub/scan/CONCERNS.md
goal: >
  把 autostart 新模块与 CLI 子命令组的变化同步进模块文档与仓库隐患清单（新增 autostart.md
  模块卡 + cli.md 命令清单 + preflight.md supervisor 表述 + CONCERNS.md L51 条目），
  保证文档与实现一致（FR-09 文档面，CLAUDE.md「注释与实现不一致是万恶之源」）。
implementation:
  - 新增 .sillyspec/docs/sillyhub-daemon/modules/autostart.md 模块卡，对齐同目录现有卡格式（frontmatter schema_version/doc_type/module_id/author/created_at + 正文 定位/契约摘要/关键逻辑/注意事项）：定位=开机（或登录）后自动启动注册模块；契约摘要=enableAutostart/disableAutostart/autostartStatus 顶层 API + AutostartRecord 本机文件（autostart-<hash8>.json）+ 三平台矩阵（schtasks ONLOGON / launchd RunAtLoad 无 KeepAlive / systemd user service 无 Restart）；关键逻辑=凭据不进任务命令（D-004，开机拉起后由 start 从 per-server config 读）+ serverHash 后缀多 server 独立注册；注意事项=无保活（D-002）、nvm 路径漂移（R-01）、WSL 无 systemd（R-04）、VBS 弃用前瞻（R-10）
  - 更新 cli.md：定位段「5 个子命令」改为「5 个平级子命令 + autostart 嵌套子命令组」；契约摘要补 autostart enable（选项 --server/--api-key/--token，凭据管线与 startAction 对齐无条件落盘、凭据缺失 return 1 不注册、--token 过期警告）/ disable（不杀运行中进程，停进程用 stop）/ status（三态表格，恒 return 0）
  - 更新 preflight.md：respawnDaemonAndExit 的「仓库不存在外部 supervisor（install wrapper 是一次性 exec，无 systemd/服务/计划任务）」表述更新为——仓库现有可选开机（或登录）自启注册（2026-08-30-daemon-autostart，autostart enable，用户需显式执行），但仍无崩溃保活 supervisor（无 KeepAlive/Restart，D-002 刻意不做），respawn 自拉起仍是更新后进程存活的唯一机制
  - 更新 CONCERNS.md L51「daemon bundle / self-update 版本对齐」条目：追加自启已补（2026-08-30-daemon-autostart 提供 CLI autostart 子命令，机器重启/重新登录后可自动拉起）；崩溃保活仍未做（按 D-002 决策刻意不做，非遗漏待办）
acceptance:
  - modules/autostart.md 存在且四节结构（定位/契约摘要/关键逻辑/注意事项）齐全，frontmatter 含 schema_version/doc_type/module_id
  - cli.md 命令清单含 autostart enable/disable/status（不再是无嵌套组的纯 5 命令表述）
  - preflight.md 不再有「无 systemd/服务/计划任务」的绝对化 supervisor 表述，改为可选自启注册存在 + respawn 仍是更新后唯一存活机制 + 无保活（D-002）
  - CONCERNS.md L51 条目反映：自启已补（注明变更名）、崩溃保活按 D-002 未做
verify:
  - ls .sillyspec/docs/sillyhub-daemon/modules/autostart.md（文件存在）
  - grep -c "autostart" .sillyspec/docs/sillyhub-daemon/modules/cli.md .sillyspec/docs/sillyhub-daemon/modules/preflight.md .sillyspec/docs/SillyHub/scan/CONCERNS.md（关键内容 grep，三文件均 >0）
constraints:
  - 只动文档，不改任何代码/测试
  - 模块卡格式对齐同目录现有卡（cli.md/preflight.md 的 frontmatter 字段与章节名）；中文书写
  - 表述与 design/decisions 一致：自启语义=开机（或登录）后自动启动（不承诺纯开机）；保活缺口标注为 D-002 决策而非待办债
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
