import { withSentryConfig } from "@sentry/nextjs";

const nextConfig = {
  transpilePackages: ["@bloom/db"],
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client"],
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
  automaticVercelMonitors: true,
});
