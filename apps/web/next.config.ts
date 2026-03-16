import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@bloom/db"],
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client"],
  },
};

export default nextConfig;
