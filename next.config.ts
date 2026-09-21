import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Nao gerar AGENTS.md/CLAUDE.md automaticamente dentro do projeto
  agentRules: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
