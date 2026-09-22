---
author: qinyi
created_at: 2026-09-12 11:11:58
---

# decisions.md — 2026-09-12-provider-file-tx

> 决策台账。来源：24h 审查 M-7/F1-F4（commit 1e4bb818f 引入）+ brainstorm 方案裁决（方案 A；B/C 否决）。

## D-001@v1

- type: design
- status: confirmed
- source: brainstorm/step4-方案A
- question: reload 在文件写盘之后才校验 resume key，缺失时文件层已被新供应商覆盖？
- answer: resume-key 必需校验上移到文件层写盘块之前——缺失时零文件写入直接抛，消除「先覆盖再发现不能 reload」路径。
- normalized_requirement: `_reloadSessionNow` 中 agentSessionId 缺失校验必须先于 `applyProviderFileSettingsForReload` 调用；缺 key 时 per-session 目录零写入。
- impacts: sillyhub-daemon/src/interactive/session-manager.ts（reload 主链顺序）
- evidence: 审查 F1 前半；现序 :1852 写盘块早于 :1890 守卫
- priority: P0
- 锚点: sillyhub-daemon/src/interactive/session-manager.ts:_reloadSessionNow
- 模块域: sillyhub-daemon

## D-002@v1

- type: design
- status: confirmed
- source: brainstorm/step4-方案A
- question: reload 失败回滚只还原内存态，文件层残留新供应商凭证怎么办？
- answer: catch 块在还原内存态后，若本次尝试过文件层写入，best-effort 以 oldProviderConfig + oldEnv 重跑 `applyProviderFileSettingsForReload` 恢复文件层；该函数既有「绝不抛」契约保证回滚动作自身安全（codex null 走宿主镜像分支恢复宿主态；pi null 返 {}，留存文件无 env 指向即惰性无害）。失败仅 error 日志，不改变既有 rethrow 语义。
- normalized_requirement: reload 失败路径必须把 per-session 文件层恢复到 oldProviderConfig 对应形态（或 codex-null 宿主镜像形态）；恢复失败不得影响旧句柄降级。
- impacts: sillyhub-daemon/src/interactive/session-manager.ts（catch 块）；provider-file-settings.ts（消费，不改）
- evidence: 审查 F1 后半；现 catch :2005-2026 只还原 state.env/providerConfig
- priority: P0
- 锚点: sillyhub-daemon/src/interactive/session-manager.ts:_reloadSessionNow-catch
- 模块域: sillyhub-daemon

## D-003@v1

- type: design
- status: confirmed
- source: brainstorm/step4-方案A
- question: 六个写盘点直接 writeFile/copyFile，崩溃留半截文件？
- answer: 新增 `writeFileAtomic(path, data)`（写 `<path>.tmp-<rand>` → fsync → rename 顶替；任一步失败 best-effort unlink tmp），替换 codex-settings 的 auth.json/config.toml、pi-settings 的 auth.json/models.json/settings.json、mirrorCodexHostAuth 的宿主拷贝共六处。config.toml 截断后保守合并保留残行持续产出非法 TOML 的链条从根消失。
- normalized_requirement: per-session 目录全部配置写入必须原子（观察者要么见旧全文要么见新全文）；失败不留 tmp 残留（best-effort）。
- impacts: 新增 sillyhub-daemon/src/atomic-write.ts；codex-settings.ts / pi-settings.ts 六写盘点
- evidence: 审查 F2；codex-settings.ts:325/366、pi-settings.ts:158/201/213、mirror copyFile
- priority: P0
- 锚点: sillyhub-daemon/src/atomic-write.ts:writeFileAtomic
- 模块域: sillyhub-daemon

## D-004@v1

- type: design
- status: confirmed
- source: brainstorm/step4-方案A
- question: restore 用「目录存在」判定 codex null 切换，迁移钩子建目录即可造成假阳性？
- answer: 写盘/镜像成功后在 per-session 目录落生效标记文件 `.sillyhub-managed`（内容 JSON：{envKey, switchedAt}）；restore 的 null+codex 探测改判标记存在。legacy 兼容回退：无标记但目录存在 auth.json 或 config.toml（修复前已切换的存量会话）→ 视为 managed（info 日志）；迁移钩子只建目录 + sessions/ 子目录，两条件均不满足 → 零动作（宿主语义，与现状一致）。门槛缺跳过（零写入）路径不落标记。
- normalized_requirement: restore 探测依据必须是「切换曾真实生效」的信号而非目录存在性；存量已切换会话不因本变更回归。
- impacts: provider-file-settings.ts（成功分支落标记 + 常量）；interactive/session-manager/persistence.ts（探测改判 + legacy 回退）
- evidence: 审查 F3；persistence.ts:387-398 stat 目录门，迁移钩子 :1858-1868 先建目录
- priority: P0
- 锚点: sillyhub-daemon/src/provider-file-settings.ts:MANAGED_MARKER_FILENAME
- 模块域: sillyhub-daemon

## D-005@v1

