/**
 * Utilidades para exportar asignaturas a formato CSV estándar (RFC 4180)
 * compatible 1:1 con la tabla `public.asignaturas_extraidas` de Supabase.
 */

export interface AsignaturaCsvRow {
  nombre?: string | null;
  clave?: string | null;
  fines_de_aprendizaje_o_formacion?: string | null;
  contenido_tematico?: string | null;
  actividades_de_aprendizaje?: string | null;
}

/**
 * Encapsula y escapa un campo para cumplir con el estándar RFC 4180:
 * - Si contiene comillas dobles, comas o saltos de línea (\n, \r),
 *   se encierra entre comillas dobles y las comillas internas se duplican (" -> "").
 */
export function escapeCsvField(val: string | null | undefined): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Genera el contenido de un archivo CSV con las columnas exactas de Supabase:
 * `nombre,clave,fines_de_aprendizaje_o_formacion,contenido_tematico,actividades_de_aprendizaje`
 * Incluye el Byte Order Mark (BOM \uFEFF) para preservar acentos y caracteres UTF-8 en Excel y Supabase.
 */
export function generateSupabaseCsv(rows: AsignaturaCsvRow[]): string {
  const headers = [
    "nombre",
    "clave",
    "fines_de_aprendizaje_o_formacion",
    "contenido_tematico",
    "actividades_de_aprendizaje",
  ];

  const headerLine = headers.join(",");
  const dataLines = rows.map((row) => {
    return [
      escapeCsvField(row.nombre?.trim() || ""),
      escapeCsvField(row.clave?.trim() || ""),
      escapeCsvField(row.fines_de_aprendizaje_o_formacion?.trim() || ""),
      escapeCsvField(row.contenido_tematico?.trim() || ""),
      escapeCsvField(row.actividades_de_aprendizaje?.trim() || ""),
    ].join(",");
  });

  // Prepend \uFEFF (UTF-8 BOM) para compatibilidad total con navegadores, Excel y Supabase
  return "\uFEFF" + [headerLine, ...dataLines].join("\r\n");
}

/**
 * Dispara la descarga del archivo CSV en el navegador del cliente.
 */
export function downloadCsv(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute(
    "download",
    filename.toLowerCase().endsWith(".csv") ? filename : `${filename}.csv`
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
