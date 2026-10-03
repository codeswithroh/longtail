import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dashboard moved under /app when the landing page took over /.
  async redirects() {
    return [
      { source: "/live", destination: "/app/markets", permanent: false },
      { source: "/backtest", destination: "/app/research", permanent: false },
      { source: "/vault", destination: "/app/vault", permanent: false },
    ];
  },
};

export default nextConfig;
