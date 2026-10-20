import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import os from "os";
import AdmZip from "adm-zip";

export interface StoredPdfInfo {
  id: string;
  name: string;
  relativePath: string;
  sizeBytes: number;
  formattedSize: string;
  isAnexo3: boolean;
  absolutePath: string;
}

export interface ConversionRecord {
  fileId: string;
  fileName: string;
  status: "idle" | "converting" | "completed" | "error";
  error?: string;
  pipelineId?: string;
  executionId?: string;
  pageCount?: number;
  runtimeSeconds?: number;
  totalTokens?: number;
  convertedAt?: string;
  markdownPath?: string;
  markdownLength?: number;
}

export interface BatchSummary {
  batchId: string;
  originalFileName: string;
  fileType: "pdf" | "zip" | "local_folder";
  uploadedAt: string;
  totalPdfs: number;
  anexo3Count: number;
  files: StoredPdfInfo[];
  conversions?: Record<string, ConversionRecord>;
}

const BASE_TEMP_DIR = path.join(os.tmpdir(), "pradem-extractor-v2");

/**
 * Retorna el tamaño legible en KB o MB.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Evalúa si el nombre del archivo corresponde a "Anexo 3" (sin importar mayúsculas, minúsculas, espacios o guiones bajos).
 */
export function isAnexo3Name(filename: string): boolean {
  return /anexo[\s_]*3/i.test(filename);
}

/**
 * Asegura la existencia del directorio base temporal.
 */
async function ensureBaseDir() {
  await fs.mkdir(BASE_TEMP_DIR, { recursive: true });
}

/**
 * Guarda y procesa el archivo subido en el almacenamiento temporal del contenedor.
 */
export async function processUpload(file: File): Promise<BatchSummary> {
  await ensureBaseDir();

  const batchId = crypto.randomUUID();
  const batchDir = path.join(BASE_TEMP_DIR, batchId);
  const rawDir = path.join(batchDir, "raw");
  const extractedDir = path.join(batchDir, "extracted");
  const markdownsDir = path.join(batchDir, "markdowns");

  await fs.mkdir(rawDir, { recursive: true });
  await fs.mkdir(extractedDir, { recursive: true });
  await fs.mkdir(markdownsDir, { recursive: true });

  const fileName = file.name;
  const isZip = fileName.toLowerCase().endsWith(".zip");
  const isPdf = fileName.toLowerCase().endsWith(".pdf");

  if (!isZip && !isPdf) {
    throw new Error("Formato no soportado. Solo se admiten archivos .pdf o .zip.");
  }

  // Guardar archivo original recibido
  const rawFilePath = path.join(rawDir, fileName);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await fs.writeFile(rawFilePath, buffer);

  const foundPdfs: StoredPdfInfo[] = [];

  if (isPdf) {
    // PDF individual
    const targetPdfPath = path.join(extractedDir, fileName);
    await fs.writeFile(targetPdfPath, buffer);

    const stats = await fs.stat(targetPdfPath);
    const isAnexo = isAnexo3Name(fileName);

    foundPdfs.push({
      id: crypto.randomUUID(),
      name: fileName,
      relativePath: fileName,
      sizeBytes: stats.size,
      formattedSize: formatBytes(stats.size),
      isAnexo3: isAnexo,
      absolutePath: targetPdfPath,
    });
  } else {
    // Archivo ZIP
    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;

      const entryName = entry.entryName;
      // Prevenir ataques de Zip Slip (Directory Traversal)
      const safePath = path.normalize(entryName).replace(/^(\.\.(\/|\\|$))+/, "");

      if (safePath.toLowerCase().endsWith(".pdf")) {
        const destPath = path.join(extractedDir, safePath);
        const destFolder = path.dirname(destPath);
        await fs.mkdir(destFolder, { recursive: true });

        const pdfData = entry.getData();
        await fs.writeFile(destPath, pdfData);

        const baseName = path.basename(safePath);
        const isAnexo = isAnexo3Name(baseName);

        foundPdfs.push({
          id: crypto.randomUUID(),
          name: baseName,
          relativePath: safePath,
          sizeBytes: pdfData.length,
          formattedSize: formatBytes(pdfData.length),
          isAnexo3: isAnexo,
          absolutePath: destPath,
        });
      }
    }
  }

  // Ordenar poniendo los "Anexo 3" primero y luego alfabéticamente
  foundPdfs.sort((a, b) => {
    if (a.isAnexo3 && !b.isAnexo3) return -1;
    if (!a.isAnexo3 && b.isAnexo3) return 1;
    return a.name.localeCompare(b.name);
  });

  const anexo3Count = foundPdfs.filter((f) => f.isAnexo3).length;

  const summary: BatchSummary = {
    batchId,
    originalFileName: fileName,
    fileType: isZip ? "zip" : "pdf",
    uploadedAt: new Date().toISOString(),
    totalPdfs: foundPdfs.length,
    anexo3Count,
    files: foundPdfs,
    conversions: {},
  };

  // Guardar summary en disco para persistencia
  await fs.writeFile(
    path.join(batchDir, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf-8"
  );

  return summary;
}

