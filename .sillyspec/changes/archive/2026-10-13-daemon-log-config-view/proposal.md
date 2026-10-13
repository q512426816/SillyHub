---
author: qinyi
created_at: 2026-10-13 16:27:10
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机

daemon（本地守护进程）出问题时排查成本高：只能在用户本机敲 CLI（`sillyhub-daemon logs --tail N`）看日志、手工找 `~/.sillyhub/daemon/config-*.json` 看配置，日志路径还可能被 `SILLYHUB_DAEMON_DIR` 重定向而找不到文件。平台侧目前只有在线状态/版本/心跳时间等心跳快照，没有日志与配置的查看入口。本变更在 `/runtimes` 机器卡上提供 daemon 日志与配置的只读查看+下载，用户不登机器即可完成常见排查。

## 关键问题

1. **排查链条长**：用户发现问题（任务失败/掉线）→ 必须登机器/回忆 CLI → 才能看到具体报错，远程协作时还要贴日志。
2. **配置文件难找**：配置按 server 分文件（`config-<sha256(server_url) 前8位>.json`），路径含哈希，用户常找不到；凭据字段直接明文暴露在文件里，不适合随手转发排查。
3. **现有 agent 日志链路不可直接复用**：其 `host_fs.read_file` 需绝对路径且全量读取（backend 拼不出 daemon 机器 home 路径、大日志超时），暴露了「backend 猜 daemon 本地路径」模式的硬伤。

## 变更范围

- **daemon**：新增两个只读 WS RPC——`daemon_log_tail`（日志尾部 N 行，路径由 daemon 侧权威解析，分块读不全量加载）与 `daemon_config_get`（当前生效配置，敏感字段默认掩码、reveal 按需明文）。
- **backend**：新增 machine 级转发端点 `GET /api/daemon/machines/{id}/logs` 与 `GET /api/daemon/machines/{id}/config`，错误映射：离线/超时→504、老 daemon→422、其余→502。
- **frontend**：`/runtimes` 机器卡新增「日志」「配置」入口，打开诊断弹窗（双 Tab）：日志（行数/刷新/下载/元信息）、配置（掩码展示/明文切换/下载脱敏 JSON）；边界态（老版本/不落盘/离线）提示。
- 文档与类型产物同步（openapi.json、api-types.ts、模块文档）。

## 不在范围内（显式清单）

- 不做日志实时滚动流（WebSocket `tail -f`），只做拉取+手动刷新。
- 不做配置在线编辑/写回。
- 不做日志轮转/清理策略变更。
- 不改造心跳协议携带日志/配置快照。
- 不做多日志文件浏览器（任务级 `runs/<leaseId>/terminal.log` 等不在范围）。

## 成功标准（可验证）

- [ ] 在线机器点「日志」：弹窗展示 daemon.log 尾部默认 500 行，含路径/大小/最后修改时间；切换 100/500/2000 与刷新均生效。
- [ ] 点击「下载日志片段」得到与当前展示一致的行内容文件。
- [ ] 点「配置」：展示脱敏配置（token/api_key 形如 `前4***后4`）；点「显示明文」二次拉取后显示明文，再点恢复掩码。
- [ ] 「下载配置」恒得到脱敏 JSON（掩码态与明文态下载均脱敏，D-007）。
- [ ] 老 daemon（未升级）点击入口显示「版本过旧请升级」提示而非报错弹窗；`daemon.log` 不存在时显示「前台运行不落盘」提示；机器离线时按钮禁用/提示离线。
- [ ] 前后端测试：daemon vitest（尾部读取/脱敏/边界）、backend pytest（转发与 504/422/502 映射）、frontend vitest（弹窗渲染与边界态）全绿；`pnpm gen:types` 产物已更新。
- [ ] 全链路只读：平台不提供任何配置写回路径；默认请求路径（reveal=false）不传输明文凭据。
