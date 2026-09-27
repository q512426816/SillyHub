"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateLabel = StateLabel;
const jsx_runtime_1 = require("react/jsx-runtime");
const state_icon_1 = require("./state-icon");
/** 变体 → 配色 token（底色 / 文字与边框色，全部 CSS var，零硬编码）。 */
const VARIANT_STYLE = {
    open: {
        bg: "var(--color-brand-50)",
        fg: "var(--color-brand-600)",
        icon: "openCircle",
    },
    merged: {
        bg: "var(--color-brand-50)",
        fg: "var(--color-brand-600)",
        icon: "mergedCheck",
    },
    attention: {
        bg: "var(--semantic-warning-soft)",
        fg: "hsl(var(--warning))",
        icon: "zap",
    },
    done: {
        bg: "var(--semantic-success-soft)",
        fg: "hsl(var(--success))",
        icon: "check",
    },
    error: {
        bg: "var(--semantic-error-soft)",
        fg: "hsl(var(--error))",
        icon: "x",
    },
    neutral: {
        bg: "var(--semantic-neutral-soft)",
        fg: "hsl(var(--muted-foreground))",
        icon: "check",
    },
};
const SIZE_CLASS = {
    sm: "text-xs px-2 py-0.5 gap-1",
    md: "text-sm px-2.5 py-1 gap-1.5",
};
function StateLabel({ variant, children, withIcon = true, iconName, size = "sm", className, }) {
    const style = VARIANT_STYLE[variant];
    const icon = variant === "attention" && iconName ? iconName : style.icon;
    return ((0, jsx_runtime_1.jsxs)("span", { style: { backgroundColor: style.bg, color: style.fg, borderColor: style.fg }, className: `inline-flex items-center rounded-md border font-medium ${SIZE_CLASS[size]} ${className ?? ""}`, children: [withIcon ? (0, jsx_runtime_1.jsx)(state_icon_1.StateIcon, { name: icon, size: 12 }) : null, children] }));
}
