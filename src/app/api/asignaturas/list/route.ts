import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/asignaturas/list
 * Retorna las asignaturas registradas en public.asignaturas_extraidas.
 * Soporta búsqueda por nombre o clave y limit.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const query = searchParams.get("query")?.trim() || "";

    const supabase = getSupabaseClient();
    let req = supabase
      .from("asignaturas_extraidas")
      .select("id, created_at, nombre, clave, fines_de_aprendizaje_o_formacion, contenido_tematico, actividades_de_aprendizaje")
      .order("id", { ascending: false })
      .limit(limit);

    if (query) {
      req = req.or(`clave.ilike.%${query}%,nombre.ilike.%${query}%`);
    }

    const { data, error, count } = await req;

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Contar total general
    const { count: totalGeneral } = await supabase
      .from("asignaturas_extraidas")
      .select("*", { count: "exact", head: true });

    return NextResponse.json({
      success: true,
      data: data || [],
      totalCount: totalGeneral || (data || []).length,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Error al obtener asignaturas.",
      },
      { status: 500 }
    );
  }
}
