import type { Config } from "tailwindcss";

/**
 * Design tokens. One primary colour (a calm ink navy) used for actions,
 * links and focus; everything else is neutral. IBM Plex Sans for the
 * interface, IBM Plex Serif for page titles, IBM Plex Mono for codes.
 *
 * The live-lessons module (src/live, from SwiftCipher) also uses: "ink"
 * neutrals (mapped onto the same slate greys), a lime "accent" and the
 * answer "tile" colours for game screens, and its game animations.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f3f6fb", 100: "#e4ebf5", 200: "#c9d6ea", 300: "#a0b5d8",
          400: "#6f8cc0", 500: "#4a6aa8", 600: "#2f4f8f", 700: "#263f73",
          800: "#1f335c", 900: "#1a2a4a", 950: "#111c33"
        },
        canvas: "#f6f7f9",
        // Live module neutrals = the app's slate greys, so staff screens look the same everywhere.
        ink: {
          50: "#f8fafc", 100: "#f1f5f9", 200: "#e2e8f0", 300: "#cbd5e1", 400: "#94a3b8",
          500: "#64748b", 600: "#475569", 700: "#334155", 800: "#1e293b", 900: "#0f172a", 950: "#020617"
        },
        // Game highlights only (lime), with readable text on it.
        accent: {
          50: "#f8fde6", 100: "#f0fbc8", 200: "#e4f79b", 300: "#d6f366", 400: "#d4f55a", 500: "#c8f03c",
          600: "#b3dc24", 700: "#89aa17", 800: "#5f7610", 900: "#3f4f0b", ink: "#151411"
        },
        // Answer tiles in games: bolt, star, hexagon, moon, heart, cloud.
        tile: { bolt: "#2B4ADB", star: "#C6EE3A", hex: "#B0179A", moon: "#0E7A6E", heart: "#C2410C", cloud: "#6D28D9" }
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "ui-serif", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
        // Live module headings use the interface face, bold.
        display: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      letterSpacing: { tightest: "-0.035em" },
      boxShadow: {
        // Quiet elevation for overlays only; cards sit flat on hairline borders.
        pop: "0 1px 2px rgb(15 23 42 / 0.06), 0 8px 24px -6px rgb(15 23 42 / 0.16)",
        overlay: "0 1px 2px rgb(15 23 42 / 0.06), 0 12px 32px -8px rgb(15 23 42 / 0.18)",
        lift: "0 1px 0 rgb(15 23 42 / 0.04), 0 1px 3px rgb(15 23 42 / 0.06)"
      },
      // Game moments (switched off by prefers-reduced-motion in globals.css).
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
        "sheet-up": { from: { transform: "translateY(16px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        pulse2: { "0%,100%": { opacity: "1" }, "50%": { opacity: ".45" } },
        pop: { "0%": { transform: "scale(.6)", opacity: "0" }, "60%": { transform: "scale(1.06)", opacity: "1" }, "100%": { transform: "scale(1)" } },
        rise: { from: { transform: "translateY(100%)" }, to: { transform: "none" } },
        shake: { "0%,100%": { transform: "none" }, "20%,60%": { transform: "translateX(-6px)" }, "40%,80%": { transform: "translateX(6px)" } },
        float: { "0%,100%": { transform: "translateY(0) rotate(var(--r,0deg))" }, "50%": { transform: "translateY(-14px) rotate(calc(var(--r,0deg) + 8deg))" } },
        burst: { "0%": { transform: "translate(0,0) scale(.4) rotate(0)", opacity: "0" }, "12%": { opacity: "1" }, "100%": { transform: "translate(var(--dx),var(--dy)) scale(1) rotate(var(--spin))", opacity: "0" } },
        flicker: { "0%,100%": { transform: "scale(1) rotate(-4deg)" }, "50%": { transform: "scale(1.15) rotate(4deg)" } }
      },
      animation: {
        "fade-in": "fade-in .18s ease-out",
        "sheet-up": "sheet-up .22s cubic-bezier(.2,.8,.2,1)",
        pulse2: "pulse2 1.6s ease-in-out infinite",
        pop: "pop .45s cubic-bezier(.2,.9,.3,1.3) both",
        rise: "rise .7s cubic-bezier(.2,.8,.2,1) both",
        shake: "shake .45s ease-in-out",
        float: "float 7s ease-in-out infinite",
        burst: "burst .9s cubic-bezier(.1,.7,.3,1) both",
        flicker: "flicker .9s ease-in-out infinite"
      }
    }
  },
  plugins: []
};
export default config;
