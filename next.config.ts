import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The home page decides whether an issue has art with `existsSync` on
  // `public/gazette/` (src/server/gazette-art.ts). `public/` is served from the
  // CDN and is NOT part of a server trace, so on Vercel that check always came
  // back false and no issue ever showed its picture, even with the file
  // committed. Tracing the folder into the route is what lets the function see it.
  outputFileTracingIncludes: {
    "/": ["./public/gazette/**/*"],
  },
};

export default nextConfig;
