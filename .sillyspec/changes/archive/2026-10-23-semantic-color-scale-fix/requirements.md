---
author: flow-machine-draft
created_at: 2026-10-22T23:40:11.769Z
---
# 需求规格（Requirements）— 2026-10-23-semantic-color-scale-fix

## 功能需求

### FR-01: tailwind.config.ts 为 warning/info/destructive 补齐数字阶 50/200/500/700，基于既有语义 CSS 变量用 color-mix 派生（主题感知、无硬编码 hex，三套主题块零新增变量）

- `tailwind.config.ts` 的 `theme.extend.colors` 中，`warning`/`info`/`destructive` 必须各补齐数字键 50、200、500、700：500 为 `hsl(var(--<palette>))` 基色，50/200 以 `color-mix(in srgb, hsl(var(--<palette>)) N%, hsl(var(--background)))` 向背景色混出（浅色为软底、深色为暗底），700 以 `color-mix(..., hsl(var(--foreground)))` 向前景色混出（浅色加深、深色提亮）。
- 禁止硬编码 hex；禁止改动 globals.css 的三套主题变量块；DEFAULT/foreground 与既有 brand/slate/blue 等配置必须逐字节不变（`bg-warning`/`text-warning` 等 DEFAULT 类解析结果与改前一致）。

#### 场景：类名按设计生成

- Given 组件使用 `bg-warning-500` / `border-warning-200` / `bg-warning-50` / `text-warning-700`（info/destructive 同构）
- When 以项目 tailwind.config.ts 编译 CSS
- Then 四个数字阶类各自生成有效声明（500 为 hsl 基色、其余为 color-mix 派生），不再静默缺失

#### 场景：双主题感知

- Given 同一类 `text-warning-700` 在浅色与深色主题下渲染
- When 切换 `data-theme`
- Then 颜色随 `--warning`/`--foreground` 变量变化（不写死单主题色值）

#### 场景：DEFAULT 零漂移

- Given 既有使用 `bg-warning`/`text-warning`/`bg-destructive` 的组件
- When 编译并渲染
- Then 声明值与改前一致（DEFAULT 仍为 `hsl(var(--...))`）

### FR-02: 调用点零改动（liveness-badge 五态 + session-list-panel 两处 bg-warning-500 原样生效）

- 本变更禁止修改 liveness-badge.tsx 与 session-list-panel.tsx 的类名：`LIVENESS_META` 五态 badgeCls/dotCls 与左栏两处「在等你」琥珀点，在配置补齐后必须原样渲染出设计中的软底描边徽章与实心琥珀点。

#### 场景：左栏琥珀点可见

- Given 会话 `current_run_status='pending_approval'`（或活性 blocked）
- When 渲染左栏状态槽
- Then 圆点呈现 warning 实心色（`bg-warning-500` 生成 CSS），不再透明

#### 场景：活性徽章恢复软底

- Given agent-log 页渲染五态徽章
- When working/idle/blocked 态显示
- Then 徽章呈现对应语义色的浅底+描边+深字（info/warning/destructive 数字阶生效）

### FR-03: 用真实 tailwind 构建验证 bg-warning-500 / border-warning-200 等类确实生成 CSS（非仅配置在场）

- 必须以项目实际 `tailwind.config.ts` 运行真实 tailwind 编译（内容探针包含 `bg-warning-500`/`border-warning-200`/`bg-warning-50`/`text-warning-700` 及 info/destructive 代表类），产物中必须命中这些类名；验证命令与 grep 结果必须记录于变更目录 visual-evidence.md。

#### 场景：构建产物命中

- Given 配置已补齐、探针内容引用代表类名
- When 执行 tailwind 构建
- Then 输出 CSS 含 `.bg-warning-500{background-color:hsl(var(--warning))}` 等规则（info/destructive 同理），grep 零缺失

### FR-04: 新增配置断言测试防复发；触及面既有测试全绿

- 必须新增配置断言单测，钉住三个调色板 × 四个数字键的存在与派生形态（500 基色 / 其余 color-mix）及 DEFAULT/foreground 零漂移，防止未来再次出现「类名写了但配置没定义」的静默失效；触及面（sessions 组件、agent-log 组件）既有测试与 `tsc --noEmit` 必须全绿。

#### 场景：配置缺键即红

- Given 有人删掉 warning["500"]
- When 运行配置断言测试
- Then 用例失败并指名缺失键

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/lib/__tests__/tailwind-semantic-colors.test.ts「三调色板 × 50/200/500/700 存在且派生形态正确 + DEFAULT/foreground/既有色阶零漂移」
FR-02: 不适用：纯样式配置生效面（调用点零 diff），以真实构建验证承载——见 FR-03 的 visual-evidence.md
FR-03: 不适用：本条即真实构建验证记录本身（tailwind CLI 编译 + 类名 grep，结论落 visual-evidence.md），无单测面
FR-04: frontend/src/lib/__tests__/tailwind-semantic-colors.test.ts「配置断言防复发」+ sessions/agent-log 组件既有测试回归
