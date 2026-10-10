/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" }
    ]
  },
  // The exam code sandbox loads its WebAssembly at runtime; keep it out of the server bundle.
  serverExternalPackages: ["quickjs-emscripten"],
  experimental: {
    serverActions: { bodySizeLimit: "4mb" }
  }
};
export default nextConfig;
