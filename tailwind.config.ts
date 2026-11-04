import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#f4efe6",
        "paper-2": "#e7dfd0",
        "paper-3": "#fbf8f2",
        ink: "#17211d",
        "ink-soft": "#3d4a44",
        pine: "#1b3f32",
        "pine-2": "#245443",
        moss: "#3d6b52",
        brass: "#8a5e34",
        "brass-2": "#c4a574",
        brick: "#8d3b32",
        line: "#ddd3c2",
        good: "#1d6b45",
        warn: "#8a5a12",
      },
      fontFamily: {
        serif: ["Fraunces", "Iowan Old Style", "Palatino Linotype", "Palatino", "serif"],
        sans: ["Outfit", "Avenir Next", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        sheet: "0 18px 50px -28px rgba(23, 33, 29, 0.45)",
        stamp: "inset 0 0 0 2px currentColor",
      },
    },
  },
  plugins: [],
};

export default config;
