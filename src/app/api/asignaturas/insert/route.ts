import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export interface AsignaturaInsertPayload {
  nombre: string | null;
  clave: string | null;
  fines_de_aprendizaje_o_formacion: string | null;
  contenido_tematico: string | null;
  actividades_de_aprendizaje: string | null;
  embedding_contenido_tematico?: any | null;
  embedding_actividades_aprendizaje?: any | null;
}

/**
 * POST /api/asignaturas/insert
 * Inserta asignaturas en public.asignaturas_extraidas.
 * Si encuentra que la `clave` ya existe en la tabla:
 * NO sube ese registro y lo reporta al usuario en el arreglo `skipped`.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const items: AsignaturaInsertPayload[] = Array.isArray(body.items)
      ? body.items
      : body.item
      ? [body.item]
      : [];

    if (items.length === 0) {
      return NextResponse.json(
        { success: false, error: "No se proporcionaron asignaturas para insertar." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // 1. Extraer todas las claves con valor para verificar duplicados en la base de datos
    const incomingClaves = items
      .map((i) => (i.clave ? i.clave.trim() : ""))
      .filter((c) => c.length > 0);

    const existingClavesSet = new Set<string>();

    if (incomingClaves.length > 0) {
      const { data: existingRows, error: checkError } = await supabase
        .from("asignaturas_extraidas")
        .select("id, clave, nombre")
        .in("clave", incomingClaves);

      if (checkError) {
        console.error("Error al verificar duplicados en Supabase:", checkError);
        return NextResponse.json(
          { success: false, error: `Error verificando claves: ${checkError.message}` },
          { status: 500 }
        );
      }

      (existingRows || []).forEach((r) => {
        if (r.clave) {
          existingClavesSet.add(r.clave.trim().toUpperCase());
        }
      });
    }

    const toInsert: AsignaturaInsertPayload[] = [];
    const skipped: { item: AsignaturaInsertPayload; reason: string }[] = [];
    const seenInBatch = new Set<string>();

    for (const item of items) {
      const cleanClave = item.clave ? item.clave.trim() : "";
      const upperClave = cleanClave.toUpperCase();

      // Regla: si ya existe en la tabla de Supabase, no sube ese registro
      if (cleanClave && existingClavesSet.has(upperClave)) {
        skipped.push({
          item,
          reason: `La clave "${cleanClave}" ya existe registrada en la tabla de Supabase.`,
        });
        continue;
      }

      // Regla: evitar duplicados dentro del mismo lote entrante
      if (cleanClave && seenInBatch.has(upperClave)) {
        skipped.push({
          item,
          reason: `La clave "${cleanClave}" está duplicada dentro del mismo lote a subir.`,
        });
        continue;
      }

      if (cleanClave) {
        seenInBatch.add(upperClave);
      }

      toInsert.push({
        nombre: item.nombre?.trim() || null,
        clave: cleanClave || null,
        fines_de_aprendizaje_o_formacion:
          item.fines_de_aprendizaje_o_formacion?.trim() || null,
        contenido_tematico: item.contenido_tematico?.trim() || null,
        actividades_de_aprendizaje:
          item.actividades_de_aprendizaje?.trim() || null,
        embedding_contenido_tematico: item.embedding_contenido_tematico || null,
        embedding_actividades_aprendizaje:
          item.embedding_actividades_aprendizaje || null,
      });
    }

    let insertedRecords: any[] = [];

    if (toInsert.length > 0) {
      const { data, error: insertError } = await supabase
        .from("asignaturas_extraidas")
        .insert(toInsert)
        .select();

      if (insertError) {
        console.error("Error al insertar asignaturas en Supabase:", insertError);
        return NextResponse.json(
          { success: false, error: insertError.message, skipped },
          { status: 500 }
        );
      }

      insertedRecords = data || [];
    }

    return NextResponse.json({
      success: true,
      totalRequested: items.length,
      insertedCount: insertedRecords.length,
      skippedCount: skipped.length,
      inserted: insertedRecords,
      skipped,
      message:
        insertedRecords.length > 0
          ? `Se subieron ${insertedRecords.length} asignatura(s) exitosamente.${
              skipped.length > 0
                ? ` Se omitieron ${skipped.length} porque su clave ya existía.`
                : ""
            }`
          : `No se subieron registros: ${skipped.length} registro(s) fueron omitidos porque su clave ya existe en Supabase.`,
    });
  } catch (err) {
    console.error("Error en POST /api/asignaturas/insert:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Error al insertar asignaturas.",
      },
      { status: 500 }
    );
  }
}
