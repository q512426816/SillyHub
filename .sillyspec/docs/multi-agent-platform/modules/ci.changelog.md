# ci 变更索引

> 自动生成。正文历史已迁出，详见 ci.md。
> author: qinyi
> created_at: 2026-09-21 11:30:00

- ql-20260921-006-2095 | frontend-ci 接入 vitest 覆盖率报告（先只看数不设门槛）：package.json 加 devDep @vitest/coverage-v8@2.1.9（精确匹配 vitest 2.1.9）+ test:coverage 脚本；vitest.config.ts 加 coverage 段（v8 provider、text+html 双报告、include src/**、排除测试自身/测试基建）；frontend-ci.yml Test 步改跑 pnpm test:coverage + upload-artifact 上传 coverage/（保留 7 天），timeout 15→20 分钟留插桩余量；frontend/.gitignore 补 coverage/。验证：client-path 子集 1 文件 2 用例带覆盖率全过、html 报告生成。
