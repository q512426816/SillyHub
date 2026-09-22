---
author: qinyi
created_at: 2026-09-11 23:26:07
scale: large
---

# 设计文档（Design）— 2026-09-11-provider-adapter-registry

## 背景

平台每接入一个新引擎（claude/codex/pi/cursor 之后还会有 gemini 等），需要在**至少七八处**分别登记：driver 注册表（providers.ts）、能力矩阵 PROVIDER_CAPS（三端手抄镜像）、env 注入器（credential-injector.ts REGISTRY）、文件层写盘器分派（provider-file-settings.ts）、daemon 侧硬编码 kind 判断（热切换重写 daemon.ts:7692、per-session 目录清理、restore 探测 persistence.ts）、前端解锁白名单（PROVIDER_SWITCH_ENGINES 手写常量，R-04 注释提醒同步义务）、backend agent_kind 词表。清单散落且无强制，漏一项轻则功能缺失、重则静默故障；写盘器还可能「实现了但协议取值错」（ql-20260911-029：pi api 写死 openai-completions 致智谱 anthropic 端点全断流——mock golden 只有 OpenAI 一种形态没拦住）。

现状盘点：`ProviderDescriptor`（providers.ts:262）已承载 provider/family/displayName/createDriver/caps 五要素；`INTERACTIVE_PROVIDERS` 注册表 + `PROVIDER_CAPS` 三端镜像 + 对齐测试（backend/app/modules/agent/tests/test_provider_caps_alignment.py）已就位。**聚合契约不是从零建，是扩展 ProviderDescriptor 收口其余散落点。**

## 设计目标

1. **FR-01 聚合契约**：新引擎接入 = 在聚合表加**一份声明**（ProviderAdapter：现有五要素 + env 注入器【显式可选】+ 文件层写盘器【显式可选】+ per-session 目录类型 + 冒烟套件声明）。强制分两层（Grill/plan 审查 GAP-3 修正：`satisfies Record<InteractiveProvider, ...>` 与 `InteractiveProvider = keyof typeof INTERACTIVE_PROVIDERS`（providers.ts:368）同表推导循环，tsc 实测 TS7022/TS2456）——**编译期**：聚合表 `satisfies Record<string, ProviderAdapter>`（providers.ts:358 现行先例形态，条目缺任一必填字段即 TS2741 编译红）；**测试期**：守护测试交叉校验聚合表键集合 === 引擎全集事实源（agent-detector 检测键 + backend agent_kind 词表）——全引擎覆盖由跨注册表对账强制，比 keyof 自推导更真实（引擎全集的事实源本就不在聚合表自身）。
2. **FR-02 派生改造**：现有各注册表（credential-injector REGISTRY、provider-file-settings 分派）数据源改为从聚合表派生，**模块导出面与调用点零改动**（行为零漂移由既有测试锁定）。
3. **FR-03 硬编码收口**：daemon.ts:7692 热切换重写判断、`_cleanupProviderFileDirs` 目录清单、persistence restore 目录探测——三处 kind 字面量改读聚合表元数据（`perSessionDir`），新引擎不再需要记得改这三处。
4. **FR-04 caps 生成 + 白名单派生**：caps 增第 10 键 `provider_switch: boolean`（语义=支持会话级供应商切换）；daemon providers.ts 单源 → 生成脚本产出 `frontend/src/lib/provider-caps.ts` 与 `backend/app/modules/agent/provider_caps.py`（产物头注「生成勿手改」）；前端 `PROVIDER_SWITCH_ENGINES` 手写常量退役，改为从生成的 PROVIDER_CAPS 派生；对齐测试保留守护生成物不被手改。
5. **FR-05 冒烟制度化**：写盘器强制带「api_format → 协议字段」映射表测试（每种平台支持格式一个用例）；adapter 声明 `smokeSuite`（冒烟测试文件名），守护测试校验该文件真实存在且覆盖全部支持格式——杜绝 ql-20260911-029 类「实现错」漏网。

## 非目标

