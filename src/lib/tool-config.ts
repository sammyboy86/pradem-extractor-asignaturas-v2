import { cache } from "react";
import { TOOL_SLUG } from "@/pradem.config";

/**
 * Configuración de la herramienta leída desde Supabase.
 */
export interface ToolConfig {
  name: string;
  slug: string;
  description: string;
  emoji: string;
  color: string;
  is_admin: boolean;
}

/**
 * Fallback: si Supabase no está disponible, derivamos un nombre legible del slug.
 */
function slugToName(slug: string): string {
  return slug
    .replace(/^admin-/, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const FALLBACK: ToolConfig = {
  name: slugToName(TOOL_SLUG),
  slug: TOOL_SLUG,
  description: "",
  emoji: "🔧",
  color: "indigo",
  is_admin: TOOL_SLUG.startsWith("admin-"),
};

/**
 * Obtiene la configuración de esta herramienta desde la tabla pradem_tools.
 *
 * - Usa React `cache()` para deduplicar dentro del mismo render.
 * - Usa `next: { revalidate: 60 }` para cachear 60 s entre requests.
 * - Si Supabase no está disponible, devuelve un fallback basado en el slug.
 */
export const getToolConfig = cache(async (): Promise<ToolConfig> => {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) {
      console.warn("[ToolConfig] Faltan credenciales de Supabase, usando fallback");
      return FALLBACK;
    }

    const res = await fetch(
      `${url}/rest/v1/pradem_tools?slug=eq.${TOOL_SLUG}&is_active=eq.true&select=name,slug,description,emoji,color,is_admin`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        next: { revalidate: 60 },
      }
    );

    if (!res.ok) {
      console.warn("[ToolConfig] Error al consultar Supabase:", res.status);
      return FALLBACK;
    }

    const rows = await res.json();
    if (!rows || rows.length === 0) {
      console.warn(
        `[ToolConfig] Herramienta "${TOOL_SLUG}" no encontrada en pradem_tools. ` +
        `¿Ya la registraste en Pradem Core → /dashboard/admin/tools?`
      );
      return FALLBACK;
    }

    return rows[0] as ToolConfig;
  } catch (err) {
    console.warn("[ToolConfig] Error de red:", err);
    return FALLBACK;
  }
});
