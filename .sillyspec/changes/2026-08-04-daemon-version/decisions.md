---
author: WhaleFall
created_at: 2026-08-04 11:04:59
---

# 决策台账 — daemon 版本可见与构建号自动注入

> 本次变更的实现/验收决策。长期术语在 archive/scan 时再提升到 glossary.md。

## D-001@v1 — 用构建号（非语义版本）承载"每次改都变"

- type: design
- status: accepted
- source: 用户诉求"每次改 daemon 版本都要变，现在一直 0.1.0"
- question: "版本每次改都变"应由哪个字段承载？
- answer: 由 BUILD_ID（构建号 = git short sha + 时间戳）承载，每次编译自动变；语义版本 DAEMON_VERSION（0.1.0）保持手动管理（标记大版本里程碑）。
- normalized_requirement: 每次编译生成唯一构建标识，反映当前代码状态。
- impacts: FR-02, FR-03, design §5.A, §2
- evidence: 用户原话"每次修改daemon的时候版本都要有变化 现在好像版本号一直是0.1.0"；构建号定义见 build-bundle.sh:29-30
- priority: P0

## D-002@v1 — 采用方案1 共享 gen-build-id.mjs

- type: design
- status: accepted
- source: brainstorm step 4 三方案对比
- question: 构建号如何在 dev build（tsc）时也自动更新？
- answer: 新增 scripts/gen-build-id.mjs（node 跨平台），pnpm build（prebuild）+ pnpm bundle（build-bundle.sh）共用它重写 src/build-id.ts。否决方案2（运行时 git 探测，分发版无 git 会 fallback 旧值、dev/prod 分叉）与方案3（post-tsc 改 dist，src/dist 版本不一致）。
- normalized_requirement: 构建号生成逻辑 dev/prod 同源、跨平台、git 历史干净。
- impacts: FR-02, design §5.A.1, §5.A.3, 文件清单
- evidence: brainstorm step 4 方案对比；build-bundle.sh:29-39 现有 printf 逻辑
- priority: P0

## D-003@v1 — build-id.ts 移出版控 + postinstall/prebuild 生成

- type: design
- status: accepted
- source: 方案1 落地细节
- question: build-id.ts 每次 build 重写会脏污 git 工作区，如何处理？
- answer: src/build-id.ts 加入 .gitignore（git rm --cached），由 gen-build-id.mjs 在 postinstall（clone/CI 后生成默认值）+ prebuild（每次 build 更新）自动生成。保证 tsc 永远能找到该文件。
- normalized_requirement: git 工作区不被构建号污染，同时 tsc 不缺文件。
- impacts: FR-03, design §5.A.2-3, 文件清单, 风险 R-02
- evidence: daemon-version.ts:10-15 注释（build-id.ts 由 build 注入）
- priority: P1

## D-004@v1 — backend 6 端点 JOIN 修复，不动 daemon 上报与前端

- type: design
- status: accepted
- source: Explore 调研根因 + 前端 C-002 现状
- question: daemon_version 恒 null 怎么修？要不要动 daemon 上报 / 前端？
- answer: daemon 已上报（hub-client.ts:337-338,365）、backend 已存储（service.py:194-195）、前端已用 machines 端点显示（C-002）。仅需修 backend GET /api/daemon/runtimes 等 6 个 runtime 端点（service list_runtimes 等 :415-422 漏 JOIN、router :946 等没 _runtime_read 填充）。daemon 上报与前端均不改。
- normalized_requirement: 所有 runtime 读端点契约一致返回 daemon_version/daemon_build_id。
- impacts: FR-01, design §5.B, 文件清单
- evidence: router.py:946,442-463; service.py:415-422,194-195; frontend runtimes page.test.tsx:242-243 (C-002)
- priority: P0
