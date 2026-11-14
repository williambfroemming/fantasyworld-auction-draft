import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The home page decides whether an issue has art with `existsSync` on
  // `public/gazette/` (src/server/gazette-art.ts). `public/` is served from the
  // CDN and is NOT part of a server trace, so on Vercel that check always came
  // back false and no issue ever showed its picture, even with the file
  // committed. Tracing the folder into the route is what lets the function see it.
  // Only `/` calls `issueArt`; the issue pages under `/gazette` do not.
  outputFileTracingIncludes: {
    "/": ["./public/gazette/**/*"],
  },

  // The Gazette and the Oracle moved out of /history to short URLs
  // (docs/archive/SITE_STRUCTURE.md). Permanent, because every "new issue" email
  // already sent links to the old path and must keep working forever.
  //
  // These run BEFORE src/proxy.ts (config redirects precede the proxy in
  // Next 16), so a signed-out visitor on an old link is sent to the new path
  // first and only then to /join?next=<new path>. Nothing is readable on the
  // way through: a redirect is a Location header, not the page.
  async redirects() {
    return [
      { source: "/history/gazette", destination: "/gazette", permanent: true },
      {
        source: "/history/gazette/:season/:week",
        destination: "/gazette/:season/:week",
        permanent: true,
      },
      { source: "/history/oracle", destination: "/oracle", permanent: true },
    ];
  },
};

export default nextConfig;
