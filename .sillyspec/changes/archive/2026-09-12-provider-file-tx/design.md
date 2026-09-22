---
author: qinyi
created_at: 2026-09-12 10:59:47
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-12-provider-file-tx

## 背景

1e4bb818f（2026-09-11-session-provider-switch-codex-pi execute）把会话内供应商切换扩展到 codex/pi：reload 内核接入文件层配置（per-session 目录写 `auth.json`/`config.toml`/`models.json`/`settings.json` + env 注入 `CODEX_HOME`/`PI_CODING_AGENT_DIR`）。24h 只读审查（M-7）发现文件层与 reload 事务性脱节的三个缺陷 + 一个语义外溢：

- **F1**：`_reloadSessionNow` 的文件层写盘（:1852 块）先于 resume-key 守卫（:1890）与 `driver.start`（:1952）；失败 catch（:2005）只还原内存态（`state.env/providerConfig`），per-session 目录里已是新供应商凭证——回滚窗口内 codex 进程重读 `auth.json`（token 刷新）会用错凭证。
- **F2**：六个写盘点（codex 两文件 + pi 三文件 + 宿主镜像 copy）直接 `writeFile`/`copyFile`，进程崩溃留半截文件；`config.toml` 截断后 `mergeConfigToml` 保守合并会把残行当未知内容原样保留，持续产出非法 TOML 直至目录终态清理。
- **F3**：restore 的 null+codex 探测（persistence.ts:387-398）以「目录存在」为切换生效信号；codex 迁移钩子（session-manager.ts:1858-1868）只做目录拷贝即可命中——迁移建目录后写盘 IO 失败的叠加场景下，daemon 重启 resume 回退到迁移时点快照，失败切换后落在宿主的轮次静默丢失。
- **F4**：claude-only 守卫删除使 cursor 会话也被卷入 reload 内核（未经验证的路径，旧行为是显式拒绝）。

## 设计目标

- reload 失败后 per-session 文件层与内存态一致回到旧供应商形态（或 codex-null 宿主镜像形态）。
- 全部配置写入原子化：任何观察时刻文件要么旧全文要么新全文，失败不留残骸。
- restore 探测依据「切换曾真实生效」的信号，迁移钩子建目录不再造成假阳性；存量已切换会话零回归。
- reload 引擎白名单门，cursor/未知引擎恢复 fail-loud。
- 保持既有语义：ForReload 兜底矩阵五分支、R-01 降级（失败保旧句柄）、宿主 `~/.codex` 只读边界。

## 非目标

- 不改 `applyProviderFileSettingsForReload` 兜底矩阵五分支语义（只新增标记写入副作用）。
- 不做 staging 目录两阶段交换（方案 B 已否决：Windows 多步 rename 不原子 + 丢保守合并兄弟键语义）。
- pi null 切换的留存文件不清理（无 env 指向即惰性无害，目录终态清理归会话收尾）。
- 不处理 OS 断电级持久性（fsync 之上的页面缓存语义超出进程崩溃场景）。

## 拆分判断

单一模块（sillyhub-daemon）、五个文件强耦合于同一事务链（写盘→reload→restore），拆多变更会制造跨变更的中间态不一致；单变更三 Wave 拆任务足够（见总体方案）。

## 总体方案

**Wave 1（原子写基座，D-003）**：新增 `src/atomic-write.ts` 的 `writeFileAtomic`；替换 codex-settings 两处、pi-settings 三处、`mirrorCodexHostAuth` 宿主拷贝一处（copy → tmp → rename）。独立可测、无行为语义变化（产物内容逐字节同旧实现）。

**Wave 2（reload 事务性，D-001/D-002@v2/D-005@v2）**：
1. `_reloadSessionNow` 顶部加引擎白名单门，**仅当本次调用携带 provider 切换载荷时生效**（providerConfig 参数非「未携带」哨兵；config-only 路径（reloadWithConfig/人格切换）不拦，cursor 配置切换行为不变）。白名单 `PROVIDER_RELOAD_ENGINES = ['claude','codex','pi']`（与前端 `PROVIDER_SWITCH_ENGINES` 口径注释互指）；白名单外 throw（fail-loud 恢复）。
2. resume-key 守卫上移到文件层写盘块之前（缺 key 零文件写入直接抛）。
3. catch 块在还原内存态后：若本次 reload 尝试过文件层写入（`hasProviderFileWriter(state.provider)` 且已越过写盘点——以局部布尔标记），best-effort 以 `oldProviderConfig + oldEnv` 重跑 `applyProviderFileSettingsForReload`（绝不抛契约 → 回滚动作自身安全；codex null+prior 键走宿主镜像分支；pi null / undefined 返 {}）。**回滚终态收尾**：若 ForReload 返回空对象（未建立任何文件层键）且 per-session 目录存在 → best-effort 删除 `.sillyhub-managed` 标记（防 restore 把残留产物误判为切换曾生效，D-002@v2）。失败仅 `console.error`，不改变既有 rethrow。

