---
author: flow-machine-draft
created_at: 2026-10-21T23:14:12.277Z
---
# 需求规格（Requirements）— 2026-10-22-review-risk-fixes

## 功能需求

### FR-01: /proto/session-redesign/page.tsx 显式 export const dynamic = 'force-dynamic'（对齐 session-trajectory/page.tsx:24 同款），消除构建期静态预渲染读盘

- 该路由**必须**在请求时才执行 `loadStagedSessionExport()` 读盘（Next 14 App Router 语义：声明 `export const dynamic = 'force-dynamic'` 后不进构建期静态预渲染）；**禁止** `next build` 产物的 `/proto/session-redesign` 静态页/RSC 载荷内嵌 `.proto-staging/session-export.json` 内容。

#### 场景：工作树构建不烘数据

- Given：构建上下文含 `frontend/.proto-staging/session-export.json`（3.3MB 真实会话导出）且 FR-02 的 dockerignore 排除尚未生效或被绕过
- When：`next build`（Next 14.2.5，App Router）
- Then：该路由不做静态预渲染（无预渲染 HTML/RSC 数据文件产出），真实数据不可能被烘进构建产物；运行时行为不变（请求时读盘，文件缺失渲染占位符——与 staged-session-export.ts 注释自述的「dev 预览页是 force-dynamic」口径对齐）

#### 场景：dev 预览能力不回归（对齐知识 FR-frontend-018）

- Given：本地 dev server 且 `.proto-staging/` 在位
- When：访问 `/proto/session-redesign`
- Then：SSR 照常读到真实会话内容（请求时读盘，能力与修复前一致）

### FR-02: frontend/.dockerignore 追加 /.proto-staging/，工作树 docker build 不再拷入真实会话导出

- `frontend/.dockerignore` **必须**排除 `/.proto-staging/`，并同步排除 `/public/__proto*/`（gitignore 同款防线，public/ 是会直拷进 runtime 镜像的面）；docker 构建上下文**禁止**包含真实会话导出文件。

#### 场景：从含导出文件的工作树构建镜像

- Given：工作树存在 `frontend/.proto-staging/session-export.json`
- When：`docker compose ... up --build`（frontend/Dockerfile builder 阶段 `COPY . .`）
- Then：构建上下文与 builder 层均不含该目录（dockerignore 优先于 COPY 通配），即使 FR-01 失效也无数据可烘

### FR-03: event-loop-watch 正常窗口走完后 AbortSignal 的 abort 监听器计数不随窗口数增长（新增测试以真实 defaultSleep 断言）

- `defaultSleep` 在定时器**正常到期**路径**必须**摘除已注册的 abort 监听器；daemon 生命周期内的 AbortSignal 上 abort 监听器计数**禁止**随采样窗口数无界增长；abort 中断路径的 reject 行为**必须**保持不变。

#### 场景：连续多窗口后监听器计数归零

- Given：真实 `defaultSleep`（不注入 sleep）与未触发的 AbortController
- When：连续完成 N（≥3）个窗口的 sleep（定时器正常到期）
- Then：signal 的 abort 监听器计数为 0（修复前每窗口滞留 1 个监听器+闭包，每 60s +1，Node AbortSignal 无超限告警、静默慢性泄漏）

#### 场景：abort 路径行为不变

- Given：sleep 在挂起中被 abort
- When：signal.abort()
- Then：sleep 立即 reject（循环顶部 break 优雅退出，对齐 2026-10-21-spec-conflict-autoheal P3② 既有语义）

### FR-04: decodeGitCQuote 对含字面引号与非 ASCII 混合路径（如 中文"x.md）完整还原原文（新增单测，UTF-8 多字节按原字节组装）

- `decodeGitCQuote` 对 C 引号内的**字面**（非转义）字符**必须**按其 UTF-8 原字节组装（codePoint→UTF-8 字节序列，含代理对/增补平面），**禁止**按 charCodeAt 截断为低字节；解码结果**必须**与原路径逐字符相等。

#### 场景：字面引号转义 + 原样非 ASCII 混合形态

- Given：`-c core.quotepath=false` 下 git 对含字面 `"` 的路径输出 `"中文\"x.md"`（非 ASCII 原样、引号转义；修复前 `中` 0x4E2D 被 `Buffer.from` 截断为 0x2D 产生乱码）
- When：`decodeGitCQuote('"中文\\"x.md"')`
- Then：还原 `中文"x.md`（逐字符相等）

#### 场景：增补平面字符（代理对）

- Given：C 引号内含 emoji 等增补平面字面字符（代理对两个 code unit）
- When：解码
- Then：按完整 codePoint 的 UTF-8 字节组装，还原原文（不拆代理对）

#### 场景：既有形态回归

- Given：纯八进制转义（quotepath=true 形态）、非引号形态、畸形形态
- When：解码
- Then：行为与 GL47 既有断言一致（纯逻辑回归，禁止语义漂移）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径`「用例名」；空行/待填在 flow done 拒收）

FR-01: 不适用：Next 路由级 `dynamic` 声明属构建配置面（无运行时函数可断言，导入 page 会拖入整棵客户端组件树）；验收 = 源码声明在场 + `cd frontend && pnpm tsc --noEmit` 零错 + 构建产物抽查（人工核对 .next 无该路由预渲染数据）
FR-02: 不适用：dockerignore 属构建上下文配置面；验收 = 声明在场（`/.proto-staging/` 与 `/public/__proto*/` 两行）+ 构建时人工核对上下文
FR-03: sillyhub-daemon/tests/event-loop-watch.test.ts「defaultSleep 正常到期路径摘除 abort 监听器（连续窗口后计数归零）+ abort 路径 reject 行为不变（真实 defaultSleep 走 runEventLoopWatch）」
FR-04: sillyhub-daemon/tests/host-fs-handler-git-log.test.ts「GL49: 混合路径（字面引号转义 + 原样非 ASCII/增补平面）解码逐字符还原原文」+ 既有 GL47/quotepath 套件回归
