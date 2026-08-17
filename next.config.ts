import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Article ingest posts a URL; summaries can be a few KB. Default is fine.
  },
};

export default nextConfig;
