/**
 * Motor de expresiones regulares para procesar segmentos de Markdown
 * y estructurar registros de la tabla `public.asignaturas_extraidas`.
 */

export interface AsignaturaExtraida {
  id?: number;
  segmentIndex: number;
  nombre: string;
  clave: string;
  fines_de_aprendizaje_o_formacion: string;
  contenido_tematico: string;
  actividades_de_aprendizaje: string;
  rawSegment: string;
  // Estados de control para la interfaz y sincronización con Supabase
  status: "pending" | "uploading" | "uploaded" | "skipped_duplicate" | "error";
  statusMessage?: string;
  uploadedId?: number;
}

export type AsignaturaFieldKey =
  | "nombre"
  | "clave"
  | "fines_de_aprendizaje_o_formacion"
  | "contenido_tematico"
  | "actividades_de_aprendizaje";

export interface FieldRegexRule {
  field: AsignaturaFieldKey;
  label: string;
  pattern: string;
  flags: string;
  captureGroup: number;
  cleanWhitespace: boolean;
  description: string;
  fallbackPattern?: string;
}

export const DEFAULT_SEGMENT_DELIMITER = "### DENOMINACIÓN DE LA ASIGNATURA";

export const DEFAULT_REGEX_RULES: Record<AsignaturaFieldKey, FieldRegexRule> = {
  nombre: {
    field: "nombre",
    label: "Nombre de la Asignatura",
    pattern: "(?:O UNIDAD DE APRENDIZAJE\\s*\\n+)?([^\\n#]+?)(?=\\s*\\n+\\s*(?:Primer|Segundo|Tercer|Cuarto|Quinto|Sexto|Séptimo|Octavo|Noveno|Décimo|Cuatrimestre|Semestre|####|###|CLAVE|$))",
    flags: "i",
    captureGroup: 1,
    cleanWhitespace: true,
    description: "Captura el título de la asignatura ubicado inmediatamente tras el encabezado de denominación.",
  },
  clave: {
    field: "clave",
    label: "Clave",
    pattern: "(?:cuatrimestre|semestre|clave(?:\\s+de\\s+la\\s+asignatura)?)[^\\n]*?\\b([A-Z]{2,6}\\d{2,5}[A-Z]?)\\b",
    flags: "i",
    captureGroup: 1,
    cleanWhitespace: true,
    description: "Captura la clave alfanumérica de la asignatura (ej. AFI01, LAD02, INTE00001).",
    fallbackPattern: "\\b([A-Z]{2,5}\\d{2,4})\\b",
  },
  fines_de_aprendizaje_o_formacion: {
    field: "fines_de_aprendizaje_o_formacion",
    label: "Fines de Aprendizaje o Formación",
    pattern: "### FINES DE APRENDIZAJE O FORMACIÓN\\s*\\n+([\\s\\S]*?)(?=\\n+### CONTENIDO TEMÁTICO|\\n+### ACTIVIDADES|\\n+### CRITERIOS|$)",
    flags: "i",
    captureGroup: 1,
    cleanWhitespace: true,
    description: "Captura los objetivos o fines de aprendizaje de la asignatura.",
  },
  contenido_tematico: {
    field: "contenido_tematico",
    label: "Contenido Temático",
    pattern: "### CONTENIDO TEMÁTICO\\s*\\n+([\\s\\S]*?)(?=\\n+### ACTIVIDADES|\\n+### CRITERIOS|$)",
    flags: "i",
    captureGroup: 1,
    cleanWhitespace: true,
    description: "Captura el temario y desglose de unidades de la materia.",
  },
  actividades_de_aprendizaje: {
    field: "actividades_de_aprendizaje",
    label: "Actividades de Aprendizaje",
    pattern: "### ACTIVIDADES DE APRENDIZAJE[^\\n]*\\n+([\\s\\S]*?)(?=\\n+### CRITERIOS DE EVALUACIÓN|\\n+### MODALIDADES|\\n+### BIBLIOGRAFÍA|$)",
    flags: "i",
    captureGroup: 1,
    cleanWhitespace: true,
    description: "Captura las actividades con docente e independientes de la asignatura.",
  },
};

export interface RegexConfig {
  delimiter: string;
  isDelimiterRegex?: boolean;
  rules: Record<AsignaturaFieldKey, FieldRegexRule>;
}

