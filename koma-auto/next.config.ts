import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.8.19'],
  images: {
    dangerouslyAllowSVG: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
      },
      {
        protocol: 'https',
        hostname: '**.neon.tech',
      },
      {
        protocol: 'https',
        hostname: 'br-square-rice-b4g35y3p.storage.c-6.us-east-2.aws.neon.tech',
      },
    ],
  },
};

export default nextConfig;
