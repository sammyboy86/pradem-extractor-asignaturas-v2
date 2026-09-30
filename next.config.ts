import type { NextConfig } from "next";
import { TOOL_SLUG } from "./src/pradem.config";

const nextConfig: NextConfig = {
  // basePath se configura automáticamente desde pradem.config.ts.
  // Debe coincidir con el slug registrado en la tabla pradem_tools de Supabase.
  basePath: `/${TOOL_SLUG}`,

  // Necesario para que las imágenes funcionen correctamente con basePath
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
