import { NextRequest, NextResponse } from "next/server";
import {
  getBatchSummary,
  saveMarkdownResult,
  updateConversionRecord,
  getBatchConversions,
} from "@/lib/temp-storage";
import {
  runDatalabPipeline,
  runDatalabDirectConvert,
  DEFAULT_PIPELINE_ID,
} from "@/lib/datalab";

export const dynamic = "force-dynamic";

/**
 * GET /api/datalab/convert?batchId=xyz
 * Retorna el estado de todas las conversiones de un lote.
 */
export async function GET(request: NextRequest) {
  try {
    const batchId = request.nextUrl.searchParams.get("batchId");

    if (!batchId) {
      return NextResponse.json(
        { success: false, error: "Se requiere batchId." },
        { status: 400 }
      );
    }

    const conversions = await getBatchConversions(batchId);
    return NextResponse.json({
      success: true,
      conversions,
    });
  } catch (error) {
    console.error("Error en GET /api/datalab/convert:", error);
    const message =
      error instanceof Error ? error.message : "Error al obtener conversiones.";
    return NextResponse.json({ success: false, error: message }, { status: 200 });
  }
}

/**
 * POST /api/datalab/convert
 * Inicia la conversión de un documento PDF a Markdown usando el pipeline de Datalab.
 * 
 * Body JSON:
 * {
 *   batchId: string,
 *   fileId: string,
 *   pipelineId?: string, // por defecto pl_5iTkoae17RXU
 *   pageRange?: string, // opcional, ej: "0" o "0-2"
 *   useDirectConvert?: boolean // si es true usa /convert directo
 * }
 */
export async function POST(request: NextRequest) {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "El cuerpo de la solicitud no es un JSON válido." },
        { status: 400 }
      );
    }

    const {
      batchId,
      fileId,
      pipelineId = DEFAULT_PIPELINE_ID,
      pageRange,
      useDirectConvert,
    } = body || {};

    if (!batchId || !fileId) {
      return NextResponse.json(
        { success: false, error: "Se requieren batchId y fileId para convertir el documento." },
        { status: 400 }
      );
    }

    const summary = await getBatchSummary(batchId);
    if (!summary) {
      return NextResponse.json(
        { success: false, error: `No se encontró el lote ${batchId}. Si recargaste la página, vuelve a cargar el lote.` },
        { status: 404 }
      );
    }

    const targetFile = summary.files.find((f) => f.id === fileId);
    if (!targetFile) {
      return NextResponse.json(
        { success: false, error: `No se encontró el archivo ${fileId} en el lote.` },
        { status: 404 }
      );
    }

    // Marcar como en proceso
    await updateConversionRecord(batchId, fileId, targetFile.name, {
      status: "converting",
      pipelineId,
      error: undefined,
    });

    try {
      let result;
      if (useDirectConvert) {
        result = await runDatalabDirectConvert(
          targetFile.absolutePath,
          targetFile.name,
          { pageRange, mode: "balanced" }
        );
      } else {
        result = await runDatalabPipeline(
          targetFile.absolutePath,
          targetFile.name,
          { pipelineId, pageRange }
        );
      }

      if (!result.success) {
        const errorRecord = await updateConversionRecord(
          batchId,
          fileId,
          targetFile.name,
          {
            status: "error",
            error: result.error || "La conversión falló en Datalab.",
            pipelineId,
            executionId: result.executionId,
          }
        );
        return NextResponse.json({
          success: false,
          error: result.error,
          record: errorRecord,
        });
      }

      // Guardar Markdown y metadatos
      const record = await saveMarkdownResult(
        batchId,
        fileId,
        targetFile.name,
        result.markdown,
        {
          status: "completed",
          pipelineId,
          executionId: result.executionId,
          pageCount: result.pageCount,
          runtimeSeconds: result.runtimeSeconds,
          totalTokens: result.totalTokens,
        }
      );

      return NextResponse.json({
        success: true,
        record,
      });
    } catch (conversionError) {
      const errMsg =
        conversionError instanceof Error
          ? conversionError.message
          : "Error durante la ejecución del pipeline.";

      const errorRecord = await updateConversionRecord(
        batchId,
        fileId,
        targetFile.name,
        {
          status: "error",
          error: errMsg,
          pipelineId,
        }
      );

      return NextResponse.json({
        success: false,
        error: errMsg,
        record: errorRecord,
      });
    }
  } catch (error) {
    console.error("Error en POST /api/datalab/convert:", error);
    const message =
      error instanceof Error ? error.message : "Error al procesar la conversión.";
    return NextResponse.json({ success: false, error: message }, { status: 200 });
  }
}
