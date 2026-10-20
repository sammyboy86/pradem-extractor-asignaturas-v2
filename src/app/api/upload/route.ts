import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fsSync from "fs";
import {
  processUpload,
  cleanupBatch,
  getBatchSummary,
  importLocalDirBatch,
} from "@/lib/temp-storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/upload?batchId=xyz
 * Retorna la información y lista de archivos de un lote existente.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId");

    if (!batchId) {
      return NextResponse.json(
        { error: "Se requiere el parámetro batchId." },
        { status: 400 }
      );
    }

    const summary = await getBatchSummary(batchId);
    if (!summary) {
      return NextResponse.json(
        { error: `No se encontró el lote con ID ${batchId}.` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error("Error en GET /api/upload:", error);
    const message =
      error instanceof Error ? error.message : "Error al obtener el lote.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/upload
 * Recibe un archivo PDF o ZIP, lo guarda temporalmente en el sistema de archivos (/tmp)
 * y extrae los PDFs identificando si corresponden a "Anexo 3".
 * También soporta { loadLocalFolder: true } para importar carpetas locales del repo (ej: anexo3Paquete).
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";

    // Si se envía JSON para cargar carpeta local existente en el workspace
    if (contentType.includes("application/json")) {
      const body = await request.json();
      if (body.loadLocalFolder) {
        const localDir =
          body.folderPath ||
          path.join(process.cwd(), "anexo3Paquete");

        if (!fsSync.existsSync(/*turbopackIgnore: true*/ localDir)) {
          return NextResponse.json(
            { error: `La carpeta local ${localDir} no existe.` },
            { status: 404 }
          );
        }

        const summary = await importLocalDirBatch(localDir, "anexo3Paquete (Local)");
        return NextResponse.json({
          success: true,
          data: summary,
        });
      }
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No se proporcionó ningún archivo válido." },
        { status: 400 }
      );
    }

    const summary = await processUpload(file);

    return NextResponse.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error("Error en POST /api/upload:", error);
    const message =
      error instanceof Error ? error.message : "Error al procesar el archivo.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/upload
 * Permite limpiar el almacenamiento temporal de un lote específico.
 */
export async function DELETE(request: NextRequest) {
  try {
    const { batchId } = await request.json();

    if (!batchId) {
      return NextResponse.json(
        { error: "Se requiere batchId para eliminar el lote." },
        { status: 400 }
      );
    }

    const removed = await cleanupBatch(batchId);

    return NextResponse.json({
      success: true,
      removed,
    });
  } catch (error) {
    console.error("Error en DELETE /api/upload:", error);
    const message =
      error instanceof Error ? error.message : "Error al limpiar el lote temporal.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
