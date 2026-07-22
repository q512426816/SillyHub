"use client";

import { Button, Checkbox, Form, Input, Segmented } from "antd";
import { Suspense, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";

import { ApiError } from "@/lib/api";
import { login } from "@/lib/auth";

/**
 * task-06 · 移动登录页（design §5.3 / FR-03 / D-003 / R-04）。
 *
 * 认证 100% 复用桌面同源（**不另建认证**，FR-03 / D-003）：
 *  - login(@/lib/auth) 内部 useSession.getState().setTokens() + fetchMe()
 *    → useSession.getState().setUser()，token / user 写入与桌面**完全同一个 store**，
 *    登录态与桌面互通。本页不直接订阅 useSession（login 已写回 store，守卫随之放行），
 *    故不引未用导入。
 *  - 记住密码 / 平台选择复用桌面**同一组 localStorage key**（REMEMBER_KEY / PLATFORM_KEY），
 *    两端回填一致。
 *  - 错误展示复用 ApiError。
 *
 * 桌面 (auth)/login/page.tsx 完全不动（FR-08 零回归）；本文件是 /m/login 独立实现。
 * /m/login 被 app/m/layout.tsx 判为公开页（不裹 MobileAppShell、不要求 token），
 * 故本页自带全屏单列容器（移动 App 风格，去掉桌面左右分栏）。
 *
 * 登录后回目标：redirect / next 查询参数优先，否则按平台默认页（ppm→/ppm/workbench、
 * sillyhub→/workspaces）。目标是桌面路径形态，手机访问时 middleware 会自动 rewrite 到
 * /m/ 版，地址栏 URL 不变（design §5.1 / D-002@v2）。
 */

/** 与桌面 (auth)/login 同一个 key：记住密码（账号+密码）缓存。 */
const REMEMBER_KEY = "sillyhub.login.remember";

interface LoginFormValues {
  account: string;
  password: string;
  remember?: boolean;
}

type LoginPlatform = "sillyhub" | "ppm";

/** 与桌面 (auth)/login 同一个 key：上次选择的平台。 */
const PLATFORM_KEY = "sillyhub.login.platform";

const PLATFORM_OPTIONS = [
  { label: "SillyHub 主平台", value: "sillyhub" as const },
  { label: "项目管理平台", value: "ppm" as const },
];

/** 无显式 redirect 参数时的默认落地页（桌面形态，middleware 自动 rewrite 到 /m/）。 */
const PLATFORM_REDIRECT: Record<LoginPlatform, string> = {
  sillyhub: "/workspaces",
  ppm: "/ppm/workbench",
};

/**
 * 把 redirect / next 查询参数收敛成安全的站内目标。
 *
 * 仅接受以单个 "/" 开头的站内绝对路径；显式排除 "//"（协议相对，浏览器会跳外站）与
 * "/\"（Windows 路径 / 误用），防止开放重定向。非法 / 缺失返回 null，由调用方回落到
 * 平台默认页。
 */
function safeRedirectTarget(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (raw[0] !== "/") return null;
  if (raw[1] === "/" || raw[1] === "\\") return null;
  return raw;
}

/**
 * 移动登录页（默认导出，契约 MobileLoginPage）。
 *
 * useSearchParams 包一层 Suspense：兜底构建期静态预渲染（pages 目录 / force-static 场景）
 * 对 useSearchParams 的 Suspense 边界要求；/m/ 客户端布局下本页为动态渲染，Suspense 日常无开销。
 */
export default function MobileLoginPage() {
  return (
    <Suspense fallback={null}>
      <MobileLoginPageInner />
    </Suspense>
  );
}

function MobileLoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<LoginPlatform>("sillyhub");
  const [form] = Form.useForm<LoginFormValues>();

  // redirect 优先于 next；URL 固定，渲染期计算一次。非法值回落 null（交给平台默认页）。
  const presetRedirect = safeRedirectTarget(
    searchParams.get("redirect") ?? searchParams.get("next"),
  );

  // 回填"记住我"缓存 + 平台选择，逻辑与桌面 (auth)/login 完全一致（同一 key → 回填一致）。
  useEffect(() => {
    try {
      const raw = localStorage.getItem(REMEMBER_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as Partial<LoginFormValues>;
        form.setFieldsValue({
          account: cached.account ?? "admin",
          password: cached.password ?? "admin123",
          remember: true,
        });
      }
      const savedPlatform = localStorage.getItem(PLATFORM_KEY);
      if (savedPlatform === "sillyhub" || savedPlatform === "ppm") {
        setPlatform(savedPlatform);
      }
    } catch {
      // 缓存损坏则忽略，不影响登录。
    }
  }, [form]);

  const onFinish = async (values: LoginFormValues) => {
    setError(null);
    setSubmitting(true);
    try {
      // 复用桌面同源 login：token / user 写入同一 useSession store，与桌面互通。
      await login(values.account, values.password);

      // 记住我：与源项目行为一致一并缓存账号+密码（仅本地浏览器）。
      if (values.remember) {
        localStorage.setItem(
          REMEMBER_KEY,
          JSON.stringify({
            account: values.account,
            password: values.password,
            remember: true,
          }),
        );
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }

      // 持久化平台选择（与桌面同一 key，下次进站回填一致）。
      localStorage.setItem(PLATFORM_KEY, platform);

      // 回目标：redirect/next 优先，否则按平台默认页。目标为桌面路径形态，手机访问时
      // middleware 自动 rewrite 到 /m/ 版，地址栏 URL 不变（design §5.1 / D-002@v2）。
      router.replace(presetRedirect ?? PLATFORM_REDIRECT[platform]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col bg-background px-6 py-10 text-foreground">
      {/* Logo：复用 public/logo.png（与桌面同源资源） */}
      <div className="mb-8 flex justify-center">
        <LogoMark />
      </div>

      {/* 标题区 */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">账号登录</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          使用登录名访问平台
        </p>
      </div>

      <Form<LoginFormValues>
        form={form}
        layout="vertical"
        initialValues={{ remember: true }}
        onFinish={onFinish}
        requiredMark={false}
        size="large"
        // 触摸目标 ≥44px（R-04）：antd large 输入框默认 40px，统一抬高到 44px。
        className="[&_.ant-input]:min-h-[44px] [&_.ant-input-affix-wrapper]:min-h-[44px]"
      >
        <Form.Item label="访问平台" className="mb-5">
          <Segmented
            value={platform}
            onChange={(v) => setPlatform(v as LoginPlatform)}
            options={PLATFORM_OPTIONS}
            block
          />
        </Form.Item>

        <Form.Item
          label="登录名"
          name="account"
          rules={[{ required: true, message: "请输入登录名" }]}
        >
          <Input placeholder="登录名" autoComplete="username" allowClear />
        </Form.Item>

        <Form.Item
          label="密码"
          name="password"
          rules={[{ required: true, message: "请输入密码" }]}
        >
          <Input.Password
            placeholder="请输入密码"
            autoComplete="current-password"
          />
        </Form.Item>

        <Form.Item className="mb-3" name="remember" valuePropName="checked">
          {/* 触摸目标 ≥44px（R-04）：抬高整行可点区域。 */}
          <Checkbox className="!min-h-[44px] !items-center">记住密码</Checkbox>
        </Form.Item>

        {error && (
          <div className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[14px] text-red-600">
            {error}
          </div>
        )}

        <Form.Item className="mb-0">
          <Button
            type="primary"
            htmlType="submit"
            loading={submitting}
            block
            // 触摸目标 ≥44px（R-04）。
            className="!h-11 text-[15px]"
          >
            {submitting ? "登录中…" : "登录"}
          </Button>
        </Form.Item>
      </Form>
    </main>
  );
}

/** 品牌 LOGO：public/logo.png（复用桌面同源资源，不引外部图）。整张含文字，不再重复渲染文本。 */
function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/logo.png"
      alt="SillyHub"
      width={690}
      height={788}
      priority
      className={["h-12 w-auto select-none", className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
