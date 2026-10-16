import type { Config } from "tailwindcss";

/**
 * Design tokens. One primary colour (a calm ink navy) used for actions,
 * links and focus; everything else is neutral. IBM Plex Sans for the
 * interface, IBM Plex Serif for page titles, IBM Plex Mono for codes.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f3f6fb", 100: "#e4ebf5", 200: "#c9d6ea", 300: "#a0b5d8",
          400: "#6f8cc0", 500: "#4a6aa8", 600: "#2f4f8f", 700: "#263f73",
          800: "#1f335c", 900: "#1a2a4a"
        },
        canvas: "#f6f7f9"
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "ui-serif", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"]
      },
      boxShadow: {
        // Quiet elevation for overlays only; cards sit flat on hairline borders.
        pop: "0 1px 2px rgb(15 23 42 / 0.06), 0 8px 24px -6px rgb(15 23 42 / 0.16)"
      }
    }
  },
  plugins: []
};
export default config;