**Wave 3（生效标记与 restore 探测，D-004@v2）**：
1. `provider-file-settings.ts` 落标记文件 `.sillyhub-managed`（JSON：`{envKey, switchedAt}`；经 `writeFileAtomic` 写）。**写入序分两类**：非 null 写入分支（分支一）标记后置 best-effort（写入非破坏性，legacy 判据可兜）；codex-null 镜像分支（分支四）**标记先行**——标记写失败则跳过整个镜像动作、返回 prior CODEX_HOME（「镜像失败=等同未切」语义延伸），删除类动作只发生在标记持久化之后（R-03 双失败残留从根消除）。门槛缺跳过（零写入）路径不落标记。
2. `persistence.ts` null+codex 探测三态化：标记存在 → managed（镜像宿主 + 注 `CODEX_HOME`，现行为，镜像路径同样标记先行）；标记缺失但 `auth.json` 或 `config.toml` 存在 → legacy 兼容（同 managed 处理 + info 日志）；两者皆无 → 零动作（宿主语义，与现状一致）。迁移钩子只建目录 + `sessions/` 子目录 → 恒落第三态，假阳性消失。

**划界**：`migrateCodexThreadFromHost` 的 rollout 拷贝（codex-settings.ts:558 copyFile）**不纳入原子写范围**——它是 thread 历史文件搬运非配置写盘，截断只影响单条历史副本且源文件仍在宿主可重拷，语义上幂等重试可恢复；纳入反而混淆「配置原子性」与「数据搬运」两个概念。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:sillyhub-daemon/src/atomic-write.ts | `writeFileAtomic(path, data)`：tmp+fsync+rename，失败清 tmp |
| 修改 | sillyhub-daemon/src/codex-settings.ts | 两写盘点换 `writeFileAtomic`；mirror 拷贝改 tmp+rename |
| 修改 | sillyhub-daemon/src/pi-settings.ts | 三写盘点换 `writeFileAtomic` |
| 修改 | sillyhub-daemon/src/provider-file-settings.ts | 成功分支落 `.sillyhub-managed` 标记（常量 + 写入副作用） |
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts | 引擎门 + 守卫前移 + catch 文件层回滚 |
| 修改 | sillyhub-daemon/src/interactive/session-manager/persistence.ts | null+codex 探测三态化（标记/legacy/零动作） |
| 新增 | NEW:sillyhub-daemon/tests/atomic-write.test.ts | 原子写单测（顶替/失败清理/旧内容保留） |
| 修改 | sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts | 守卫前移/回滚重写/cursor 拒绝用例 |
| 修改 | sillyhub-daemon/tests/interactive/session-recovery.test.ts | restore 探测三态用例（RESTORE 系真宿主，plan-review 修正） |
| 修改 | sillyhub-daemon/tests/provider-file-settings-reload.test.ts | 标记先行/后置序单测宿主（plan-review 修正） |

## 接口定义

```ts
// src/atomic-write.ts
/** 原子写：写 <path>.tmp-<rand> → fsync → rename 顶替；失败 best-effort unlink tmp 后 rethrow。 */
export async function writeFileAtomic(path: string, data: string, encoding?: 'utf-8'): Promise<void>;

// provider-file-settings.ts 新增导出
export const MANAGED_MARKER_FILENAME = '.sillyhub-managed';
// 标记内容形状（写入侧生成，读取侧只判存在性——内容仅排障用，非契约）
// { "envKey": "CODEX_HOME" | "PI_CODING_AGENT_DIR", "switchedAt": "<ISO>" }

// session-manager.ts 入口门常量（与 frontend/src/lib/provider-caps.ts PROVIDER_SWITCH_ENGINES 口径对齐，注释互指）
const PROVIDER_RELOAD_ENGINES: ReadonlySet<string> = new Set(['claude', 'codex', 'pi']);
```

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| reload 成功 | SessionManager._reloadSessionNow | state + per-session 目录 | resume key、新 providerConfig、新 env | state.env/providerConfig 替换；目录=新供应商产物+标记；旧句柄 close |
| reload 失败（写盘前） | 同上 | state（不动）+ 目录（零写入） | — | 白名单外/缺 resume key → throw；state 与目录均保持旧态 |
| reload 失败（写盘后） | 同上 | state + 目录回滚 | oldProviderConfig、oldEnv | state 还原旧值（既有）；目录 best-effort 重写回旧供应商/宿主镜像形态 |
| daemon 重启 restore（非 null 快照） | persistence | restoreEnv + per-session 目录 | state.providerConfig | ForReload 重写目录+注 env（现行为，标记随写落） |
| daemon 重启 restore（null+codex） | persistence | restoreEnv | 标记/legacy 判定 | 标记或 legacy → 镜像宿主+注 CODEX_HOME；皆无 → 零动作（宿主） |

