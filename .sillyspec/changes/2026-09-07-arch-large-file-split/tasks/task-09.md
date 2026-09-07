---
id: task-09
title: 'Wave2 拆分 group/service.py → group/service/ 10 文件包'
title_zh: 'Wave2 拆分 group/service.py → group/service/ 10 文件包'
author: 'qinyi'
created_at: 2026-09-07 08:48:02
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-02, FR-04]
decision_ids: [D-004@v1, D-005@v3, D-007@v1]
allowed_paths:
  - backend/app/modules/daemon/group/service.py
  - backend/app/modules/daemon/group/service/__init__.py
  - backend/app/modules/daemon/group/service/mentions.py
  - backend/app/modules/daemon/group/service/typing_presence.py
  - backend/app/modules/daemon/group/service/timeline_reads.py
  - backend/app/modules/daemon/group/service/settings.py
  - backend/app/modules/daemon/group/service/shadow.py
  - backend/app/modules/daemon/group/service/members.py
  - backend/app/modules/daemon/group/service/messages.py
  - backend/app/modules/daemon/group/service/crud.py
  - backend/app/modules/daemon/group/service/helpers.py
goal: >
  把 4844 行的 group/service.py（GroupChatService 约 2800 行 + 35 个模块级 helper）拆为
  group/service/ 10 文件包，GroupChatService 类壳一行委托，33 处 group.service patch
  目标零失效，既有测试零修改通过。
implementation:
  - 模块级 35 个 helper 按簇先落五个纯搬移模块——mentions.py（mention 解析/广播探测）、typing_presence.py（typing/presence Redis 层 + 5 个 publish helper 收敛点）、timeline_reads.py（读模型三连 + DTO）、settings.py（guardrail 校验/合并三件套）、helpers.py（锁查询/通知）
  - shadow.py（触发/影子会话簇）、members.py（成员管理簇）、messages.py（消息发送簇）、crud.py（群 CRUD 簇）方法体依次下沉
  - GroupChatService 类壳在 __init__.py 保留同名方法一行委托，公共签名不变；聚合导出 ⊇ task-06 清单的 group.service 被引用符号集
  - 33 处 patch("app.modules.daemon.group.service.<sym>") 白名单符号（含该命名空间里的 SessionService 引用，以 task-06 白名单为准）在子模块经 import app.modules.daemon.group.service 原模块命名空间延迟解析
  - 轻重构 event_publish/attachment_pipeline 不在本卡范围——publish helper 与附件实现先原样搬移，收敛留给 task-11
acceptance:
  - from app.modules.daemon.group.service import GroupChatService 等既有导入原样工作
  - 33 处 group.service patch 目标零失效，test_group_* 等既有测试文件内容零修改通过
  - GroupChatService 公共方法签名逐一不变，方法体只做搬移 + this 状态显式传参
  - 10 个子模块全部 ≤800 行（D-005@v3）
  - 目标文件 group/service.py 删除后被同名包替代，导入路径零变化
verify:
  - cd backend && uv run ruff check app/modules/daemon/group
  - cd backend && uv run pytest app/modules/daemon/tests -q -k "group" --no-cov -n auto
constraints:
  - 不改方法行为/异常文案/日志格式——方法体下沉只做搬移 + this 状态显式传参
  - patch 目标零失效（按 task-06 白名单）——被白名单符号禁止 from 原点 import 后调用，一律经原模块命名空间延迟解析
  - 既有测试零修改——需改测试才能通过即判定兼容层设计失败，回炉而非改测试
  - 不碰在途 4 个 backend 文件（protocol.py / runtime/service.py / ws_hub.py / lease/context.py），git diff 为空
  - 每搬一簇跑定向测试全绿再搬下一簇，不为行数目标顺手改逻辑
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
