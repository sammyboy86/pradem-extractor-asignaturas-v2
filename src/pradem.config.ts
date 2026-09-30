// ══════════════════════════════════════════════════════════════
//  IDENTIFICADOR DE TU HERRAMIENTA
// ══════════════════════════════════════════════════════════════
//
//  Este es el ÚNICO valor que necesitas configurar en el código.
//  Todo lo demás (nombre, emoji, descripción, color) se lee
//  automáticamente de Supabase (tabla pradem_tools).
//
//  Flujo:
//   1. Un admin registra la herramienta en Pradem Core
//      → /dashboard/admin/tools → "+ Nueva Herramienta"
//   2. Aquí solo pones el slug que coincida con ese registro
//   3. La herramienta se autoconfigura al arrancar
//
// ══════════════════════════════════════════════════════════════

/**
 * Slug URL de esta herramienta — debe coincidir con el slug
 * registrado en la tabla pradem_tools de Supabase.
 *
 * Si la herramienta es de administrador, debe comenzar con "admin-".
 *
 * Ejemplos: "validador-demanda", "admin-asignador-salones"
 */
export const TOOL_SLUG = "admin-extractor-asignaturas-v2";
