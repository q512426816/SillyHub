"use client";

import { Button, Checkbox, Form, Input } from "antd";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ApiError } from "@/lib/api";
import { login } from "@/lib/auth";

const REMEMBER_KEY = "sillyhub.login.remember";

interface LoginFormValues {
  email: string;
  password: string;
  remember?: boolean;
}

export default function LoginPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form] = Form.useForm<LoginFormValues>();

  // 读取"记住我"缓存,回填邮箱(及密码,与源项目一致)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(REMEMBER_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw) as Partial<LoginFormValues>;
      form.setFieldsValue({
        email: cached.email ?? "admin@sillyhub.local",
        password: cached.password ?? "admin123",
        remember: true,
      });
    } catch {
      // ignore broken cache
    }
  }, [form]);

  const onFinish = async (values: LoginFormValues) => {
    setError(null);
    setSubmitting(true);
    try {
      await login(values.email, values.password);

      // 记住我:存邮箱(密码与源项目行为一致一并缓存,仅本地浏览器)
      if (values.remember) {
        localStorage.setItem(
          REMEMBER_KEY,
          JSON.stringify({
            email: values.email,
            password: values.password,
            remember: true,
          }),
        );
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }

      router.replace("/workspaces");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-screen w-full overflow-hidden bg-[#0f1b4c] text-white">
      {/* 左侧:品牌区 + 渐变背景 + 欢迎语(复刻源 Login.vue __left) */}
      <section className="relative hidden flex-1 flex-col overflow-hidden lg:flex">
        {/* 蓝紫渐变背景,模拟源 login-bg.svg 视觉 */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-[#1a2a6c] via-[#2d4ea8] to-[#5b7ed8]"
        />
        {/* 装饰性柔光球 */}
        <div
          aria-hidden
          className="absolute -left-24 top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute bottom-[-6rem] right-[-4rem] h-80 w-80 rounded-full bg-[#84a9ff]/30 blur-3xl"
        />

        {/* 左上角 logo + 系统标题 */}
        <div className="relative z-10 flex items-center gap-3 p-8">
          <LogoMark />
          <span className="text-xl font-bold tracking-wide">SillyHub</span>
        </div>

        {/* 中部欢迎语 + 插画占位 */}
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center">
          <IllustrationPlaceholder />
          <h2 className="text-3xl font-semibold text-white">
            欢迎使用 SillyHub
          </h2>
          <p className="max-w-md text-sm font-normal leading-relaxed text-white/80">
            多智能体协作平台 · 知识沉淀 · 规格驱动开发
          </p>
        </div>
      </section>

      {/* 右侧:表单区(复刻源 __right + LoginForm 卡片) */}
      <section className="relative flex flex-1 items-center justify-center overflow-y-auto bg-white p-6 text-neutral-800 dark:bg-[var(--login-bg-color)] sm:p-10">
        <div className="w-full max-w-[420px]">
          {/* 移动端(无左侧)时显示 logo */}
          <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
            <LogoMark />
            <span className="text-xl font-bold text-neutral-900">SillyHub</span>
          </div>

          <div className="mb-6">
            <h1 className="text-2xl font-bold text-neutral-900">账号登录</h1>
            <p className="mt-1 text-sm text-neutral-500">
              使用管理员账号访问平台
            </p>
          </div>

          <Form<LoginFormValues>
            form={form}
            layout="vertical"
            initialValues={{
              email: "admin@sillyhub.local",
              password: "admin123",
              remember: true,
            }}
            onFinish={onFinish}
            requiredMark={false}
            size="large"
          >
            <Form.Item
              label="邮箱"
              name="email"
              rules={[
                { required: true, message: "请输入邮箱" },
                { type: "email", message: "邮箱格式不正确" },
              ]}
            >
              <Input
                placeholder="请输入邮箱"
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

            <Form.Item className="mb-3" name="remember" valuePropName="checked">
              <Checkbox>记住密码</Checkbox>
            </Form.Item>

            {error && (
              <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-600">
                {error}
              </div>
            )}

            <Form.Item className="mb-0">
              <Button
                type="primary"
                htmlType="submit"
                loading={submitting}
                block
              >
                {submitting ? "登录中…" : "登录"}
              </Button>
            </Form.Item>
          </Form>
        </div>
      </section>
    </main>
  );
}

/** 左上角 logo:圆角方块 + 字母 S,与项目品牌呼应 */
function LogoMark() {
  return (
    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 text-2xl font-bold text-white ring-1 ring-white/30 backdrop-blur">
      S
    </span>
  );
}

/** 中央插画占位:源项目是彩色 SVG 插画,这里用纯 CSS 几何图形近似,避免引入外部资源 */
function IllustrationPlaceholder() {
  return (
    <svg
      width={320}
      height={220}
      viewBox="0 0 320 220"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="SillyHub 多智能体协作"
    >
      <rect
        x="40"
        y="60"
        width="240"
        height="130"
        rx="14"
        fill="white"
        opacity="0.12"
      />
      <rect x="60" y="90" width="200" height="14" rx="7" fill="white" opacity="0.45" />
      <rect x="60" y="116" width="150" height="14" rx="7" fill="white" opacity="0.35" />
      <circle cx="90" cy="160" r="14" fill="#ffbd00" />
      <circle cx="130" cy="160" r="14" fill="#84a9ff" />
      <circle cx="170" cy="160" r="14" fill="#ff654f" />
      <circle cx="210" cy="160" r="14" fill="#5bd17f" />
      <rect
        x="120"
        y="20"
        width="80"
        height="44"
        rx="10"
        fill="white"
        opacity="0.22"
      />
      <path
        d="M160 64 L160 78 M150 78 L170 78"
        stroke="white"
        strokeOpacity="0.4"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
