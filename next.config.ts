import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  experimental: {
    /**
     * A scanned A4 bill is two to five megabytes and the default here is one,
     * which would refuse most of the attachments this exists to accept.
     *
     * Twelve rather than something larger: the file travels through a
     * serverless function on its way to the bucket, so the ceiling is also
     * the most memory one upload can cost. If genuinely large files ever
     * need storing, the answer is a presigned URL that lets the browser PUT
     * straight to R2 and skips this path entirely — that needs CORS on the
     * bucket, which is why it is not the thing built first.
     */
    serverActions: { bodySizeLimit: "12mb" },
  },
  // Says nothing about the framework to whoever is looking.
  poweredByHeader: false,
  /**
   * The headers a scan of the app found missing. Framing is refused so the
   * ERP cannot be loaded invisibly inside another site and clicked through;
   * types are not sniffed; a link out does not carry the page's address;
   * the app asks for no camera, microphone or location and is given none.
   *
   * The Content-Security-Policy is set in middleware.ts, because its nonce
   * changes per request. Strict-Transport-Security is set by Vercel on every
   * deployment.
   */
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ],
    }];
  },
};

export default nextConfig;