/**
 * Importa un directorio local existente (ej: anexo3Paquete) como un lote listo para procesar.
 */
export async function importLocalDirBatch(
  sourceDir: string,
  batchName: string = "anexo3Paquete"
): Promise<BatchSummary> {
  await ensureBaseDir();

  const batchId = crypto.randomUUID();
  const batchDir = path.join(BASE_TEMP_DIR, batchId);
  const extractedDir = path.join(batchDir, "extracted");
  const markdownsDir = path.join(batchDir, "markdowns");

  await fs.mkdir(extractedDir, { recursive: true });
  await fs.mkdir(markdownsDir, { recursive: true });

  const filesInDir = await fs.readdir(sourceDir);
  const foundPdfs: StoredPdfInfo[] = [];

  for (const fName of filesInDir) {
    if (fName.toLowerCase().endsWith(".pdf")) {
      const srcFile = path.join(sourceDir, fName);
      const destFile = path.join(extractedDir, fName);
      await fs.copyFile(srcFile, destFile);

      const stats = await fs.stat(destFile);
      const isAnexo = isAnexo3Name(fName);

      foundPdfs.push({
        id: crypto.randomUUID(),
        name: fName,
        relativePath: fName,
        sizeBytes: stats.size,
        formattedSize: formatBytes(stats.size),
        isAnexo3: isAnexo,
        absolutePath: destFile,
      });
    }
  }

  foundPdfs.sort((a, b) => {
    if (a.isAnexo3 && !b.isAnexo3) return -1;
    if (!a.isAnexo3 && b.isAnexo3) return 1;
    return a.name.localeCompare(b.name);
  });

  const anexo3Count = foundPdfs.filter((f) => f.isAnexo3).length;

  const summary: BatchSummary = {
    batchId,
    originalFileName: batchName,
    fileType: "local_folder",
    uploadedAt: new Date().toISOString(),
    totalPdfs: foundPdfs.length,
    anexo3Count,
    files: foundPdfs,
    conversions: {},
  };

  await fs.writeFile(
    path.join(batchDir, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf-8"
  );

  return summary;
}

/**
 * Obtiene el resumen de un lote guardado en disco.
 */
export async function getBatchSummary(batchId: string): Promise<BatchSummary | null> {
  try {
    const summaryPath = path.join(BASE_TEMP_DIR, batchId, "summary.json");
    if (!fsSync.existsSync(summaryPath)) return null;

    const data = await fs.readFile(summaryPath, "utf-8");
    const summary: BatchSummary = JSON.parse(data);

    // Adjuntar conversiones actualizadas
    summary.conversions = await getBatchConversions(batchId);
    return summary;
  } catch (error) {
    console.error(`Error al leer summary de batch ${batchId}:`, error);
    return null;
  }
}

/**
 * Retorna el mapa de todas las conversiones de un lote.
 */
export async function getBatchConversions(
  batchId: string
): Promise<Record<string, ConversionRecord>> {
  try {
    const markdownsDir = path.join(BASE_TEMP_DIR, batchId, "markdowns");
    if (!fsSync.existsSync(markdownsDir)) return {};

    const metaFile = path.join(markdownsDir, "meta.json");
    if (!fsSync.existsSync(metaFile)) return {};

    const data = await fs.readFile(metaFile, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

/**
 * Guarda o actualiza el registro de conversión de un archivo y almacena el archivo markdown.
 */
export async function saveMarkdownResult(
  batchId: string,
  fileId: string,
  fileName: string,
  markdown: string,
  meta: Partial<ConversionRecord>
): Promise<ConversionRecord> {
  const markdownsDir = path.join(BASE_TEMP_DIR, batchId, "markdowns");
  await fs.mkdir(markdownsDir, { recursive: true });

  const mdFilePath = path.join(markdownsDir, `${fileId}.md`);
  await fs.writeFile(mdFilePath, markdown, "utf-8");

  const metaFile = path.join(markdownsDir, "meta.json");
  let allConversions: Record<string, ConversionRecord> = {};
  if (fsSync.existsSync(metaFile)) {
    try {
      allConversions = JSON.parse(await fs.readFile(metaFile, "utf-8"));
    } catch {
      allConversions = {};
    }
  }

  const record: ConversionRecord = {
    fileId,
    fileName,
    status: meta.status || "completed",
    error: meta.error,
    pipelineId: meta.pipelineId,
    executionId: meta.executionId,
    pageCount: meta.pageCount,
    runtimeSeconds: meta.runtimeSeconds,
    totalTokens: meta.totalTokens,
    convertedAt: new Date().toISOString(),
    markdownPath: mdFilePath,
    markdownLength: markdown.length,
    ...meta,
  };

  allConversions[fileId] = record;
  await fs.writeFile(metaFile, JSON.stringify(allConversions, null, 2), "utf-8");

  return record;
}

/**
 * Actualiza el estado de una conversión (por ejemplo a 'converting' o 'error') en el meta.json
 */
export async function updateConversionRecord(
  batchId: string,
  fileId: string,
  fileName: string,
  updates: Partial<ConversionRecord>
): Promise<ConversionRecord> {
  const markdownsDir = path.join(BASE_TEMP_DIR, batchId, "markdowns");
  await fs.mkdir(markdownsDir, { recursive: true });

  const metaFile = path.join(markdownsDir, "meta.json");
  let allConversions: Record<string, ConversionRecord> = {};
  if (fsSync.existsSync(metaFile)) {
    try {
      allConversions = JSON.parse(await fs.readFile(metaFile, "utf-8"));
    } catch {
      allConversions = {};
    }
  }

  const existing = allConversions[fileId] || {
    fileId,
    fileName,
    status: "idle",
  };

  const updated: ConversionRecord = {
    ...existing,
    ...updates,
    fileId,
    fileName,
  };

  allConversions[fileId] = updated;
  await fs.writeFile(metaFile, JSON.stringify(allConversions, null, 2), "utf-8");
  return updated;
}

/**
 * Obtiene el contenido Markdown y los metadatos de un archivo específico.
 */
export async function getMarkdownResult(
  batchId: string,
  fileId: string
): Promise<{ markdown: string; record: ConversionRecord } | null> {
  try {
    const markdownsDir = path.join(BASE_TEMP_DIR, batchId, "markdowns");
    const mdFilePath = path.join(markdownsDir, `${fileId}.md`);
    if (!fsSync.existsSync(mdFilePath)) return null;

    const markdown = await fs.readFile(mdFilePath, "utf-8");
    const conversions = await getBatchConversions(batchId);
    const record = conversions[fileId] || {
      fileId,
      fileName: "",
      status: "completed",
      markdownLength: markdown.length,
    };

    return { markdown, record };
  } catch (error) {
    console.error(`Error al leer markdown para fileId ${fileId}:`, error);
    return null;
  }
}

/**
 * Elimina el lote del disco temporal cuando ya no se necesita.
 */
export async function cleanupBatch(batchId: string): Promise<boolean> {
  try {
    const batchDir = path.join(BASE_TEMP_DIR, batchId);
    if (fsSync.existsSync(batchDir)) {
      await fs.rm(batchDir, { recursive: true, force: true });
      return true;
    }
    return false;
  } catch (error) {
    console.error(`Error al limpiar batch ${batchId}:`, error);
    return false;
  }
}
