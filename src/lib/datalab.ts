import fs from "fs/promises";
import fsSync from "fs";
import path from "path";

import { DEFAULT_PIPELINE_ID, DATALAB_API_BASE } from "@/lib/datalab-constants";
export { DEFAULT_PIPELINE_ID, DATALAB_API_BASE };

export interface PipelineStepResult {
  step_index: number;
  step_type: string;
  status: string;
  lookup_key?: string | null;
  result_url?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  error_message?: string | null;
}

export interface PipelineExecutionResponse {
  execution_id: string;
  pipeline_id: string;
  pipeline_version: number;
  status: "pending" | "running" | "completed" | "completed_with_errors" | "failed";
  steps: PipelineStepResult[];
  started_at?: string | null;
  completed_at?: string | null;
  created?: string | null;
  error?: string | null;
}

export interface DatalabConvertResult {
  success: boolean;
  markdown: string;
  pageCount?: number;
  runtimeSeconds?: number;
  totalTokens?: number;
  error?: string;
  executionId?: string;
  pipelineId?: string;
  metadata?: Record<string, any>;
}

/**
 * Obtiene la API Key de Datalab desde las variables de entorno o .env.local.
 */
export function getDatalabApiKey(): string {
  if (process.env.DATALAB_API_KEY && process.env.DATALAB_API_KEY.trim()) {
    return process.env.DATALAB_API_KEY.trim();
  }

  // Fallback: leer directamente de .env.local por si el servidor dev no se ha reiniciado
  try {
    const envPath = path.join(process.cwd(), ".env.local");
    if (fsSync.existsSync(envPath)) {
      const content = fsSync.readFileSync(envPath, "utf-8");
      const match = content.match(/^DATALAB_API_KEY\s*=\s*(.+)$/m);
      if (match && match[1]) {
        const val = match[1].trim().replace(/^['"]|['"]$/g, "");
        if (val) {
          process.env.DATALAB_API_KEY = val;
          return val;
        }
      }
    }
  } catch (err) {
    console.warn("No se pudo leer .env.local directamente:", err);
  }

  throw new Error(
    "DATALAB_API_KEY no está configurada. Por favor define DATALAB_API_KEY en .env.local."
  );
}

/**
 * Ejecuta el pipeline de Datalab sobre un archivo en disco.
 * 
 * Sigue el patrón documentado:
 * 1. POST https://www.datalab.to/api/v1/pipelines/{pipeline_id}/run
 * 2. Polling a https://www.datalab.to/api/v1/pipelines/executions/{execution_id}
 * 3. GET https://www.datalab.to/api/v1/pipelines/executions/{execution_id}/steps/0/result
 *
 * @param filePath Ruta absoluta al archivo PDF en el sistema de archivos
 * @param fileName Nombre del archivo para adjuntar en FormData
 * @param options Opciones adicionales (pipelineId, pageRange, timeoutMs)
 */
export async function runDatalabPipeline(
  filePath: string,
  fileName: string,
  options?: {
    pipelineId?: string;
    pageRange?: string;
    timeoutSeconds?: number;
    pollIntervalMs?: number;
  }
): Promise<DatalabConvertResult> {
  const apiKey = getDatalabApiKey();
  const pipelineId = options?.pipelineId || DEFAULT_PIPELINE_ID;
  const timeoutSeconds = options?.timeoutSeconds || 300; // 5 minutos máximo
  const pollIntervalMs = options?.pollIntervalMs || 2000; // 2 segundos entre sondeos

  if (!fsSync.existsSync(filePath)) {
    throw new Error(`El archivo a procesar no existe en la ruta: ${filePath}`);
  }

  // 1. Leer archivo y preparar FormData
  const fileBuffer = await fs.readFile(filePath);
  const fileBlob = new Blob([fileBuffer], { type: "application/pdf" });

  const formData = new FormData();
  formData.append("file", fileBlob, fileName);
  formData.append("output_format", "markdown");

  if (options?.pageRange) {
    formData.append("page_range", options.pageRange);
  }

  // 2. Iniciar ejecución del pipeline
  const runUrl = `${DATALAB_API_BASE}/pipelines/${pipelineId}/run`;
  const submitRes = await fetch(runUrl, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
    },
    body: formData,
  });

  if (!submitRes.ok) {
    let errorDetail = submitRes.statusText;
    try {
      const errJson = await submitRes.json();
      errorDetail = JSON.stringify(errJson);
    } catch {
      // Ignorar si no es json
    }
    throw new Error(
      `Error al iniciar el pipeline en Datalab (${submitRes.status}): ${errorDetail}`
    );
  }

  const submitData: PipelineExecutionResponse = await submitRes.json();
  const executionId = submitData.execution_id;

  if (!executionId) {
    throw new Error("Datalab no retornó un execution_id válido.");
  }

  // 3. Sondeo (Polling) hasta completar
  const startTime = Date.now();
  const maxTime = startTime + timeoutSeconds * 1000;

  while (Date.now() < maxTime) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

    const pollRes = await fetch(
      `${DATALAB_API_BASE}/pipelines/executions/${executionId}`,
      {
        headers: {
          "X-API-Key": apiKey,
        },
      }
    );

    if (!pollRes.ok) {
      console.warn(
        `Error temporal en sondeo de ejecución ${executionId}: status ${pollRes.status}`
      );
      continue;
    }

    const pollData: PipelineExecutionResponse = await pollRes.json();

    if (pollData.status === "completed") {
      // 4. Obtener el resultado del paso de conversión (paso 0)
      const resultUrl = `${DATALAB_API_BASE}/pipelines/executions/${executionId}/steps/0/result`;
      const stepRes = await fetch(resultUrl, {
        headers: {
          "X-API-Key": apiKey,
        },
      });

      if (!stepRes.ok) {
        throw new Error(
          `No se pudo obtener el resultado del paso en Datalab (${stepRes.status})`
        );
      }

      const stepData = await stepRes.json();

      return {
        success: true,
        markdown: stepData.markdown || "",
        pageCount: stepData.page_count ?? stepData.total_pages ?? undefined,
        runtimeSeconds: stepData.runtime ?? (Date.now() - startTime) / 1000,
        totalTokens: stepData.total_tokens ?? undefined,
        executionId,
        pipelineId,
        metadata: {
          metadata: stepData.metadata,
          links: stepData.links,
        },
      };
    }

    if (pollData.status === "failed" || pollData.status === "completed_with_errors") {
      const stepErrors = pollData.steps
        .filter((s) => s.error_message)
        .map((s) => `Paso ${s.step_index}: ${s.error_message}`)
        .join("; ");
      const msg = stepErrors || pollData.error || "La ejecución del pipeline falló en Datalab.";
      return {
        success: false,
        markdown: "",
        error: msg,
        executionId,
        pipelineId,
      };
    }
  }

  throw new Error(
    `Tiempo de espera agotado (${timeoutSeconds}s) esperando a Datalab para el archivo: ${fileName}`
  );
}

