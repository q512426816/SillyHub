# spec 树同步断档：触发机制依赖平台会话 + .runtime 嵌套回环拖垮状态采集（活跃坑）

- 发现日期：2026-09-27（修正版，推翻同日早先「nginx 需修 413」的初判）
- 症状上报人：用户（「本次变更 文件和状态为什么没同步到平台」）
- 状态：**部分已修复**；文件通道恢复需一次平台会话/扫描触发（设计缺陷待另立变更）

## 症状

1. 平台上看不到新变更（文件树 + 阶段状态停更），`spec-version.json` 的 `synced_at=2026-09-19T15:56:40Z`。
2. daemon 日志大量 `sillyspec_status_collect_timeout`（30s）与 `sillyspec_status_nonzero_exit`。
3. 间歇 502：远程平台 backend 容器重启窗口（如 9-26 23:37、9-27 00:05）短暂 502，属容器重建的正常窗口，非根因。

## 根因（修正后的完整因果链）

### 根因 1：413 是历史问题，nginx 9-21 已修，但推送无触发器（主因）

- 9-19 23:56 / 9-21 01:15：主仓（b97f8231）全量 tar 推送（~30MB、6781 文件）被当时 nginx 默认 1M 限制 413 拒绝。
- **9-21 01:30 已有人在服务器加 `client_max_body_size 500m`**（`/etc/nginx/sites-enabled/crrcdt:38`，备份 `/etc/nginx/backups/crrcdt.bak.20260921-013024` 为证）——nginx 层已放行。
- 但 daemon 的 spec 推送**不是心跳驱动**：只在两个点触发（daemon.ts ~4157 scan run 终态回灌 + onSessionEnd interactive 会话结束回灌，均要求 specSyncCtx）。9-21 之后主仓没跑过平台会话/扫描 → 没有任何触发 → 断档持续。
- daemon CLI（start/stop/status/logs/clean/autostart/enable/disable）无手动 sync 命令。
- 加重项：主仓无增量清单缓存（`~/.sillyhub/daemon/manifests/` 仅 ws-init-1.json），每次 sync 都走 30MB 全量 tar，量大易撞网关限制。

### 根因 2：`.sillyspec/.runtime/.sillyspec/` 嵌套回环（8 月 15 日遗留）

- `.runtime` 下嵌套一份 `.sillyspec`（内部还有 `.runtime/` 递归）→ daemon 心跳的 `sillyspec progress show --json` 采集（30s 超时）反复超时/exit 1 → 平台「状态」停更；`du`/`find` 等工具进入即卡死。
- 上传排除规则（UPLOAD_EXCLUDE_TOP_BASE 含 .runtime）使它不进 payload，与 413 无关。
- **已处置（2026-09-27 00:11）**：隔离为 `.sillyspec/.runtime/.sillyspec.quarantine-20260927`；同款采集命令从 30s 超时降为 0.3s，状态通道恢复。

## 恢复与修复路径（2026-09-27 已全部执行，同步恢复）

1. ✅ 嵌套回环已隔离（状态通道恢复：采集 30s 超时 → 0.3s）。
2. ✅ nginx 500m 已在位（9-21 他人修好，无需再动）。
3. ✅ **CLI 通道接通并完成全量补推**（比跑平台扫描更优，不消耗 agent 会话）：
   - 本仓 `.sillyspec/local.yaml` 原本**无 platform 段** → CLI 每步 `--done` 的自动增量同步一直静默跳过（`platform status` 显「未连接」）——这才是「CLI 有同步却从未触发」的原因；
   - `sillyspec platform connect https://crrcdt.ppdmq.top --token <JWT>`（admin 登录取 JWT；connect 内部走 resolve-by-root-path 反查工作区 + 签发 workspace 绑定 `shpsync_` token 写入 local.yaml，gitignore 已排除该文件）；
   - `sillyspec platform sync --change <名>` 推送：本次变更 + 一周积压全部上平台（平台变更列表 20 条可见，本变更 in_progress）。
4. ✅ 墓碑修复：157 个 `changes/archive/*` 旧归档被平台删除墓碑拒收 → `POST /api/workspaces/<ws>/spec-workspace/manifest-heal`（显式 paths，2026-09-26-manifest-heal-endpoint 通道）清 157 条 → 重推成功。
5. 遗留（无害脏数据）：三向对账报 manifest_ghost=165（平台清单有、磁盘无的幽灵行，历史遗留），不影响变更展示；后续可立轻量变更在平台侧清理。

## 长期修复建议（另立变更）

- spec 推送增加心跳/定时触发（pending_push 存在时周期重试，而非仅 scan 终态/onSessionEnd）；
- 全量 tar 分块上传（主仓无增量清单缓存，每次 sync 走 30MB 全量 tar）；
- `.runtime` 写入防嵌套回环；CLI 连接缺失时 `--done` 的自动同步应有更显眼的告警（当前静默跳过易误判「已同步」）。

## 附：noAI 质量扫描把 vitest/playwright 测试文件当 node --test 直跑（活跃坑）

- 发现：2026-09-27 verify 阶段（2026-09-26-core-pages-visual-redesign）。noAI 扫描 deps(auto-js) 模块子集用 node --test 直跑 `frontend/e2e/auth.spec.ts`（playwright）与 `frontend/src/styles/themes.test.ts`（vitest describe/it）→ 必然假红；真实口径 vitest 956/958 全绿。
- 处置：**已修复（R19，2026-09-27 用户授权）**——sillyspec verify-postcheck.js buildDepsBatches 按 .ts/.js 文件内容检测项目测试框架 import（vitest/@playwright/jest/bun:test）分流到项目运行器批（jsProject），node:test/纯 node 协议照旧 node --test；修复后主仓 verify 实测全绿、工具相关测试 17/17。known_failures 两条豁免保留至 sillyspec 仓提交 R19 后可删。

## 处置记录（2026-09-27）

断档恢复已于本日执行完毕（见「恢复与修复路径」节）；「长期修复建议」三条中可工具侧
落地的两条本轮修毕（sillyspec 仓工作树，未提交）：

1. **CLI 连接缺失显眼告警 ✅**：`triggerSync` 未连接分支新增 `warnPlatformNotConnectedDaily`
   ——完成/步进时刻（complete.js 五个调用点传 `opts.completion`）每日至多一次的显眼
   告警（「本命令的进度与 spec 树不会同步到平台」+ `platform connect` 恢复指引），
   marker 落 runtimeRoot 跨进程节流；渲染/诊断类调用点不告警（保住顶层别名 vs run
   前缀的字节级输出平价契约，cli-top-level-aliases 17/17 实证）。本地独立使用仍是
   合法默认态（sync.js「不每步」契约不破）。
2. **.runtime 嵌套回环防护 ✅**：`resolveSpecDir` 上溯遇 `<…>/.runtime/.sillyspec`
   残骸候选跳过、继续上溯真根（合法布局恒为 `<root>/.sillyspec`，`.runtime` 在其
   内层）——8-15 遗留形态不再可被命中。
   测试：`test/spec-sync-not-connected-notice.test.mjs` 3/3 + spec-dir 五套件回归
   + stage-burst/spec-sync/flow 全家 51 例全绿。

**延后（daemon 侧设计项，另立变更）**：spec 推送心跳/定时触发（pending_push 周期
重试）；全量 tar 分块上传（主仓无增量清单缓存）。附节 noAI vitest/playwright 分流
（R19）已在 sillyspec 工作树（verify-postcheck.js）。

遗留（无害脏数据）：manifest_ghost=165 平台侧清理，文件自述后续轻量变更处理。归档。
