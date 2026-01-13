/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class", // 啟用 class-based 深色模式
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/features/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "var(--font-noto-sans-tc)", "system-ui", "sans-serif"],
        inter: ["var(--font-inter)", "sans-serif"],
        "noto-tc": ["var(--font-noto-sans-tc)", "sans-serif"],
      },
      colors: {
        // 主要品牌色 (Twitch 紫色系)
        primary: {
          50: "#faf5ff",
          100: "#f3e8ff",
          200: "#e9d5ff",
          300: "#d8b4fe",
          400: "#c084fc",
          500: "#a855f7",
          600: "#9333ea",
          700: "#7c3aed",
          800: "#6b21a8",
          900: "#581c87",
        },
        // 深色模式背景
        dark: {
          bg: "#0e0e10",
          card: "#18181b",
          border: "#2d2d2d",
          hover: "#26262c",
        },
        // 淺色模式背景
        light: {
          bg: "#f7f7f8",
          card: "#ffffff",
          border: "#e5e7eb",
          hover: "#f3f4f6",
        },
      },
    },
  },
  plugins: [],
};

