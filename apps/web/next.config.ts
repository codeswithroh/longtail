import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The engine packages ship TypeScript source; compile them with the app.
  transpilePackages: ["@longtail/core", "@longtail/engine"],
  // Keep visited and prefetched tabs in the client cache so switching back is instant.
  experimental: { staleTimes: { dynamic: 60, static: 180 } },
  // The dashboard moved under /app when the landing page took over /.
  async redirects() {
    return [
      { source: "/live", destination: "/app/markets", permanent: false },
      { source: "/backtest", destination: "/app/research", permanent: false },
      { source: "/vault", destination: "/app/earn", permanent: false },
      { source: "/app/vault", destination: "/app/earn", permanent: false },
    ];
  },
};

export default nextConfig;