/**
 * Método alternativo de conversión directa (POST /api/v1/convert)
 * En caso de que se desee omitir el pipeline o como método de respaldo.
 */
export async function runDatalabDirectConvert(
  filePath: string,
  fileName: string,
  options?: {
    pageRange?: string;
    mode?: "fast" | "balanced" | "accurate";
    timeoutSeconds?: number;
    pollIntervalMs?: number;
  }
): Promise<DatalabConvertResult> {
  const apiKey = getDatalabApiKey();
  const timeoutSeconds = options?.timeoutSeconds || 300;
  const pollIntervalMs = options?.pollIntervalMs || 2000;

  const fileBuffer = await fs.readFile(filePath);
  const fileBlob = new Blob([fileBuffer], { type: "application/pdf" });

  const formData = new FormData();
  formData.append("file", fileBlob, fileName);
  formData.append("output_format", "markdown");
  formData.append("mode", options?.mode || "balanced");

  if (options?.pageRange) {
    formData.append("page_range", options.pageRange);
  }

  const submitRes = await fetch(`${DATALAB_API_BASE}/convert`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
    },
    body: formData,
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`Error al iniciar /convert en Datalab (${submitRes.status}): ${errText}`);
  }

  const submitData = await submitRes.json();
  const checkUrl = submitData.request_check_url;

  if (!checkUrl) {
    throw new Error("Datalab no retornó request_check_url.");
  }

  const startTime = Date.now();
  const maxTime = startTime + timeoutSeconds * 1000;

  while (Date.now() < maxTime) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

    const pollRes = await fetch(checkUrl, {
      headers: {
        "X-API-Key": apiKey,
      },
    });

    if (!pollRes.ok) continue;

    const result = await pollRes.json();

    if (result.status === "complete") {
      return {
        success: true,
        markdown: result.markdown || "",
        pageCount: result.page_count,
        runtimeSeconds: (Date.now() - startTime) / 1000,
        metadata: result.metadata,
      };
    } else if (result.status === "error" || result.status === "failed") {
      return {
        success: false,
        markdown: "",
        error: result.error || "Error al procesar documento con /convert",
      };
    }
  }

  throw new Error(`Tiempo de espera agotado esperando /convert para ${fileName}`);
}
