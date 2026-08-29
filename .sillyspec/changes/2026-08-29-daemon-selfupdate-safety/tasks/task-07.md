---
id: task-07
title: '前端 DaemonMachineRead 补字段 + MachineCard 三状态横幅与按钮禁用（depends_on: task-06）'
title_zh: '前端 DaemonMachineRead 补字段 + MachineCard 三状态横幅与按钮禁用（depends_on: task-06）'
author: 'qinyi'
created_at: 2026-08-29 15:04:03
priority: P1
depends_on: [task-06]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-003@v2, D-004@v1]
expects_from:
  task-06:
    - contract: MachinePendingUpdateView
      needs: [pending_update]
allowed_paths:
  - frontend/src/lib/daemon.ts
  - frontend/src/components/daemon/machine-card.tsx
  - frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx
goal: >
  前端机器卡按 pending_update 渲染三状态横幅（server_command=warning 等待空闲
  自动升级 / disk_change=info 程序文件已变更等待加载 / 无 pending 不渲染），
  pending 期禁用「升级 daemon」按钮，让推迟升级对运维可见（design S5 / FR-05）。
implementation:
  - lib/daemon.ts DaemonMachineRead（手写接口约 87 行，非 api-types 透出）增可选字段 pending_update（reason/current_version/target_version/since 四字段，null 表无）及配套子类型
  - machine-card.tsx（332 行）三状态同一横幅位对照原型——server_command 渲染 warning 横幅「等待空闲后自动升级（每 30s 复查）」+副行（原因+版本对比）；disk_change 渲染 info 横幅「检测到程序文件已变更，等待空闲自动加载新版本」+副行（来源——磁盘旁路探测每 10 分钟，覆盖外部部署工具替换/降级）；null/undefined 不渲染
  - 升级按钮（234-246 行既有 disabled/isOffline/upgrading 逻辑）扩展——pending 期 disabled 且 title 说明等待原因，非 pending 回到既有判定
  - 新增 __tests__/machine-card-pending.test.tsx——两种 reason 横幅文案与色阶、pending 期按钮禁用+title、null/undefined 无横幅
acceptance:
  - server_command 出 warning 横幅（主文案含「等待空闲后自动升级（每 30s 复查）」+版本对比副行）；disk_change 出 info 横幅（主文案含「检测到程序文件已变更」+来源副行）——色阶对照原型
  - pending 期「升级 daemon」按钮 disabled 且 title 说明；pending_update 为 null 或缺省时无横幅、按钮可用性回到既有 offline/upgrading 逻辑
  - 刷新走 useDaemonMachines 既有 15s 轮询自然更新，无新增通道；升级完成后横幅自然消失（接受 30-60s 残留窗口）
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/machine-card-pending.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 仅消费 task-06 透出的机器级 pending_update；旧后端无该字段按缺省处理（不渲染横幅不改轮询）
  - DaemonMachineRead 维持手写接口（Grill M13）；api-types.ts 重生成归 task-08 本卡不动
  - 横幅色阶用主题语义 token（warning/info）双主题可换肤，文案对照原型三状态；不改 useDaemonMachines 轮询机制
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
