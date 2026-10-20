import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

/**
 * POST /api/asignaturas/check-claves
 * Recibe un array de claves y retorna cuáles ya existen en la tabla `asignaturas_extraidas`.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { claves } = body || {};

    if (!Array.isArray(claves) || claves.length === 0) {
      return NextResponse.json({
        success: true,
        existingClaves: [],
        details: {},
      });
    }

    // Limpiar claves y eliminar vacías
    const cleanClaves = Array.from(
      new Set(
        claves
          .map((c: string) => (typeof c === "string" ? c.trim() : ""))
          .filter((c: string) => c.length > 0)
      )
    );

    if (cleanClaves.length === 0) {
      return NextResponse.json({
        success: true,
        existingClaves: [],
        details: {},
      });
    }

    const supabase = getSupabaseClient();
    // Consultar las claves existentes
    const { data, error } = await supabase
      .from("asignaturas_extraidas")
      .select("id, clave, nombre, created_at")
      .in("clave", cleanClaves);

    if (error) {
      console.error("Error al consultar claves en Supabase:", error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    const existingClaves: string[] = [];
    const details: Record<string, { id: number; nombre: string | null; created_at: string | null }> = {};

    (data || []).forEach((row) => {
      if (row.clave) {
        existingClaves.push(row.clave);
        details[row.clave] = {
          id: row.id,
          nombre: row.nombre,
          created_at: row.created_at,
        };
      }
    });

    return NextResponse.json({
      success: true,
      existingClaves,
      details,
      count: existingClaves.length,
    });
  } catch (err) {
    console.error("Error en POST /api/asignaturas/check-claves:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Error al verificar claves.",
      },
      { status: 500 }
    );
  }
}