- 不改任何引擎现有行为（纯收口重构；claude/codex/pi/cursor 行为零漂移，既有 162+55 测试锁定）。
- 不做 gemini 实现（注册表 satisfies 强制下，接入时自然被编译拦住直到声明齐备——这正是本变更的价值）。
- 不动 backend inject_gates 422 语义与 agent_kind 词表校验（backend 只消费生成的 caps）。
- 不把 per-engine 差异逻辑（codex 迁移/镜像、pi 无迁移）塞成接口方法——保持「能力=接口，配置=元数据」二分（差异留在现有 helper，聚合表只持有元数据指针）。
- 不做运行时注册中心（方案 B 已否决）。

## 拆分判断

单一变更不拆：聚合契约、派生改造、硬编码收口、生成脚本四者互为验收依赖（契约不派生=空架子；派生不收口=硬编码仍漏；生成不挂白名单=手抄义务仍在）。Wave 按「契约+派生 → 硬编码收口 → 生成脚本+白名单 → 冒烟制度化+守护测试」串行，测试随任务落地。

## 总体方案

### Wave 1：聚合契约 + 派生改造（sillyhub-daemon）

1. providers.ts：`ProviderDescriptor` 扩展为 `ProviderAdapter`（interface extends），新增四字段：
   - `envInjector: () => CredentialInjector | { kind: 'none'; reason: string }`（**懒工厂**——返回实例或显式 none+理由；codex 的「刻意不注册」从注释升格为声明式元数据。函数形态是 import 环解法的一半：providers.ts 与 credential-injector.ts 互相仅在函数体内访问）
   - `fileSettings: ProviderFileSettingsWriter | { kind: 'none'; reason: string }`（claude 为 none+理由：settings.json 链路在 daemon.ts applyClaudeSettings；writer 统一接口见接口定义段——五要素抹平两写盘器差异）
   - `perSessionDir: 'codex' | 'pi' | { kind: 'none' }`（目录清理/孤儿清扫/restore 探测/热切换重写/reload 门控的统一数据源）
   - `smokeSuite: string`（冒烟测试文件名，守护测试消费）
   - `switchable: boolean`（与 caps.provider_switch 单源一致由类型交叉保证）
2. providers.ts：`INTERACTIVE_PROVIDERS` 升级 satisfies `Record<string, ProviderAdapter>`（沿用 :358 现行形态——条目字段完备编译强制；全引擎覆盖归守护测试跨注册表对账，见 FR-01）；PROVIDER_CAPS 表加 `provider_switch` 键（claude/codex/pi=true，cursor=false）并与 adapter.switchable 同值（单测锁一致）。**测试联动**：backend 对齐测试 EXPECTED_CAPS_KEYS 9→10（:38-50/:145/:192）与 daemon `tests/interactive/provider-registry.test.ts` 的 nineKeys 硬编码（:124/:128/:142）随第 10 键同步更新（两文件入清单——Grill P1-2 + plan 审查 GAP-1）。
3. credential-injector.ts：REGISTRY 改为**惰性 memoized 派生**（`getInjector` 首次调用时从 INTERACTIVE_PROVIDERS 构建 envInjector 实例表并缓存；模块级不再执行 Object.fromEntries——**import 环解法的另一半**：两模块互相引用均延迟到函数体内，ESM 求值零 TDZ）；导出面不变（getInjector 签名零改动，惰性对调用方透明——注入器无状态，首调时机构建等价）。
4. provider-file-settings.ts：**两处分派同改**（plan 审查 GAP-2）——`applyProviderFileSettings`（spawn 版 :112/:138）与 `applyProviderFileSettingsForReload`（:252/:278 内部 codex/pi 分派）统一改按 adapter.fileSettings 派发（writer 接口五要素：write/gate/envKey/dirName/官方端点 skip 语义——见接口定义；codex 的 daemonApiKey 消费差异收进 write 入参可选字段；ForReload 的 priorEnv 兜底矩阵**逻辑不变**，仅分派来源换 writer）；导出与失败语义不变（ForReload 21 矩阵 + dispatch 22 用例锁定零漂移）。

### Wave 2：硬编码收口（sillyhub-daemon，实为六处——Grill P1-4 修正）

