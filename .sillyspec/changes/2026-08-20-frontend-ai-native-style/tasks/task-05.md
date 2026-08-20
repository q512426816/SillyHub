---
id: task-05
title: antd-providers.tsx 动态化——token/components 从 useThemeStore 当前主题取（含 antd-providers 自身 tokens→themes 迁移）+ useEffect 同步 html data-theme（覆盖：FR-03, D-101@v1）
title_zh: antd-providers.tsx 动态化——token/components 从 useThemeStore 当前主题取（含 antd-providers 自身 tokens→themes 迁移）+ useEffect 同步 html data-theme（覆盖：FR-03, D-101@v1）
author: qinyi
created_at: 2026-08-20 10:14:48
priority: P0
depends_on: [task-01, task-04]
blocks: [task-08, task-12, task-14]
requirement_ids: [FR-03]
decision_ids: [D-101@v1]
expects_from:
  task-01:
    - contract: ThemeDef
      needs: [name, label, color]
  task-04:
    - contract: useThemeStore
      needs: [theme, setTheme]
allowed_paths:
  - frontend/src/components/antd-providers.tsx
goal: >
  antd-providers.tsx 动态化：ConfigProvider 的 token/components 改从 useThemeStore 当前主题的
  themes[theme].color 取值（含本文件自身 tokens→themes 迁移），并用 useEffect 同步 html
  data-theme，使 antd 侧与 CSS 变量侧随同一状态源切换（D-101@v1）。
implementation:
  - tokens 导入替换为 themes（@/styles/themes），组件内经 useThemeStore 取 theme，派生 color=themes[theme].color 填 ConfigProvider（本文件即 tokens.ts 9 处消费方之一，其余 8 处归 task-08）
  - theme.token 颜色项改读 color：colorPrimary=color.primary、colorInfo=color.semantic.info、colorBgLayout=color.bg、colorBgContainer=color.card；borderRadius/fontFamily 等非颜色项保持共享取值
  - components 中 blue 阶引用改 color.brand 阶：Tabs.itemActiveColor=color.brand[600]、Menu.itemSelectedBg=color.brand[50]、Menu.itemSelectedColor=color.brand[600]（blue 主题下还原旧蓝观感）；Table 组件 token 的 slate 阶引用改读 color.slate（两套结构同构）
  - useEffect 依赖 [theme] 同步 document.documentElement.dataset.theme（CSS 双套变量的 React 驱动；首帧兜底归 task-06）
  - colorPrimaryHover 等 hover 档 token 保持 antd 自动派生不手写（themes.primaryHover 供 CSS/清扫侧用）；dayjs.locale、locale={zhCN}、controlHeight、wireframe 等非颜色配置零改动
acceptance:
  - 切换 store theme 后 ConfigProvider token 即时跟随（colorPrimary 紫/蓝互切）且 documentElement.dataset.theme 同步更新
  - Tabs/Menu 组件 token 走 brand 阶，blue 主题下取值与旧 tokens 版一致
  - token 定义无手写 hover 档派生色与散落 hex，文件不再 import @/styles/tokens（本文件迁移完成）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec eslint src/components/antd-providers.tsx
constraints:
  - 不删除 tokens.ts（其余 8 处消费方与删除动作归 task-08）
  - 不写单测（归 task-14）；不做 layout 防闪烁脚本（归 task-06）
  - 主题切换低频，theme 对象按渲染重建可接受，不引入 memo 复杂度（R-02 应对口径）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
