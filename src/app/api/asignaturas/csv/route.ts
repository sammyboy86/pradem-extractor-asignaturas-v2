import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/client";
import { generateSupabaseCsv, type AsignaturaCsvRow } from "@/lib/csv-export";

export const dynamic = "force-dynamic";

/**
 * GET /api/asignaturas/csv
 * Descarga las asignaturas existentes en public.asignaturas_extraidas como CSV formateado para Supabase.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "1000", 10);
    const query = searchParams.get("query")?.trim() || "";

    const supabase = getSupabaseClient();
    let req = supabase
      .from("asignaturas_extraidas")
      .select("nombre, clave, fines_de_aprendizaje_o_formacion, contenido_tematico, actividades_de_aprendizaje")
      .order("id", { ascending: false })
      .limit(limit);

    if (query) {
      req = req.or(`clave.ilike.%${query}%,nombre.ilike.%${query}%`);
    }

    const { data, error } = await req;

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const csvData = generateSupabaseCsv((data || []) as AsignaturaCsvRow[]);
    const dateStr = new Date().toISOString().slice(0, 10);

    return new NextResponse(csvData, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="asignaturas_supabase_${dateStr}.csv"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Error al generar archivo CSV.",
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/asignaturas/csv
 * Recibe un array de asignaturas en JSON y retorna el archivo CSV generado.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const items: AsignaturaCsvRow[] = Array.isArray(body.items)
      ? body.items
      : body.item
      ? [body.item]
      : [];

    const csvData = generateSupabaseCsv(items);
    const dateStr = new Date().toISOString().slice(0, 10);

    return new NextResponse(csvData, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="asignaturas_extraidas_${dateStr}.csv"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Error al procesar asignaturas para CSV.",
      },
      { status: 500 }
    );
  }
}
