import { extractText, getDocumentProxy } from "unpdf";

export interface PdfExtractionResult {
  markdown: string;
  pageCount: number;
  runtimeSeconds: number;
  title?: string;
}

/**
 * Convierte el texto extraído de las páginas de un PDF en un Markdown limpio y estructurado.
 */
export function formatExtractedTextToMarkdown(
  pagesText: string[],
  fileName: string
): string {
  const lines: string[] = [];

  // Título principal basado en el nombre del archivo
  const cleanTitle = fileName.replace(/\.pdf$/i, "").trim();
  lines.push(`# ${cleanTitle}`);
  lines.push("");

  const knownSectionHeaders = [
    "DENOMINACIÓN DE LA ASIGNATURA O UNIDAD DE APRENDIZAJE",
    "FINES DE APRENDIZAJE O FORMACIÓN",
    "CONTENIDO TEMÁTICO",
    "ACTIVIDADES DE APRENDIZAJE BAJO CONDUCCIÓN DE UN ACADÉMICO",
    "ACTIVIDADES DE APRENDIZAJE INDEPENDIENTES",
    "CRITERIOS DE EVALUACIÓN",
    "MODALIDADES TECNOLÓGICAS E INFORMÁTICAS",
    "BIBLIOGRAFÍA",
    "RECURSOS DIDÁCTICOS",
    "PERFIL DEL DOCENTE",
    "OBJETIVO GENERAL",
    "OBJETIVOS ESPECÍFICOS",
  ];

  pagesText.forEach((pageContent, index) => {
    const pageNum = index + 1;
    lines.push(`---`);
    lines.push(`> **Página ${pageNum}**`);
    lines.push("");

    const rawLines = pageContent.split(/\r?\n/);
    let inList = false;

    for (let line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (inList) {
          inList = false;
        }
        lines.push("");
        continue;
      }

      // Detectar encabezados conocidos
      const matchedHeader = knownSectionHeaders.find((h) =>
        trimmed.toUpperCase().includes(h)
      );
      if (matchedHeader) {
        lines.push("");
        lines.push(`### ${trimmed}`);
        lines.push("");
        continue;
      }

      // Detectar viñetas (•, ◦, -, *)
      if (/^[•◦\u2022\u2023\u25E6\u2043\u2219]\s*/.test(trimmed)) {
        const itemText = trimmed.replace(/^[•◦\u2022\u2023\u25E6\u2043\u2219]\s*/, "");
        lines.push(`- ${itemText}`);
        inList = true;
        continue;
      }

      // Detectar listas numeradas (1., 1.1, 1.1.1, etc.)
      if (/^\d+(\.\d+)*\s+/.test(trimmed)) {
        lines.push(`- **${trimmed}**`);
        inList = true;
        continue;
      }

      // Encabezados en mayúsculas completas y cortos (posibles títulos)
      if (
        trimmed.length > 3 &&
        trimmed.length < 60 &&
        trimmed === trimmed.toUpperCase() &&
        !trimmed.includes(":") &&
        !/\d{3,}/.test(trimmed)
      ) {
        lines.push(`#### ${trimmed}`);
        lines.push("");
        continue;
      }

      // Texto regular
      lines.push(trimmed);
    }

    lines.push("");
  });

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Convierte cualquier fuente binaria (Buffer, ArrayBuffer, TypedArray) a un Uint8Array puro
 * para evitar el error de PDF.js: "Please provide binary data as `Uint8Array`, rather than `Buffer`."
 */
export function toUint8Array(data: ArrayBuffer | Uint8Array | Buffer | ArrayLike<number>): Uint8Array {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof Uint8Array) {
    if (data.constructor === Uint8Array) {
      return data;
    }
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data as ArrayLike<number>);
}

/**
 * Procesa un PDF con unpdf y genera Markdown estructurado.
 * Acepta ArrayBuffer, Uint8Array o Buffer, asegurando que unpdf siempre reciba Uint8Array puro.
 */
export async function extractPdfToMarkdown(
  pdfBinary: ArrayBuffer | Uint8Array | Buffer,
  fileName: string
): Promise<PdfExtractionResult> {
  const startTime = Date.now();

  const uint8 = toUint8Array(pdfBinary);
  const pdf = await getDocumentProxy(uint8);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });

  const pagesArray = Array.isArray(text) ? text : [text];
  const markdown = formatExtractedTextToMarkdown(pagesArray, fileName);
  const runtimeSeconds = (Date.now() - startTime) / 1000;

  return {
    markdown,
    pageCount: totalPages,
    runtimeSeconds,
    title: fileName.replace(/\.pdf$/i, ""),
  };
}

