import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0c0e14",
        ink: "#e8eaef",
        call: "#ef5350",
        put: "#26a69a",
        breakeven: "#a78bfa",
        gold: "#f0c068",
      },
      fontFamily: {
        mono: ["ui-monospace", "SF Mono", "Menlo", "monospace"],
        sans: ["system-ui", "-apple-system", "sans-serif"],
      },
      backdropBlur: {
        glass: "28px",
      },
    },
  },
  plugins: [],
};

export default config;