1. daemon.ts:7815 一带（热切换尽力重写）：`agentKind !== 'codex' && agentKind !== 'pi'` → 查聚合表 `adapter(agentKind).fileSettings` 是否为 writer（是→重写，否→零动作；claude/cursor/未知与原判断逐类等价）。
2. daemon.ts `_cleanupProviderFileDirs`：硬编码 codex/pi 两目录 → 遍历聚合表 perSessionDir 非 none 的目录类型。
3. daemon.ts:4774 一带 `_sweepOrphanProviderFileDirs`：硬编码 `['codex','pi']` 孤儿清扫清单 → 同上遍历派生（漏改则残留目录永不清——Grill 发现）。
4. persistence.ts:337 外层门控（`provider === 'codex' || provider === 'pi'`）→ 改读 adapter.fileSettings 是否 writer；:353 codex 专属 stat 探测逻辑的目录类型判定改读 perSessionDir==='codex'（保持仅 codex 探测语义——pi 无目录历史）。
5. session-manager.ts:1825 一带（_reloadSessionNow 合并块门控 `state.provider === 'codex' || 'pi'`）→ 同 4 改读元数据（漏改则新引擎 reload 丢文件层 env——Grill 发现）。
6. `_noteProviderFileDirs` 登记键保持不变（env 键名仍是唯一事实源）。

### Wave 3：caps 生成脚本 + 前端白名单派生（daemon + frontend + backend 产物）

1. 新增 `sillyhub-daemon/scripts/gen-provider-caps.mjs`：**零新依赖静态解析**（Grill P2：daemon 无 tsx 依赖，dist 依赖构建——采用对齐测试同款先例的源解析路线）——括号匹配提取 providers.ts 的 PROVIDER_CAPS 字面量表 → **响亮失败守卫**（解析必须找到全部 InteractiveProvider 键且每键恰好 caps 键集合，否则 exit 1 不写产物）→ 生成：
   - `frontend/src/lib/provider-caps.ts`（PROVIDER_CAPS + ProviderCaps 接口 + getProviderCaps，文件头「@generated 勿手改，源=sillyhub-daemon providers.ts，重跑 gen-provider-caps」）
   - `backend/app/modules/agent/provider_caps.py`（同值 dict + 默认拒绝 fallback）
   - 幂等：重跑产物逐字节稳定（排序键、固定格式）。
2. frontend `gen:types` 链尾追加调用（`node ../sillyhub-daemon/scripts/gen-provider-caps.mjs`，追加式 && 短路不破坏原命令）；backend 无构建链，产物提交制 + 对齐测试守护。
3. frontend `PROVIDER_SWITCH_ENGINES` 常量退役：改为 `provider-caps.ts` 内生成（从 PROVIDER_CAPS 派生 `provider_switch===true` 集合），消费点（config-bar/panel/两测试文件）import 路径不变。

### Wave 4：冒烟制度化 + 守护测试

1. 写盘器映射表测试规范：pi-settings/codex-settings 各加「api_format 全词表 → 期望协议字段」表驱动用例（pi 现有 anthropic-messages 用例即范式；codex 的 wire_api/config.toml 形态同理）。
2. 新守护测试 `tests/provider-adapter-registry.test.ts`：
   - 聚合表覆盖全部 InteractiveProvider（编译已强制，测试冗余锁定运行时形态）；
   - 每 adapter 的 smokeSuite 文件真实存在于 tests/；
   - smokeSuite 内容静态扫描：含「api_format 词表全量」的表驱动断言（按文件内容 grep 词表字面量）；
   - caps 与 adapter.switchable 一致；三端 caps 对齐（对齐测试保留）。
