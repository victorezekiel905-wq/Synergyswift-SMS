/** @type {import('next').NextConfig} */

const PYODIDE_CDN = "https://cdn.jsdelivr.net";

// Live lessons' code activities run student code in /sandbox/* workers. They may evaluate
// code and load the pinned Pyodide build, but may not reach our API or Supabase (no session theft).
const sandboxCsp = [
  "default-src 'none'",
  `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' ${PYODIDE_CDN}`,
  `connect-src ${PYODIDE_CDN}`
].join("; ");

const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" }
    ]
  },
  // The exam code sandbox loads its WebAssembly at runtime, and lesson import reads PDFs and
  // Word files with native/runtime-loaded code; keep them out of the server bundle.
  serverExternalPackages: ["quickjs-emscripten", "pdf-parse", "mammoth", "@napi-rs/canvas"],
  // The PDF reader loads its worker and font data from files the bundle tracer can't see.
  outputFileTracingIncludes: {
    "/api/swift/lessons/import": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/standard_fonts/**",
      "./node_modules/pdfjs-dist/cmaps/**",
      "./node_modules/@napi-rs/canvas*/**"
    ]
  },
  experimental: {
    serverActions: { bodySizeLimit: "4mb" }
  },
  async headers() {
    return [
      {
        source: "/sandbox/:path*",
        headers: [
          { key: "Content-Security-Policy", value: sandboxCsp },
          { key: "Cache-Control", value: "public, max-age=3600" }
        ]
      }
    ];
  }
};
export default nextConfig;