export const DEFAULT_REGEX_CONFIG: RegexConfig = {
  delimiter: DEFAULT_SEGMENT_DELIMITER,
  isDelimiterRegex: false,
  rules: DEFAULT_REGEX_RULES,
};

/**
 * Divide el markdown completo en segmentos utilizando el delimitador provisto por el usuario.
 */
export function splitMarkdownIntoSegments(
  markdown: string,
  delimiter: string,
  isDelimiterRegex: boolean = false
): { preamble: string; segments: string[] } {
  if (!markdown) {
    return { preamble: "", segments: [] };
  }

  const cleanDelimiter = delimiter.trim();
  if (!cleanDelimiter) {
    return { preamble: "", segments: [markdown] };
  }

  let regex: RegExp;
  if (isDelimiterRegex) {
    try {
      regex = new RegExp(cleanDelimiter, "gim");
    } catch {
      const escaped = cleanDelimiter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      regex = new RegExp(escaped, "gim");
    }
  } else {
    const escaped = cleanDelimiter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    regex = new RegExp(escaped, "gim");
  }

  const parts = markdown.split(regex);

  if (parts.length <= 1) {
    return { preamble: "", segments: parts };
  }

  // La primera parte antes del primer delimitador suele ser la portada o índice
  const preamble = parts[0].trim();
  const rawSegments = parts.slice(1);

  // Filtrar segmentos excesivamente cortos (ej. espacios en blanco)
  const segments = rawSegments
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  return { preamble, segments };
}

/**
 * Ejecuta una regla regex sobre un texto y extrae el contenido del grupo indicado.
 */
export function executeFieldRegex(text: string, rule: FieldRegexRule): string {
  try {
    const rx = new RegExp(rule.pattern, rule.flags);
    const match = text.match(rx);

    if (match) {
      const captured = match[rule.captureGroup] ?? match[0] ?? "";
      return rule.cleanWhitespace ? cleanExtractedText(captured) : captured;
    }

    // Probar patrón de respaldo si existe
    if (rule.fallbackPattern) {
      const fbRx = new RegExp(rule.fallbackPattern, rule.flags);
      const fbMatch = text.match(fbRx);
      if (fbMatch) {
        const captured = fbMatch[rule.captureGroup] ?? fbMatch[0] ?? "";
        return rule.cleanWhitespace ? cleanExtractedText(captured) : captured;
      }
    }
  } catch (err) {
    console.warn(`Error ejecutando regex para campo ${rule.field}:`, err);
  }

  return "";
}

/**
 * Limpia espacios redundantes, saltos de línea excesivos y marcas residuales de markdown.
 */
