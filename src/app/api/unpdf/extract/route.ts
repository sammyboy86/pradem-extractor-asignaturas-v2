import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { extractPdfToMarkdown, toUint8Array } from "@/lib/pdf-to-markdown";
import { getBatchSummary, saveMarkdownResult } from "@/lib/temp-storage";

export const dynamic = "force-dynamic";

/**
 * POST /api/unpdf/extract
 * Extrae texto de un PDF usando unpdf y genera Markdown estructurado.
 * 
 * Acepta:
 * 1. JSON con { batchId, fileId } -> procesa archivo en almacenamiento temporal.
 * 2. JSON con { localFileName } -> procesa archivo de anexo3Paquete si existe.
 * 3. FormData con archivo PDF binario adjunto.
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";

    // 1. Caso JSON: referencia a archivo en disco
    if (contentType.includes("application/json")) {
      const body = await request.json();
      const { batchId, fileId, localFileName } = body || {};

      let filePath = "";
      let fileName = "";

      if (batchId && fileId) {
        const summary = await getBatchSummary(batchId);
        const fileInfo = summary?.files.find((f) => f.id === fileId);
        if (!fileInfo || !fsSync.existsSync(fileInfo.absolutePath)) {
          return NextResponse.json(
            { success: false, error: "Archivo no encontrado en el lote del servidor." },
            { status: 404 }
          );
        }
        filePath = fileInfo.absolutePath;
        fileName = fileInfo.name;
      } else if (localFileName) {
        const localPath = path.join(process.cwd(), "anexo3Paquete", localFileName);
        if (!fsSync.existsSync(localPath)) {
          return NextResponse.json(
            { success: false, error: `Archivo local ${localFileName} no encontrado.` },
            { status: 404 }
          );
        }
        filePath = localPath;
        fileName = localFileName;
      } else {
        return NextResponse.json(
          { success: false, error: "Parámetros insuficientes (batchId/fileId o localFileName requerido)." },
          { status: 400 }
        );
      }

      const fileBuffer = await fs.readFile(/*turbopackIgnore: true*/ filePath);
      const uint8 = toUint8Array(fileBuffer);
      const result = await extractPdfToMarkdown(uint8, fileName);

      // Si pertenece a un batch, guardar también en storage temporal
      if (batchId && fileId) {
        await saveMarkdownResult(batchId, fileId, fileName, result.markdown, {
          status: "completed",
          pipelineId: "unpdf-local",
          pageCount: result.pageCount,
          runtimeSeconds: result.runtimeSeconds,
        });
      }

      return NextResponse.json({
        success: true,
        fileName,
        markdown: result.markdown,
        pageCount: result.pageCount,
        runtimeSeconds: result.runtimeSeconds,
      });
    }

    // 2. Caso FormData: archivo PDF subido directamente
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "No se proporcionó ningún archivo PDF válido." },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const uint8 = toUint8Array(arrayBuffer);
    const result = await extractPdfToMarkdown(uint8, file.name);

    return NextResponse.json({
      success: true,
      fileName: file.name,
      markdown: result.markdown,
      pageCount: result.pageCount,
      runtimeSeconds: result.runtimeSeconds,
    });
  } catch (error) {
    console.error("Error en POST /api/unpdf/extract:", error);
    const message =
      error instanceof Error ? error.message : "Error al extraer PDF con unpdf.";
    return NextResponse.json({ success: false, error: message }, { status: 200 });
  }
}
