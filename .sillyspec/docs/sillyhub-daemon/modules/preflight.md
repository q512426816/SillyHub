---
schema_version: 1
doc_type: module-card
module_id: preflight
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 启动前预检（preflight）

## 定位
daemon 启动前预检（`src/preflight.ts`）：sillyspec CLI 版本检查/自动安装 + daemon
自身 bundle 自更新。两项相互独立，任一失败仅记 warn 不阻断启动（runPreflight 自身
永不 reject）。除入口 runPreflight 外导出 runSillySpecCheck / runDaemonSelfUpdate /
respawnDaemonAndExit 供单测直调（buildId / binDir 可注入）。

## 契约摘要
- `runPreflight(config: DaemonConfig, logger: PreflightLogger): Promise<void>`——
  先 sillyspec 检查再 daemon 自更新，两步各自 try/catch 隔离；自更新返回 true →
  调 respawnDaemonAndExit（启动期尚未持 runtime lock，直接拉起退出）。
- `PreflightLogger = (level: 'debug'|'info'|'warn'|'error', msg, data?) => void`，
  daemon.start 适配内部 Logger。
- `runSillySpecCheck(logger)`——`sillyspec --version` vs `npm view sillyspec version`；
  npm 不可达 → warn 不装；未安装 / 本地旧（semver 或字符串不等）→ `npm install -g sillyspec@latest`。
- `runDaemonSelfUpdate(buildId, config, logger, binDir = ~/.sillyhub/daemon/bin):
  Promise<boolean>`——拉 `{server_url}/daemon/latest.json`（LatestInfo
  `{ version, url, publishedAt? }`），version 与本地 BUILD_ID 不一致 → 下载 bundle
  原子替换 `~/.sillyhub/daemon/bin/sillyhub-daemon.js`（对齐 install.sh 的
  BIN_DIR/BUNDLE_NAME）+ mcp-server.js best-effort 伴生替换（同目录 URL 推导，
  失败仅 warn）；true=已替换需重启，false=跳过/失败（保持运行）。
- `respawnDaemonAndExit(logger, binDir = ~/.sillyhub/daemon/bin, exitDelayMs = 500)`——
  detached spawn `node <binDir>/sillyhub-daemon.js ...process.argv.slice(2)` 拉起新
  版本 + unref，成功后 exitDelayMs 退旧进程；**拉起失败记 error 不退出**（旧进程
  保活）。仓库无保活型 supervisor（install wrapper 是一次性 exec；2026-08-30 起有
  可选开机（或登录）自启注册——autostart 子命令，D-002 仅开机启动不保活），自更新 respawn 自拉起仍是更新后存活的唯一机制。
- 依赖：config、hub-client（parseJsonFromResponse）、build-id、version（parseSemver）。
  被 daemon 使用（WS SELF_UPDATE 消息也触发 runDaemonSelfUpdate）。

## 关键逻辑
```
runDaemonSelfUpdate:
  buildId 为空或 'dev' → 跳过返回 false（本地开发无 SHA）
  SKIP_DAEMON_SELF_UPDATE=1 → 跳过返回 false（紧急运维开关：锁版本/防 manifest 过期循环降级）
  latest.version == buildId → up_to_date 返回 false
  防降级: version 格式 <gitsha8>-<YYYYMMDDHHMMSS>，本地时间戳 >= 远端 → 跳过返回 false
    （防"启动→降级→exit→重启→再降级"死循环；格式异常回退不等就更新）
  下载 → 原子替换主 bundle → mcp-server.js 伴生替换（best-effort）→ 返回 true
  调用方（runPreflight 启动期 / daemon WS SELF_UPDATE）据 true 调 respawnDaemonAndExit：
    detached spawn node 新bundle + 原启动参数 → 500ms 后 exit(0)
```

## 注意事项
- sillyspec 检查刻意阻塞启动（spawn+超时杀树 runWithTreeKill，npm install 数十秒），
  保证 daemon 启动前 CLI 就绪——spec 流程依赖它；daemon 自更新走 Node 20 原生 fetch 异步。
- 自更新替换成功后靠**退出前自拉起 detached 新进程**生效，不是热替换，也不依赖
  保活型 supervisor（install.sh/ps1 wrapper 是一次性 exec，无重启循环——2026-08-28
  ql-20260828-004-5798 实证"等外部 supervisor"假设从未落地，更新完进程死掉；2026-08-30
  起有可选开机（或登录）自启注册：autostart 子命令三平台注册，按 D-002 仅开机启动
  不保活——机器重启/重新登录后可自动拉起一次，但仍非重启循环，respawn 自拉起仍是
  更新后进程交接的唯一机制）；
  dev 构建（BUILD_ID 占位 'dev'）永远跳过。WS 路径先 daemon.stop()（释放 runtime
  lock / 标 offline）再拉起，避免新进程抢锁失败。
- respawn 拉起失败（spawn 抛错/无 pid）→ 记 error **不退出**：旧进程继续跑旧版本
  保持在线，等下次触发或人工介入。
- latest.json 拉取失败/非 2xx/解析失败/字段缺失 → 返 null 仅 warn；相对 url 由
  server_url（去尾斜杠）拼接。
- bundle 替换是原子写（下载 → 校验 → 临时文件 → rename），失败保持旧 bundle
  可用；替换成功后 500ms 延迟退出给日志 flush。
- isOutdated 同时支持 semver 元组比较与字符串不等兜底；npm install 失败仅 warn
  （runCmdBoolean 内已记 cmd_failed），下次启动再试。
- 与 spec-sync 的版本门控（MIN_SILLYSPEC_VERSION_FOR_INIT）互补：preflight 保证
  CLI 存在且最新（启动时一次），init lease 前的 `sillyspec --version` 门控保证
  运行期升级后无需重启 daemon 也能识别。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
