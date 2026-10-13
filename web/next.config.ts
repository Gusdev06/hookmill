import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

const withNextIntl = createNextIntlPlugin()

// NEXT_DIST_DIR lets a second build (e.g. the MSW one, NEXT_PUBLIC_API_MOCKING=enabled) live next to the dev server's .next.
// transpilePackages: @maquina/video/player exports TS source (the same compositions the render bundles; editor-v1 §8).
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@maquina/video"],
}

export default withNextIntl(nextConfig)
