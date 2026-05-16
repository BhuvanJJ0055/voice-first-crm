import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep your local network adapter whitelist
  allowedDevOrigins: ['192.168.56.1', 'localhost:3000'],
  
  // REMOVE the turbopack root override entirely. 
  // Let Next.js handle its own compilation locally inside the project.
};

export default nextConfig;