3. 现有测试全量回归（daemon 修改相关套件 + frontend 两套件），行为零漂移判定。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/interactive/providers.ts | ProviderDescriptor→ProviderAdapter 扩展四字段；聚合表 satisfies 强制；caps 加 provider_switch 第 10 键（单源） |
| 修改 | sillyhub-daemon/src/credential-injector.ts | REGISTRY 改惰性 memoized 派生（import 环解法）；导出面不变 |
| 修改 | sillyhub-daemon/src/provider-file-settings.ts | kind 分派改按 adapter.fileSettings 派发（writer 五要素接口）；失败语义不变 |
| 修改 | sillyhub-daemon/src/daemon.ts | :7815 热切换判断 + _cleanupProviderFileDirs + _sweepOrphanProviderFileDirs 三处改读元数据 |
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts | _reloadSessionNow 合并块门控（:1825 一带）改读 adapter 元数据 |
| 修改 | sillyhub-daemon/src/interactive/session-manager/persistence.ts | restore 外层门控 + codex 探测目录类型改读 perSessionDir |
| 新增 | NEW:sillyhub-daemon/scripts/gen-provider-caps.mjs | caps 单源生成脚本（零依赖静态解析+响亮失败守卫；frontend ts + backend py 双产物，幂等） |
| 修改 | frontend/package.json | gen:types 链尾挂 caps 生成 |
| 修改 | frontend/src/lib/provider-caps.ts | 改为生成产物（文件头 @generated + PROVIDER_SWITCH_ENGINES 派生导出，消费点 import 不变） |
| 修改 | backend/app/modules/agent/provider_caps.py | 改为生成产物（对齐测试守护） |
| 修改 | backend/app/modules/agent/tests/test_provider_caps_alignment.py | EXPECTED_CAPS_KEYS 9→10 键 + len 断言同步（Grill P1-2：硬编码键集合随单源演进） |
| 修改 | sillyhub-daemon/tests/interactive/provider-registry.test.ts | nineKeys 硬编码 9→10 键联动（plan 审查 GAP-1：:124/:128/:142 锁键集合必红） |
| 修改 | sillyhub-daemon/tests/pi-settings.test.ts | api_format 全词表表驱动映射用例（冒烟制度化） |
| 修改 | sillyhub-daemon/tests/codex-settings.test.ts | 同款表驱动用例（wire_api/config 形态） |
| 新增 | NEW:sillyhub-daemon/tests/provider-adapter-registry.test.ts | 守护测试（覆盖/smokeSuite 存在性/词表覆盖扫描/caps 一致/REGISTRY 惰性派生等价） |

无对外接口/DTO/payload 变更（caps provider_switch 键为三端同步生成，backend 消费端无新 API）。

## 接口定义

```ts
// sillyhub-daemon/src/interactive/providers.ts（扩展，示意）
export interface ProviderAdapter extends ProviderDescriptor {
  /** env 层注入器懒工厂（函数形态=import 环解法：两模块互相仅在函数体内访问）；
   *  显式 none+理由（codex：二进制无 env 面，凭证走文件层）。 */
  envInjector: () => CredentialInjector | { kind: 'none'; reason: string };
  /** 文件层写盘器或显式 none+理由（claude：settings.json 链路在 daemon.ts）。 */
  fileSettings: ProviderFileSettingsWriter | { kind: 'none'; reason: string };
  /** per-session 目录类型（清理/孤儿清扫/restore 探测/热切换/reload 门控的统一数据源）。 */
  perSessionDir: 'codex' | 'pi' | { kind: 'none' };
  /** 冒烟套件文件名（守护测试校验存在性+词表覆盖）。 */
  smokeSuite: string;
  /** 会话级供应商切换支持（与 caps.provider_switch 单源一致，测试锁定）。 */
  switchable: boolean;
}
export const INTERACTIVE_PROVIDERS: Record<string, ProviderAdapter>; // satisfies Record<string, ProviderAdapter>——条目字段完备编译强制；全引擎覆盖由守护测试跨注册表对账（detector 键 + backend agent_kind 词表）

/**
 * 文件层写盘器统一接口（Grill P1-1：抹平 writeCodexHome/writePiDir 签名与
 * per-kind 五项差异——write/gate/envKey/dirName/官方端点 skip）。
 * 实现分别为 codex-settings / pi-settings 的薄适配（写盘器本体不动）。
 */
export interface ProviderFileSettingsWriter {
  /** per-session 目录段名（join(daemonStateDir(), dirName, sessionKey)）。 */
  dirName: 'codex' | 'pi';
  /** 注入 env 键名（CODEX_HOME / PI_CODING_AGENT_DIR）。 */
  envKey: string;
  /** 门槛判定（与写盘器同判据；provider 缺必需字段 → false，调用方 warn 跳过）。 */
  isSufficient: (provider: ProviderConfig) => boolean;
  /** 写盘（目录已建；入参归一：pi 不消费 daemonApiKey 传 undefined）。 */
  write: (input: { dir: string; provider: ProviderConfig; daemonApiKey: string | null }) => Promise<void>;
  /** 官方端点形态跳过判定（pi：base_url 空 → true 静默跳过走 env 层；codex 恒 false）。 */
  skipsOfficialEndpoint: (provider: ProviderConfig) => boolean;
}
```

