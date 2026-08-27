import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import LoginPage, { buildMobileEntryUrl } from "@/app/(auth)/login/page";

// ── next/navigation mock（登录页 useRouter.replace，本测试不触发跳转） ──────────
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

describe("登录页移动端二维码", () => {
  it("buildMobileEntryUrl：站内 /login（手机扫码后由 middleware 按 UA 分流到 /m/login）", () => {
    expect(buildMobileEntryUrl("http://192.168.1.5:3000")).toBe(
      "http://192.168.1.5:3000/login",
    );
    expect(buildMobileEntryUrl("https://sillyhub.example.com")).toBe(
      "https://sillyhub.example.com/login",
    );
  });

  it("挂载后渲染二维码卡：QR svg + 标题 + 编码 URL 展示", async () => {
    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByLabelText("移动端入口二维码")).toBeInTheDocument();
    });
    // react-qr-code 渲染为 svg；SSR 阶段为占位，挂载取到 origin 后才出二维码
    const card = screen.getByLabelText("移动端入口二维码");
    expect(card.querySelector("svg")).not.toBeNull();

    expect(screen.getByText("手机访问移动端")).toBeInTheDocument();

    const urlLine = screen.getByTestId("mobile-qr-url");
    expect(urlLine.textContent).toContain("/login");
    // 编码的是当前 jsdom 站点（http://localhost:3000），扫码语义 = 访问本站登录页
    expect(urlLine.textContent).toBe(buildMobileEntryUrl(window.location.origin));
  });
});
