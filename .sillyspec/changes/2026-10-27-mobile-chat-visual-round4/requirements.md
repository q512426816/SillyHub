---
author: flow-machine-draft
created_at: 2026-10-27T03:24:31.025Z
---
# 需求规格（Requirements）— 2026-10-27-mobile-chat-visual-round4

## 功能需求

### FR-01: turn-segment-views 8 处 max-w-[calc(100%-120px)] 收敛为语义类 seg-width-cap,限宽改由 globals.css 单点定义(PC calc(100%-120px) 等价/mobile 100% 满宽),mobile 子代理卡/过程块/团队卡/警告行全满宽,desktop 限宽原样

- turn-segment-views 全部 13 处 max-w-[calc(100%-120px)] 必须收敛为语义类 seg-width-cap，限宽规则必须由 globals.css 单点定义（.seg-width-cap=calc(100% - 120px) 等价 desktop 原值；[data-variant="mobile"] .seg-width-cap=100% 满宽）；desktop 视觉等价零变化。

#### 场景：主路径

- Given mobile 会话页任一过程块（子代理卡/工具行/思考行/警告行/团队卡/正文）
- Then 块宽占满滚动容器；desktop 保持整行-120px 阅读限宽

### FR-02: all(进度)视图轮尾统一用 RoundDivider(与对话视图同款同构,含 meta/detail/mobile 透传),TurnStatusBadge 形态与函数退役,自动续跑徽标保留在统一行内

- all（进度）视图轮尾必须统一渲染 RoundDivider（与对话视图同款同构：label/status/meta/detail/mobile 透传一致），TurnStatusBadge 消费与函数定义必须退役；自动续跑徽标必须保留在统一行内。

#### 场景：主路径

- Given all 视图轮尾
- Then 渲染与对话视图同款 RoundDivider（meta 含 ↑↓ token 与速度），无第二形态

### FR-03: 相关测试面全绿(token-speed all 视图用例按统一后契约更新)

- 改动后四套件必须全绿（turn-segment-views 限宽断言锚更新/token-speed/auto-resume-badge/session-panel-variant）。

#### 场景：主路径

- Given 全部改动落地
- Then 125 用例全绿 + tsc 0

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「过程信息块限宽统一」全套（断言锚 seg-width-cap，desktop 等价由 globals.css calc 同值保证）
FR-02: frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx（all 视图 4 用例统一后原断言全过——meta 内容同源）+ turn-timeline-auto-resume-badge.test.tsx（徽标保留断言）
FR-03: 四套件实测 125 用例全绿 + tsc 0
