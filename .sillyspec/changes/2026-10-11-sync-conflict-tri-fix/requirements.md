---
author: flow-machine-draft
created_at: 2026-10-11T09:38:34.760Z
---
# 需求规格（Requirements）— 2026-10-11-sync-conflict-tri-fix

## 功能需求

### FR-01: platform-sync-section 渲染注册表「版本冲突」型开放行（非纯墓碑）并给对比/裁决入口，未决冲突计数与横幅口径一致

- 必须：platform-sync-section 对 `GET /spec-conflicts?status=open` 返回的 stage=spec-sync 行，凡「版本冲突面」非空（conflicting_paths 剔除 platform_deleted 后非空）且按 `changes/(archive/)?<名>/` 可归因出变更名、且该变更名未被机器 pending_conflicts 行覆盖时，渲染为 spec 型冲突行（含「查看对比」入口，走既有 ConflictCompareModal 裁决通道）；卡头「未决冲突」计数 = 渲染行数。
- 禁止：纯墓碑行（conflicting_paths ⊆ platform_deleted）改走本条渲染——继续走既有墓碑行形态（「收敛本机目录」按钮）。

#### 场景：主路径（注册表行可见可裁决）

Given 注册表有 1 条开放行（conflicting_paths 含 `changes/archive/X/tasks.md`，platform_deleted 为空）且机器 pending_conflicts 为空
When 渲染平台同步区块
Then 渲染 1 行 spec 徽章 + 变更名 X + 「查看对比」按钮，卡头「未决冲突」= 1（与横幅计数一致）。

#### 场景：与机器行去重

Given 同一变更名已存在于机器 pending_conflicts 行（CLI 侧冲突）
When 渲染
Then 只渲染机器行一次，不因注册表行重复渲染。

#### 场景：混合行（版本冲突 + 墓碑并集）

Given conflicting_paths 同时含版本冲突路径与 platform_deleted 路径
When 渲染
Then 按版本冲突面归因渲染（墓碑行判定要求纯墓碑，混合行不额外渲染墓碑行）。

### FR-02: daemon 增量推送撞乐观锁冲突后自动重拉 re-base 一次并重试，re-base 后仍冲突才落注册表

- 必须：postSpecSync 增量路径收到 conflict=true 且响应 server_versions 非空时，用 server_versions 就地改写**内存**清单缓存中对应路径的 version，重算 ops 并重试推送**恰好一次**；重试成功按既有成功路径回写缓存返回；重试仍冲突则抛 SpecPushConflict（backend 落注册表语义不变——首次失败已落行，重试全绿会自动关行，形成自愈闭环）。
- 禁止：重试超过一次（防写放大/活锁）；re-base 的内存版本改写在失败路径落盘（磁盘缓存仅由成功路径回写）。

#### 场景：主路径（re-base 自愈）

Given 缓存 base_version 过期（他端已把文件推到 v4，本地持 v2，内容相同——2026-10-11 生产实证 workflow 工作区形态）
When 增量推送撞 conflict → re-base 到 v4 → 重算 ops（同内容豁免 / base 匹配）→ 重试
Then 全绿返回，不抛 SpecPushConflict，注册表开放行随全绿自动关闭。

#### 场景：真分叉仍上抛

Given 两端对同路径内容真分叉
When 首推 conflict → re-base → 重试仍 conflict
Then 抛 SpecPushConflict，调用方语义与现状一致（warn + 人工裁决）。

#### 场景：无版本面不重试

Given conflict=true 但 server_versions 为空
When 推送
Then 直接抛 SpecPushConflict（无从 re-base，不做无意义重算）。

### FR-03: sillyspec CLI platform sync 支持不带 --change 的全树同步；assertSafeChangeName 放行磁盘已存在的变更名

- 必须：`sillyspec platform sync` 不带 --change 时执行全树 spec 文件增量同步（syncSpecTree 通道，以服务器清单为锚做全树 diff），不再报「需要指定变更名称」；进度六表同步仍需 --change（按变更粒度，语义不变）。assertSafeChangeName 字符集由 `[\w.\-]` 扩为 `[\w.\-一-鿿]`（与 assertDatedChangeName slug 同集），路径分隔符与 `..` 拒绝语义不变。
- 禁止：放宽路径穿越消毒（含 `/`、`\`、`..` 的名字必须仍被拒）；新建变更名绕过 assertDatedChangeName 日期前缀门（该门不受本条影响）。

#### 场景：主路径（全树同步）

Given 工作区已 platform connect、归档目录与活跃目录均有待同步内容
When `sillyspec platform sync`（无 --change）
Then 走 syncSpecTree 全树 diff 推送完成，退出码 0，无「需要指定变更名称」报错。

#### 场景：中文名放行（生产实证用例）

Given 磁盘存在 `changes/archive/2026-10-10-取消LTC宽表校验规则/`
When `sillyspec platform sync --change 2026-10-10-取消LTC宽表校验规则`
Then 守卫放行进入同步（不再报「含非法字符」）。

#### 场景：穿越仍拦

Given `--change "a/../b"` 或 `--change "a/b"`
When 任一经守卫入口
Then 仍被拒（安全语义不回归）。

#### 场景：未连接明确提示

Given 未 platform connect
When `sillyspec platform sync`（无 --change）
Then 输出明确「未连接平台」提示，不静默成功。

### FR-04: 三处修复各有单测覆盖且相关测试全绿

- 必须：前端 platform-sync-section.test.tsx 增注册表版本冲突行渲染/去重/计数用例；daemon spec-sync 增量测试增 re-base 重试（自愈/仍冲突上抛/失败不落盘）用例；CLI test/ 新增 .test.mjs 覆盖全树同步入口与守卫字符集（放行 CJK、仍拒穿越）。仅跑改动相关测试，全量留给 CI。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/changes/__tests__/platform-sync-section.test.tsx「注册表版本冲突行——机器 pending_conflicts 为空也渲染：spec 徽章 + 变更名 + 查看对比 + 计数对齐」
FR-01: frontend/src/components/changes/__tests__/platform-sync-section.test.tsx「注册表版本冲突行与机器行同名去重——机器行优先不重复渲染」
FR-02: sillyhub-daemon/tests/spec-sync-incremental.test.ts「conflict → re-base 重试全绿 → 自愈成功（他端先推型，2026-10-11-sync-conflict-tri-fix FR-02）」
FR-02: sillyhub-daemon/tests/spec-sync-incremental.test.ts「conflict → re-base 重试仍 conflict → 抛 SpecPushConflict（不静默覆盖，NFR-02 / 2026-10-11-sync-conflict-tri-fix FR-02）」
FR-03: sillyspec 仓 test/platform-sync-fulltree.test.mjs「全树冲突归因单一 CJK 变更——冲突文件按变更名落盘（per-change 兼容）」（跨仓：commit e0b1ce16）
FR-03: sillyspec 仓 test/assert-safe-change-name.test.mjs「日期前缀+中文描述」（跨仓：commit e0b1ce16）
FR-04: 三处用例见 FR-01/02/03 绑定行——daemon 17 用例 + 前端 23 用例 + CLI 3 用例全绿，另生产冒烟两条（platform sync 全树 0 差异 exit 0；中文名 --change 同步终态墓碑上行 exit 0）
