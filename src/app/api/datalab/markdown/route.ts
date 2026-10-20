import { NextRequest, NextResponse } from "next/server";
import { getMarkdownResult } from "@/lib/temp-storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/datalab/markdown?batchId=xyz&fileId=abc
 * Retorna el contenido markdown y los metadatos de un archivo convertido.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId");
    const fileId = searchParams.get("fileId");

    if (!batchId || !fileId) {
      return NextResponse.json(
        { error: "Se requieren batchId y fileId." },
        { status: 400 }
      );
    }

    const result = await getMarkdownResult(batchId, fileId);

    if (!result) {
      return NextResponse.json(
        { error: "No se encontró el resultado de Markdown para este archivo." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      fileId,
      markdown: result.markdown,
      record: result.record,
    });
  } catch (error) {
    console.error("Error en GET /api/datalab/markdown:", error);
    const message =
      error instanceof Error ? error.message : "Error al obtener el Markdown.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
