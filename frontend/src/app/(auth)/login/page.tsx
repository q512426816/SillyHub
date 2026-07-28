"use client";

import { Button, Checkbox, Form, Input, Segmented } from "antd";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Bot, Workflow, BookOpenText, Sparkles } from "lucide-react";

import { ApiError } from "@/lib/api";
import { login } from "@/lib/auth";
import { ConfirmCaptcha } from "@/components/ui/confirm-captcha";

const REMEMBER_KEY = "sillyhub.login.remember";

interface LoginFormValues {
  account: string;
  password: string;
  remember?: boolean;
}

type LoginPlatform = "sillyhub" | "ppm";
const PLATFORM_KEY = "sillyhub.login.platform";
const PLATFORM_OPTIONS = [
  { label: "SillyHub 主平台", value: "sillyhub" as const },
  { label: "项目管理平台", value: "ppm" as const },
];
const PLATFORM_REDIRECT: Record<LoginPlatform, string> = {
  sillyhub: "/workspaces",
  ppm: "/ppm/workbench",
};

export default function LoginPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<LoginPlatform>("sillyhub");
  const [needCaptcha, setNeedCaptcha] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | undefined>(
    undefined,
  );
  const [form] = Form.useForm<LoginFormValues>();

  // 读取"记住我"缓存,回填账号(及密码)+ 平台选择
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
      // ignore broken cache
    }
  }, [form]);

  const doLogin = async (values: LoginFormValues, tokenOverride?: string) => {
    setError(null);
    setSubmitting(true);
    try {
      // token 优先用入参(handleVerified 直传,避免 setCaptchaToken 异步导致闭包读到旧值)。
      await login(values.account, values.password, tokenOverride ?? captchaToken);

      // 记住我:存账号(密码与源项目行为一致一并缓存,仅本地浏览器)
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

      // 按平台选择跳转(ppm→/ppm/workbench,sillyhub→/workspaces),并持久平台选择
      localStorage.setItem(PLATFORM_KEY, platform);
      router.replace(PLATFORM_REDIRECT[platform]);
    } catch (err) {
      // 登录失败次数达阈值 → 后端 423 need_captcha:清旧 token、弹人机确认,
      // 用户点按通过后 handleVerified 带 token 自动重试。
      if (
        err instanceof ApiError &&
        (err.code === "HTTP_423_LOGIN_CAPTCHA_REQUIRED" ||
          (err.details as { need_captcha?: boolean } | null)?.need_captcha ===
            true)
      ) {
        setCaptchaToken(undefined);
        setNeedCaptcha(true);
        return;
      }
      setError(err instanceof ApiError ? err.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  const onFinish = (values: LoginFormValues) => {
    void doLogin(values);
  };

  const handleVerified = async (token: string) => {
    const values = form.getFieldsValue(true) as LoginFormValues;
    setCaptchaToken(token);
    setNeedCaptcha(false);
    await doLogin(values, token);
  };

  return (
    <main className="relative flex min-h-screen w-full overflow-hidden bg-background text-foreground">
      {/* 左侧:品牌区(深蓝渐变 + 光斑 + 网格 + 特性条) */}
      <BrandPanel />

      {/* 右侧:表单区(亮色 + 玻璃拟态登录卡) */}
      <section className="relative flex flex-1 items-center justify-center overflow-y-auto px-6 py-10 sm:px-10">
        {/* 右侧极淡背景光晕,呼应品牌区 */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-blue-100/60 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-cyan-100/50 blur-3xl"
        />

        <div className="relative w-full max-w-[420px]">
          {/* 移动端(无左侧)时显示 LOGO */}
          <div className="mb-8 flex items-center justify-center lg:hidden">
            <span className="inline-flex items-center justify-center rounded-2xl bg-slate-900/90 p-2.5 shadow-lg">
              <LogoMark className="h-10" />
            </span>
          </div>

          {/* 玻璃拟态登录卡 */}
          <div className="rounded-2xl border border-white/60 bg-white/80 shadow-[0_8px_40px_-12px_rgba(37,99,235,0.18)] backdrop-blur-xl">
            <div className="p-6 sm:p-9">
              <div className="mb-7">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                  账号登录
                </h1>
                <p className="mt-1.5 text-sm text-slate-500">
                  使用登录名访问平台
                </p>
              </div>

              <Form<LoginFormValues>
                form={form}
                layout="vertical"
                initialValues={{
                  remember: true,
                }}
                onFinish={onFinish}
                requiredMark={false}
                size="large"
              >
                <Form.Item label="访问平台" className="mb-4">
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
                  <Input
                    placeholder="登录名"
                    autoComplete="username"
                    allowClear
                  />
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

                <Form.Item
                  className="mb-3"
                  name="remember"
                  valuePropName="checked"
                >
                  <Checkbox>记住密码</Checkbox>
                </Form.Item>

                {error && (
                  <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                    {error}
                  </div>
                )}

                {needCaptcha && (
                  <div className="mb-4">
                    <ConfirmCaptcha onVerified={handleVerified} />
                  </div>
                )}

                <Form.Item className="mb-0">
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={submitting}
                    block
                    className="!h-11 !text-[15px] !font-medium"
                  >
                    {submitting ? "登录中…" : "登录"}
                  </Button>
                </Form.Item>
              </Form>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-slate-400">
            多智能体协作平台 · 知识沉淀 · 规格驱动开发
          </p>
        </div>
      </section>
    </main>
  );
}

/** 左侧品牌区:深蓝渐变 + 径向光斑 + 细网格纹理 + lucide 特性条。 */
function BrandPanel() {
  return (
    <section className="relative hidden flex-1 flex-col overflow-hidden lg:flex">
      {/* 深蓝渐变底(primary #2563EB → 深 slate/blue) */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-blue-700 via-blue-800 to-slate-950"
      />
      {/* 细网格纹理 */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.13]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />
      {/* 径向光斑 */}
      <div
        aria-hidden
        className="absolute -left-28 top-20 h-80 w-80 rounded-full bg-cyan-400/25 blur-3xl"
      />
      <div
        aria-hidden
        className="absolute bottom-[-5rem] right-[-3rem] h-96 w-96 rounded-full bg-blue-500/30 blur-3xl"
      />
      <div
        aria-hidden
        className="absolute right-1/4 top-1/3 h-56 w-56 rounded-full bg-indigo-400/20 blur-3xl"
      />
      <div
        aria-hidden
        className="absolute bottom-[-4rem] left-1/4 h-72 w-72 rounded-full bg-cyan-500/15 blur-3xl"
      />

      {/* 左上角 LOGO */}
      <div className="relative z-10 flex items-center gap-3 p-9">
        <span className="inline-flex items-center justify-center rounded-xl bg-white/10 p-2 backdrop-blur-sm">
          <LogoMark className="h-12" />
        </span>
      </div>

      {/* 中部主视觉 */}
      <div className="relative z-10 flex flex-1 flex-col items-start justify-center gap-8 px-12 xl:px-16">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-medium text-blue-100 backdrop-blur-sm">
          <Sparkles className="h-3.5 w-3.5" />
          多智能体协作平台
        </div>
        <h2 className="max-w-md text-4xl font-bold leading-tight tracking-tight text-white">
          欢迎使用
          <br />
          SillyHub
        </h2>
        <p className="max-w-md text-sm leading-relaxed text-blue-100/80">
          多智能体协作平台 · 知识沉淀 · 规格驱动开发,让团队协作与知识资产在一处生长。
        </p>

        {/* 特性条(lucide 图标,替换原占位 SVG 插画) */}
        <div className="mt-2 flex flex-col gap-4">
          <FeatureItem
            icon={<Bot className="h-4 w-4" />}
            title="多智能体协作"
            desc="编排 Agent 团队,自动完成开发任务"
          />
          <FeatureItem
            icon={<Workflow className="h-4 w-4" />}
            title="规格驱动开发"
            desc="文档先行,变更可追踪、可验收"
          />
          <FeatureItem
            icon={<BookOpenText className="h-4 w-4" />}
            title="知识沉淀"
            desc="项目知识与决策过程持续积累"
          />
        </div>
      </div>
    </section>
  );
}

function FeatureItem({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-center gap-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-cyan-200 backdrop-blur-sm">
        {icon}
      </span>
      <div>
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="text-xs text-blue-100/70">{desc}</div>
      </div>
    </div>
  );
}

/** 品牌 LOGO:public/logo.png(紫色渐变方块 + SILLYHUB 文字,透明背景)。
 *  整张含文字,调用处不再重复渲染 "SillyHub" 文本。 */
function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/logo.png"
      alt="SillyHub"
      width={690}
      height={788}
      priority
      className={["h-14 w-auto select-none", className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
