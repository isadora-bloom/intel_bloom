

const nextConfig = {
  transpilePackages: ["@bloom/db"],
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client"],
  },
};

export default nextConfig;