（会话生命周期状态机本身不变——ended/failed 转移、inputQueue、consume 协程均零改动。）

## 数据模型

无 schema 变更（纯 daemon 文件系统层；`.sillyhub-managed` 是目录内标记文件，非 DB）。

## 兼容策略（brownfield）

- 未切换过的会话：目录不存在/无标记无 auth/config → restore 第三态零动作，行为与现状逐字一致。
- 修复前已切换的存量会话（目录有 auth.json/config.toml 无标记）：legacy 回退按 managed 处理，行为与现状一致（现状=目录存在即 managed），零回归。
- ForReload 兜底矩阵、R-01 降级、宿主只读边界、pi 无 null 探测：语义全部保持。
- 标记写入对 codex/pi CLI 透明（点前缀隐藏文件，codex/pi 不读未知文件）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | catch 回滚重写与下一次 reload/spawn 重写竞态 | P2 | reload 串行化由 `_reloadChains`（session-manager.ts:1731-1755）保证：同 session 的 reload 在链上串行 await，回滚动作在 catch 内同步完成后才 rethrow，下一次 reload 必然晚于回滚落盘。daemon.ts:7881 hot_switch_rewrite 旁路重写发生在 markPendingSwitch **之前**（同事件处理序），其产物会被后续 reload 链内写盘覆盖，与本变更回滚无并发窗口（Grill 复核改写） |
| R-02 | rename 顶替在 Windows 对已存在目标的语义 | P2 | Node `fs.rename` Windows 走 MoveFileEx(REPLACE_EXISTING)；单测在本机 win32 实测顶替成功用例锁定 |
| R-03 | 标记写入失败被误当切换失败 / 双失败残留 | P2 | 分支一：标记后置 best-effort（warn 不抛），写盘主体已成功，legacy 判据兜住无标记场景。分支四：**标记先行**——标记写失败则跳过整个镜像（含删除动作），返回 prior CODEX_HOME；「删除发生在标记持久化之后」为不变量，双失败（标记失败+镜像删除）组合从根消除（Grill 复审 D-004@v2） |
| R-04 | 守卫前移改变既有错误顺序（缺 key 会话原在写盘后才报错） | P3 | 错误 message 逐字保留；仅触发时序提前，测试断言 message 不变 |
| R-05 | fsync 在极老文件系统/网络盘的性能 | P3 | 每会话切换仅 5-6 个小文件，可忽略；不引入开关 |

## 决策追踪

> 注：FR-01~FR-05 编号定义体在 requirements.md（「生成规范文件」步产出），本表引用以彼为定义源。

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 总体方案 Wave 2-2；FR-01 | 已覆盖 |
| D-002@v2 | 总体方案 Wave 2-3（含回滚终态删标记收尾）；FR-02 | 已覆盖（Grill 修入） |
| D-003@v1 | 总体方案 Wave 1；FR-03；接口定义 writeFileAtomic；rollout 拷贝划界 | 已覆盖 |
| D-004@v2 | 总体方案 Wave 3（分支四标记先行）；FR-04；接口定义 MANAGED_MARKER_FILENAME | 已覆盖（Grill 修入） |
| D-005@v2 | 总体方案 Wave 2-1（门作用域限 provider 维度）；FR-05 | 已覆盖（Grill 修入） |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本决策（D-001@v1 / D-002@v2 / D-003@v1 / D-004@v2 / D-005@v2，v2 均为 Grill 修入）
- [x] 涉及生命周期关键词 → 含「生命周期契约表」（reload/restore 五事件矩阵）
- [x] UI 原型分级核对：纯 daemon 变更无前端文件，跳过原型
- [x] 不确定的问题标注：无（Grill 5 gap 全部修入：FR 注记/undefined 边缘/rollout 划界/R-03 标记先行/R-01 机制改写+门作用域）
