/**
 * E2E 环境变量加载（task-02，设计依据 design.md §5.1）。
 *
 * 说明：frontend 未安装 dotenv 依赖（node -e "require.resolve('dotenv')" 验证失败），
 * 且本变更约束不允许改 package.json/pnpm-lock.yaml（task-07 并行处理中），
 * 故直接读取 process.env——由 playwright.config.ts 或运行前 shell 通过
 * `set -a; source frontend/e2e/.env.e2e; set +a` / cross-env 等方式注入。
 * 注意：Next.js 会在 next dev/build 运行时自动加载项目根 .env，但那是 next
 * 运行时行为；本文件跑在 Playwright 的 node 测试进程里，必须依赖外部注入。
 */

function required(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `缺少必需的环境变量 ${name}。${hint}。` +
        `修复方式：在 frontend/e2e/.env.e2e 中配置 ${name}，` +
        `并在启动 Playwright 前加载（例如 shell 中执行 ` +
        `set -a; source frontend/e2e/.env.e2e; set +a，或在 CI 中用 dotenv-cli 注入）。`,
    );
  }
  return value;
}

/** 前端（被测应用）地址，默认本机 dev server。 */
export const E2E_BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

/** 后端 API 地址，默认本机 FastAPI。 */
export const E2E_API_URL = process.env.E2E_API_URL || "http://localhost:8000";

/** 引导管理员邮箱（seed 账号，用于创建冒烟角色/用户）。 */
export const E2E_BOOTSTRAP_EMAIL = required(
  "E2E_BOOTSTRAP_EMAIL",
  "e2e 需要一个平台管理员账号来创建测试角色与用户",
);

/** 引导管理员密码。 */
export const E2E_BOOTSTRAP_PASSWORD = required(
  "E2E_BOOTSTRAP_PASSWORD",
  "e2e 需要一个平台管理员账号来创建测试角色与用户",
);