export function cleanExtractedText(text: string): string {
  if (!text) return "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Procesa un segmento individual y extrae todos los campos requeridos para la tabla.
 */
export function extractAsignaturaFromSegment(
  segmentText: string,
  rules: Record<AsignaturaFieldKey, FieldRegexRule>,
  segmentIndex: number
): AsignaturaExtraida {
  const nombre = executeFieldRegex(segmentText, rules.nombre);
  let clave = executeFieldRegex(segmentText, rules.clave);

  // Sanitización de clave (mayúsculas, sin espacios interiores)
  clave = clave.replace(/\s+/g, "").toUpperCase();

  const fines_de_aprendizaje_o_formacion = executeFieldRegex(
    segmentText,
    rules.fines_de_aprendizaje_o_formacion
  );
  const contenido_tematico = executeFieldRegex(
    segmentText,
    rules.contenido_tematico
  );
  const actividades_de_aprendizaje = executeFieldRegex(
    segmentText,
    rules.actividades_de_aprendizaje
  );

  return {
    segmentIndex,
    nombre: nombre || `Asignatura ${segmentIndex}`,
    clave,
    fines_de_aprendizaje_o_formacion,
    contenido_tematico,
    actividades_de_aprendizaje,
    rawSegment: segmentText,
    status: "pending",
  };
}

/**
 * Procesa un markdown completo con el delimitador y las reglas regex configuradas.
 */
export function processMarkdownWithRules(
  markdown: string,
  delimiter: string,
  rules: Record<AsignaturaFieldKey, FieldRegexRule>,
  isDelimiterRegex: boolean = false
): AsignaturaExtraida[] {
  const { segments } = splitMarkdownIntoSegments(markdown, delimiter, isDelimiterRegex);

  return segments.map((seg, idx) =>
    extractAsignaturaFromSegment(seg, rules, idx + 1)
  );
}

export interface MarkdownViewSegment {
  segmentIndex: number;
  content: string;
  rawText: string;
}

export interface StructuredMarkdownView {
  preamble: string;
  segments: MarkdownViewSegment[];
}

/**
 * Divide el markdown completo en segmentos para el visor de Markdown,
 * preservando los encabezados delimitadores y manteniendo paridad 1:1
 * con los segmentIndex de `processMarkdownWithRules`.
 */
export function getStructuredMarkdownForView(
  markdown: string,
  delimiter: string,
  isDelimiterRegex: boolean = false
): StructuredMarkdownView {
  if (!markdown) {
    return { preamble: "", segments: [] };
  }

  const cleanDelimiter = delimiter.trim();
  if (!cleanDelimiter) {
    return {
      preamble: "",
      segments: [{ segmentIndex: 1, content: markdown.trim(), rawText: markdown }],
    };
  }

  let regex: RegExp;
  if (isDelimiterRegex) {
    try {
      regex = new RegExp(cleanDelimiter, "gim");
    } catch {
      const escaped = cleanDelimiter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      regex = new RegExp(escaped, "gim");
    }
  } else {
    const escaped = cleanDelimiter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    regex = new RegExp(escaped, "gim");
  }

  const matches: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(
    regex.source,
    regex.flags.includes("g") ? regex.flags : regex.flags + "g"
  );
  while ((m = re.exec(markdown)) !== null) {
    matches.push({ start: m.index, end: re.lastIndex });
  }

  if (matches.length === 0) {
    return {
      preamble: "",
      segments: [{ segmentIndex: 1, content: markdown.trim(), rawText: markdown }],
    };
  }

  let preamble = markdown.slice(0, matches[0].start).trim();
  const segments: MarkdownViewSegment[] = [];

  let currentValidIndex = 1;
  for (let i = 0; i < matches.length; i++) {
    const nextStart = matches[i + 1]?.start ?? markdown.length;
    const body = markdown.slice(matches[i].end, nextStart);

    // Mantener la misma condición de splitMarkdownIntoSegments (length > 20)
    if (body.trim().length > 20) {
      const fullText = markdown.slice(matches[i].start, nextStart).trim();
      segments.push({
        segmentIndex: currentValidIndex,
        content: fullText,
        rawText: fullText,
      });
      currentValidIndex++;
    } else {
      const discardedChunk = markdown.slice(matches[i].start, nextStart);
      if (segments.length === 0) {
        preamble = (preamble ? preamble + "\n\n" : "") + discardedChunk.trim();
      } else {
        segments[segments.length - 1].content += "\n\n" + discardedChunk;
        segments[segments.length - 1].rawText += "\n\n" + discardedChunk;
      }
    }
  }

  return { preamble, segments };
}

export type OutlierReason =
  | "empty"
  | "too_short"
  | "too_long"
  | "statistical_high"
  | "statistical_low";

export interface FieldOutlierInfo {
  field: AsignaturaFieldKey;
  label: string;
  charCount: number;
  reason: OutlierReason;
  message: string;
  expectedMin?: number;
  expectedMax?: number;
  median?: number;
}

export interface AsignaturaOutlierReport {
  hasOutliers: boolean;
  fields: Partial<Record<AsignaturaFieldKey, FieldOutlierInfo>>;
  outlierCount: number;
  summaryList: string[];
}

export const OUTLIER_FIELD_LABELS: Record<AsignaturaFieldKey, string> = {
  nombre: "Nombre",
  clave: "Clave",
  fines_de_aprendizaje_o_formacion: "Fines de Aprendizaje",
  contenido_tematico: "Contenido Temático",
  actividades_de_aprendizaje: "Actividades de Aprendizaje",
};

export const OUTLIER_ABSOLUTE_BOUNDS: Record<
  AsignaturaFieldKey,
  { min: number; max: number }
> = {
  nombre: { min: 3, max: 160 },
  clave: { min: 2, max: 16 },
  fines_de_aprendizaje_o_formacion: { min: 25, max: 5000 },
  contenido_tematico: { min: 40, max: 15000 },
  actividades_de_aprendizaje: { min: 25, max: 8000 },
};

function getQuantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

/**
 * Analiza una lista de asignaturas extraídas para detectar valores atípicos
 * de longitud de caracteres por campo (vacíos, extremos absolutos y anomalías estadísticas).
 */
export function analyzeOutliers(
  entries: AsignaturaExtraida[]
): Map<number, AsignaturaOutlierReport> {
  const reports = new Map<number, AsignaturaOutlierReport>();
  if (!entries || entries.length === 0) return reports;

  const fields: AsignaturaFieldKey[] = [
    "nombre",
    "clave",
    "fines_de_aprendizaje_o_formacion",
    "contenido_tematico",
    "actividades_de_aprendizaje",
  ];

  // 1. Calcular distribuciones estadísticas por campo si hay suficiente muestra (>= 4)
  const statsByField = new Map<
    AsignaturaFieldKey,
    {
      median: number;
      q1: number;
      q3: number;
      upperLimit: number;
      lowerLimit: number;
    }
  >();

  for (const field of fields) {
    const lengths = entries
      .map((e) => (e[field] || "").trim().length)
      .filter((len) => len > 0)
      .sort((a, b) => a - b);

    if (lengths.length >= 4) {
      const q1 = getQuantile(lengths, 0.25);
      const median = getQuantile(lengths, 0.5);
      const q3 = getQuantile(lengths, 0.75);
      const iqr = q3 - q1;

      // Límite superior: Q3 + 2.0*IQR, con piso de 2.5x mediana
      const upperLimit = Math.max(q3 + 2.0 * iqr, median * 2.5);
      // Límite inferior: Q1 - 1.5*IQR, con techo de 0.35x mediana
      const lowerLimit = Math.min(Math.max(0, q1 - 1.5 * iqr), median * 0.35);

      statsByField.set(field, { median, q1, q3, upperLimit, lowerLimit });
    }
  }

  // 2. Evaluar cada asignatura
  for (const entry of entries) {
    const fieldOutliers: Partial<Record<AsignaturaFieldKey, FieldOutlierInfo>> = {};
    const summaryList: string[] = [];

    for (const field of fields) {
      const text = (entry[field] || "").trim();
      const len = text.length;
      const bounds = OUTLIER_ABSOLUTE_BOUNDS[field];
      const stats = statsByField.get(field);
      const label = OUTLIER_FIELD_LABELS[field];

      let outlier: FieldOutlierInfo | null = null;

      if (len === 0) {
        outlier = {
          field,
          label,
          charCount: 0,
          reason: "empty",
          message: `${label}: Vacío (0 car.)`,
          expectedMin: bounds.min,
          expectedMax: bounds.max,
        };
      } else if (len < bounds.min) {
        outlier = {
          field,
          label,
          charCount: len,
          reason: "too_short",
          message: `${label}: Muy corto (${len} car. < mín. ${bounds.min})`,
          expectedMin: bounds.min,
          expectedMax: bounds.max,
        };
      } else if (len > bounds.max) {
        outlier = {
          field,
          label,
          charCount: len,
          reason: "too_long",
          message: `${label}: Excesivamente largo (${len} car. > máx. ${bounds.max})`,
          expectedMin: bounds.min,
          expectedMax: bounds.max,
        };
      } else if (stats) {
        if (len > stats.upperLimit && len > bounds.min * 3) {
          outlier = {
            field,
            label,
            charCount: len,
            reason: "statistical_high",
            message: `${label}: Longitud atípica alta (${len} car. vs mediana ~${Math.round(stats.median)})`,
            median: Math.round(stats.median),
          };
        } else if (len < stats.lowerLimit && stats.lowerLimit > bounds.min) {
          outlier = {
            field,
            label,
            charCount: len,
            reason: "statistical_low",
            message: `${label}: Longitud atípica baja (${len} car. vs mediana ~${Math.round(stats.median)})`,
            median: Math.round(stats.median),
          };
        }
      }

      if (outlier) {
        fieldOutliers[field] = outlier;
        summaryList.push(outlier.message);
      }
    }

    const outlierCount = Object.keys(fieldOutliers).length;
    reports.set(entry.segmentIndex, {
      hasOutliers: outlierCount > 0,
      fields: fieldOutliers,
      outlierCount,
      summaryList,
    });
  }

  return reports;
}


