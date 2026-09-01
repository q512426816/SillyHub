---
author: qinyi
created_at: 2026-08-31 08:20:00
---
# 提案书（Proposal）

## 动机

机器列表已展示 daemon 版本并支持「升级 daemon」，但每台机器上 sillyspec CLI（npm 全局包，spec 流程依赖）的版本对平台不可见、运行期不可升级：daemon 启动 preflight 会探测并自动升级 sillyspec（`preflight.ts:248-287`），但结果只写日志不上报；`daemon_instances` 表与机器卡均无 sillyspec 版本字段；npm 发新版后只能等 daemon 重启才能升级；机器未安装 sillyspec（启动时 npm 不可达）平台无感知也无远程补装手段。

## 关键问题

1. **版本不可见**：探测结果留在 daemon 本地日志，机器卡只能看到 daemon 版本，看不到 sillyspec 版本，更不知道是否落后于 npm 最新版。
2. **运行期无法升级**：sillyspec 无自升级命令（升级=`npm install -g sillyspec@latest`），daemon 运行期间平台无法触发升级。
3. **升级过程不可见**：手动/自动升级是否在执行、机器忙是否推迟、成功还是失败（原因），运维无处可看。
4. **未安装无补救**：preflight 失败保持未安装，spec 流程将失败，平台无远程安装手段。

## 变更范围

- **daemon（sillyhub-daemon）**：新模块 `sillyspec-manager.ts`（探测缓存/升级状态机/忙推迟 30s 复查/终态 10 分钟窗口）；`_sillyspecLoop` 第四循环（`sillyspec_update_interval_sec` 默认 3600，0=关）；protocol `SILLYSPEC_UPDATE` 常量 + `_handleMessage` case；hub-client register/heartbeat 追加可选 sillyspec 字段；preflight 导出 runCmd/installSillySpec 复用。
- **backend**：`daemon_instances` 加 3 列（`sillyspec_version`/`sillyspec_latest_version`/`sillyspec_update` JSON）+ alembic 迁移；`DAEMON_MSG_SILLYSPEC_UPDATE` + `ws_hub.send_sillyspec_update`；`POST /machines/{id}/sillyspec-update` 端点；心跳/register 接收落库（register 直接落值含 null，心跳非 None 覆盖 + update 无键清除）；`_build_machine_read` 显式组装 + `MachineSillySpecUpdateRead` 嵌套类型。
- **frontend**：机器卡 sillyspec 徽标三形态（最新常色/落后橙色高亮/未安装红色）+「升级 sillyspec」按钮（5 态）+ 升级状态横幅四态（复用 pending_update 横幅槽）；`triggerMachineSillySpecUpdate`；gen:types 再生。

## 不在范围内（显式清单）

- 不做指定版本安装/降级（始终 latest）。
- 不做离线机器指令排队（启动 preflight 自动升级天然兜底，D-001@v1 否决方案 B）。
- 不做 RPC 同步等待升级结果（npm install 常超 10s 超时，D-001@v1 否决方案 C）。
- 不改 daemon 自身自更新链路（SELF_UPDATE/pending_update 语义不动）。
- 不改 sillyspec CLI 本身。

## 实现路径

`sillyspec run plan --change 2026-08-31-machine-sillyspec-version`（scale=large，四件套齐 + Design Grill passed）。
