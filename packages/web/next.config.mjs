/** @type {import('next').NextConfig} */
const nextConfig = {
  // Compile the workspace schema package (raw TS/ESM) as part of the app build.
  transpilePackages: ["@learnmcp/schema"],
};

export default nextConfig;
