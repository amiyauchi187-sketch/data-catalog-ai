import type { NextConfig } from "next";

// 全ページがログイン中の利用者ごとに（RLSで）内容が変わるため、Cache Components は使わない。
// 利用者をまたいで結果がキャッシュされないよう、すべてリクエストごとに描画する。
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    serverActions: {
      // CSVの原本は送らないが、列の情報とサンプルで数百KBになることがあるため
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