- type: design
- status: confirmed
- source: brainstorm/step4-方案A（F4 附带评估裁决）
- question: claude-only 守卫删除后 cursor 会话也被卷入 reload 内核（未验证）？
- answer: reload 入口加引擎白名单门：provider ∈ {claude, codex, pi}（单一来源常量，与前端 PROVIDER_SWITCH_ENGINES 口径对齐）才继续；cursor/未知引擎显式 throw 拒绝（恢复 fail-loud，语义对齐 1e4bb818f 删除前的拒绝行为，口径从「非 claude 拒绝」改「白名单外拒绝」）。
- normalized_requirement: 白名单外引擎 reload 必须显式失败并可观测（日志+异常），不得静默尝试未验证的 reload 路径。
- impacts: sillyhub-daemon/src/interactive/session-manager.ts（入口门）；测试补 cursor 拒绝用例
- evidence: 审查 F4；守卫删除位于 :1503-1519（1e4bb818f）
- priority: P1
- 锚点: sillyhub-daemon/src/interactive/session-manager.ts:_reloadSessionNow-entry
- 模块域: sillyhub-daemon

## D-002@v2

- type: design
- status: confirmed
- source: brainstorm/step7-DesignGrill（v1 增补：undefined 旧形态边缘）
- supersedes: D-002@v1
- question: v1 遗留——oldProviderConfig===undefined（会话从未配置供应商，oldEnv 无文件层键）时，ForReload(undefined) 返 {} 不动文件，目录残留新供应商产物+标记，restore 探测误判 managed？
- answer: v1 语义全保留（catch best-effort 以 oldProviderConfig+oldEnv 重跑 ForReload）；增补：回滚动作完成后，若 ForReload 返回空对象（未建立任何文件层键）且 per-session 目录存在 → best-effort 删除 `.sillyhub-managed` 标记（防 restore 把残留产物误判为切换曾生效）。删标记失败仅 warn。
- normalized_requirement: 同 v1 + 回滚终态不得留下「标记在而会话旧形态无文件层键」的组合。
- impacts: session-manager.ts（catch 回滚尾部）
- evidence: Grill gap-5；ForReload provider===undefined → {} 分支
- priority: P0
- 锚点: sillyhub-daemon/src/interactive/session-manager.ts:_reloadSessionNow-catch
- 模块域: sillyhub-daemon

## D-004@v2

- type: design
- status: confirmed
- source: brainstorm/step7-DesignGrill（v1 增补：分支四标记先行序）
- supersedes: D-004@v1
- question: v1 遗留——null 分支镜像会**删除**目录内 auth/config（宿主未登录形态），若标记写失败且镜像已执行 → 目录无标记无 auth/config，legacy 判据失效、restore 漏判（R-03 双失败残留）？
- answer: v1 三态探测全保留；增补写入序：codex-null 分支（ForReload 分支四与 restore 探测镜像路径）**标记先行**——标记写失败则跳过整个镜像动作、返回 prior CODEX_HOME（「镜像失败=等同未切」既有语义的自然延伸），删除类动作只发生在标记已持久化之后。非 null 写入分支（分支一）标记后置 best-effort（写入非破坏性，legacy 判据可兜）。
- normalized_requirement: 任何删除目录内配置文件的动作之前，标记必须已持久化成功；标记失败 → 不执行删除类镜像动作。
- impacts: provider-file-settings.ts（分支四重排序）；persistence.ts（镜像路径同序）
- evidence: Grill gap-R-03；mirrorCodexHostAuth 删除分支
- priority: P0
- 锚点: sillyhub-daemon/src/provider-file-settings.ts:applyProviderFileSettingsForReload-分支四
- 模块域: sillyhub-daemon

## D-005@v2

- type: design
- status: confirmed
- source: brainstorm/step7-DesignGrill（v1 增补：门作用域）
- supersedes: D-005@v1
- question: v1 遗留——门放 _reloadSessionNow 顶部会连带拒绝 cursor 的 reloadWithConfig（人格/配置维度 reload，1e4bb818f 前后均可工作），作用域过宽？
- answer: 门只拦**provider 维度** reload：_reloadSessionNow 以「本次调用是否携带 provider 切换载荷」为门条件（providerConfig 参数非「未携带」哨兵时才白名单检查；config-only 路径不拦）。白名单值与 v1 相同（claude/codex/pi）。
- normalized_requirement: 白名单外引擎仅在 provider 切换请求时显式失败；配置维度 reload 对全部引擎行为不变。
- impacts: session-manager.ts（入口门条件化）
- evidence: Grill gap-6；reloadWithConfig 与 markPendingSwitch 共享内核
- priority: P1
- 锚点: sillyhub-daemon/src/interactive/session-manager.ts:_reloadSessionNow-entry
- 模块域: sillyhub-daemon

## 方案裁决记录

- 方案 A（本设计 D-001~D-005）：选定。与用户前轮指令（原子写 temp+rename / reload 事务性 / 探测修正）逐条对应。
- 方案 B（staging 目录两阶段交换）：否决——Windows 目录 rename 交换多步不原子（中途崩溃留混态需启动清理）；staging 从空建丢「保守合并保留兄弟键」语义（需先全量拷贝，复杂度反超收益）。
- 方案 C（仅原子写+标记）：否决——回滚窗口（切换失败到下次重写之间 codex 重读 auth.json 用错凭证）保留，M-7 修复不完整。
