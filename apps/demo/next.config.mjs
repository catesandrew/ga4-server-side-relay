/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keeps @gtm-server-side/ga4-relay out of the webpack bundle so the SW
  // route's require.resolve()+readFileSync() asset read behaves like plain
  // Node.js at runtime instead of being rewritten by webpack.
  serverExternalPackages: ["@gtm-server-side/ga4-relay"],
};
export default nextConfig;
