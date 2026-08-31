---
id: task-07
title: '前端机器卡 UI——徽标三形态（semver 本地比较）+「升级 sillyspec」按钮 5 态 + sillyspec_update 横幅四态 + page handler 传参 + 组件测试（depends_on: task-06）'
title_zh: '前端机器卡 UI——徽标三形态（semver 本地比较）+「升级 sillyspec」按钮 5 态 + sillyspec_update 横幅四态 + page handler 传参 + 组件测试（depends_on: task-06）'
author: 'qinyi'
created_at: 2026-08-31 08:31:16
priority: P0
depends_on: [task-06]
blocks: [task-08]
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/daemon/machine-card.tsx
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - frontend/src/components/daemon/__tests__/machine-card-sillyspec.test.tsx
goal: >
  机器卡 sillyspec UI 三件：meta 行版本徽标三形态（最新常色/落后橙色当前→最新+有新版本/未安装红色）、
  「升级 sillyspec」按钮 5 态（正常/落后高亮/升级中禁用/等待空闲禁用/失败变重试、未安装变安装）、
  sillyspec_update 状态横幅四态（running/deferred/success/failed），对照原型 8 场景 1:1 实现。
implementation:
  - machine-card.tsx meta 行 daemon 版本（:205-210）后加 sillyspec 徽标：本地 semver 比较函数（split 数字段比较，3 行内，不引第三方库；latest 未知时不比较按常色）；落后时 warning 色阶 + 「有新版本」小标签（主题语义 token，勿硬编码色值）
  - 按钮组（:245-268 旁）加「升级 sillyspec」（btnOutlineTiny 同款；disabled=isOffline||state==='running'||state==='deferred'，title 说明原因；落后时橙色高亮样式；sillyspec_version 为 null 文案「安装 sillyspec」；state==='failed' 文案「重试升级」）
  - pending_update 横幅槽（:314-356）之后加 sillyspec_update 横幅四态：running=info 旋转图标「正在升级（from→to）」/deferred=warning「机器忙等待空闲（每 30s 复查）」/success=success「已升级到 to」/failed=destructive「升级失败：error」；**用独立 data 属性 data-machine-sillyspec-banner（不复用 data-machine-pending-banner 定位器）**
  - page.tsx 加 handleSillySpecUpgrade（modal.confirm 确认 → triggerMachineSillySpecUpdate → 成功/失败 message + invalidate machines query），MachineCard 传 onUpgradeSillySpec（+本地 upgrading 态使按钮即时禁用，15s 轮询自然接管）
  - 新建 __tests__/machine-card-sillyspec.test.tsx（仿 machine-card-pending.test.tsx）：徽标三形态、按钮禁用态与文案切换、横幅四态渲染（按 state）、不渲染条件（sillyspec_update null）
acceptance:
  - 组件测试全绿；视觉对照 prototype-machine-sillyspec.html 场景①-⑧逐场景一致（双主题）
  - 色阶全部走主题语义 token（warning/info/success/destructive），双主题换肤正确
  - 既有 machine-card.test.tsx / machine-card-pending.test.tsx 零回归
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/machine-card-sillyspec.test.tsx src/components/daemon/__tests__/machine-card.test.tsx src/components/daemon/__tests__/machine-card-pending.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不动 daemon 版本徽标与「升级 daemon」按钮既有行为；横幅槽独立不覆盖 pending_update 横幅
  - 状态刷新只走 useDaemonMachines 15s 轮询 + 本地按钮态，不加新轮询/WS 通道
  - 类型只用 api-types 再生产物（task-06）；文案中文
expects_from:
  - task-06: FrontendSillySpecApi（triggerMachineSillySpecUpdate + DaemonMachineRead sillyspec 字段类型）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