## 生命周期契约表

不适用 lifecycle contract（纯注册表/生成脚本重构，无 session/lease/daemon 生命周期事件变更；热切换与 restore 的行为经元数据派生后语义逐字不变，由既有测试锁定）。

## 数据模型

无 schema/表结构变更。

## 兼容策略（brownfield 必填）

- **行为零漂移**：四引擎全部既有测试（daemon 162 修改相关 + frontend 55）不改预期全绿（例外声明：caps 对齐测试的键集合 9→10 为单源演进的联动更新，非行为漂移）；REGISTRY/getProviderCaps/applyProviderFileSettings 导出签名不变。
- **前端测试零联动**：白名单派生保持 import 路径与值不变，config-bar/caps 两套件预期零改动（不入文件清单）。
- **生成产物落地策略**：首次生成产物与现手写文件的 diff 应仅为「文件头 @generated 注释、镜像注释文本差异（三端注释本就互不相同，生成器统一为单源注释——预期内）、provider_switch 新键、白名单派生段」；出现**取值差异**即派生逻辑错，回退修脚本（Grill P2 修正：判据按值不按注释文本）。
- **未接入新引擎（gemini）**：InteractiveProvider 联合不含 gemini，satisfies 不受影响；未来加 gemini 时联合扩一员 → satisfies 立即编译红直到聚合表补齐声明——这就是防遗漏机制本身。
- **回退路径**：整体 revert 回手抄三端 + 硬编码判断现状；生成产物文件回手写形态。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 派生改造引入行为漂移（REGISTRY/file-settings 分派） | P0 | 现有 21+17 矩阵测试逐字锁定；派生前后 diff 产物表对比（测试内快照断言） |
| R-02 | 生成脚本解析 ts 源失败/格式漂移 | P1 | 零依赖括号匹配解析 + 响亮失败守卫（未找齐全部引擎键/键集合不符即 exit 1 不写产物）；幂等重跑断言（守护测试跑两遍 diff 为空） |
| R-03 | frontend gen:types 链改动破坏现有 OpenAPI 流程 | P1 | 追加式挂钩（链尾 && 短路不影响原命令）；跑 gen:types 全流程回归 |
| R-04 | provider_switch 进 caps 后 backend 消费端认知 | P2 | backend 运行时消费三处（attachments.py:58/:223、session_lifecycle.py:106、ppm_activation.py:142——Grill P2 核实）均按键取值，additive 新键零破坏；422 词表语义不动（非目标）；verify 核对无按 len(键集合) 分支的消费点 |
| R-05 | smokeSuite 词表覆盖扫描误报/漏报 | P2 | 扫描规则保守（词表字面量全出现才过）；规则写进守护测试注释可演进 |
| R-06 | persistence/daemon 元数据化改动碰 god 文件（session-manager.ts/daemon.ts） | P1 | 改动限定元数据读取表达式，不触碰函数结构；相关套件全跑 |
| R-07 | UI 原型跳过（纯契约/生成/测试重构，无界面变化——分级依据 Step 5 已声明） | P2 | 记录在案 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 全量一次收口 | 全部 FR、Wave 1-4 | 已覆盖 |
| D-002@v1 caps 生成脚本 | FR-04、Wave 3 | 已覆盖 |
| D-003@v2 编译期聚合（方案 A；@v2 修订：实现落点=providers.ts 内扩展 INTERACTIVE_PROVIDERS，不另立 provider-adapter.ts 契约文件——ProviderDescriptor 已承载五要素，原地扩展改动面最小；@v1 的「新建独立文件」表述作废） | FR-01/02、Wave 1 | 已覆盖 |

## 自审

- [x] 章节齐全（12 章节 + 生命周期豁免短语 + 数据模型无变更声明）
- [x] frontmatter 齐全（scale=large——跨三端多文件契约重构）
- [x] 引用全部当前版本 D-xxx@vN（D-001/002/003 入决策追踪）
- [x] 生命周期关键词 → 已写紧邻豁免短语（「不适用 lifecycle contract」）
- [x] UI 原型分级核对：跳过，R-07 在案（无界面变化）
- [x] 不确定问题：无「⚠️ 自审存疑」；生成脚本解析方式（tsx 执行导出 vs 静态解析）在 Wave 3 内定，R-02 已登记应对
