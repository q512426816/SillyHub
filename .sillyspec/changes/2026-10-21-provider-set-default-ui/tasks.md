---
author: flow-machine-draft
created_at: 2026-10-21T03:16:10.861Z
---
# 任务注册表（Tasks）— 2026-10-21-provider-set-default-ui

- [x] task-01: 后端收敛热切换——service.set_default/unset_default 删 _dispatch_provider_switch 调用与私有 helper（affected_sessions 恒 0）；router set/unset-default docstring 更新；provider_switch.py docstring 标注无生产调用方——验证：pytest llm_provider 相关测试绿
- [x] task-02: 后端测试收紧——test_llm_provider.py / test_router.py 断言 set/unset 后 affected_sessions=0 且 notify_provider_switch 未被调用——验证：新增断言用例先红后绿
- [x] task-03: 前端 API 封装加回——lib/api/llm-providers.ts 增 SetDefaultResult/setDefaultProvider/unsetDefaultProvider——验证：api 单测（URL/method/返回解析）绿
- [x] task-04: 列表 UI——llm-provider-list.tsx 设为默认/取消默认按钮、is_default 默认徽标、handlers（switched 分支 toast「已设为默认，新会话生效」/error 不刷新）、说明文案与顶部注释更新——验证：组件测试绿 + tsc 零错
- [x] task-05: 前端测试——翻转既有「无启动/停止按钮」回归断言为设为默认断言，补齐设默认成功/取消默认/探测失败 toast/默认行渲染用例——验证：llm-provider-list.test.tsx 与 llm-providers.test.ts 全绿
