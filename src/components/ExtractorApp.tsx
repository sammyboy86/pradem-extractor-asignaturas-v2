"use client";

import React, { useState, useEffect } from "react";
import UploadStep from "@/components/UploadStep";
import MarkdownExplorerStep from "@/components/MarkdownExplorerStep";
import RegexExtractionStep from "@/components/RegexExtractionStep";
import type { BatchSummary } from "@/lib/temp-storage";
import { TOOL_SLUG } from "@/pradem.config";
import { Loader2 } from "lucide-react";
import { getAllClientDocuments } from "@/lib/client-pdf-storage";

export default function ExtractorApp() {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [batchData, setBatchData] = useState<BatchSummary | null>(null);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);

  // Intentar restaurar el último lote y documentos persistidos en IndexedDB al iniciar
  useEffect(() => {
    async function restoreSession() {
      try {
        let restoredBatch: BatchSummary | null = null;
        const savedBatchId = localStorage.getItem("pradem_extractor_batch_id");

        if (savedBatchId) {
          const endpoint = `/${TOOL_SLUG}/api/upload?batchId=${savedBatchId}`;
          const res = await fetch(endpoint);
          if (res.ok) {
            const json = await res.json();
            if (json.success && json.data) {
              restoredBatch = json.data;
              setBatchData(restoredBatch);
            }
          }
        }

        // Si no había batch en servidor, verificar si hay documentos guardados en IndexedDB
        if (!restoredBatch) {
          const clientDocs = await getAllClientDocuments();
          if (clientDocs.length > 0) {
            restoredBatch = {
              batchId: "local-indexeddb",
              originalFileName: "Documentos en Navegador",
              fileType: "pdf",
              uploadedAt: new Date().toISOString(),
              totalPdfs: clientDocs.length,
              anexo3Count: clientDocs.filter((d) => d.isAnexo3).length,
              files: clientDocs.map((d) => ({
                id: d.name,
                name: d.name,
                relativePath: d.name,
                sizeBytes: d.sizeBytes,
                formattedSize: d.formattedSize,
                isAnexo3: d.isAnexo3,
                absolutePath: "",
              })),
            };
            setBatchData(restoredBatch);
          }
        }

        // Restaurar paso guardado si hay datos disponibles
        const savedStep = localStorage.getItem("pradem_extractor_step");
        if (savedStep && restoredBatch) {
          const stepNum = parseInt(savedStep, 10);
          if (stepNum === 2 || stepNum === 3) {
            setCurrentStep(stepNum);
          }
        }
      } catch (err) {
        console.warn("No se pudo restaurar la sesión previa:", err);
      } finally {
        setLoadingInitial(false);
      }
    }

    restoreSession();
  }, []);

  const handleBatchLoaded = (batch: BatchSummary | null) => {
    setBatchData(batch);
    if (batch?.batchId) {
      localStorage.setItem("pradem_extractor_batch_id", batch.batchId);
    } else {
      localStorage.removeItem("pradem_extractor_batch_id");
    }
  };

  const handleBatchCleared = () => {
    setBatchData(null);
    localStorage.removeItem("pradem_extractor_batch_id");
    localStorage.removeItem("pradem_extractor_step");
    setCurrentStep(1);
  };

  const handleProceedToStep2 = (batch: BatchSummary) => {
    setBatchData(batch);
    setCurrentStep(2);
    localStorage.setItem("pradem_extractor_step", "2");
    if (batch.batchId) {
      localStorage.setItem("pradem_extractor_batch_id", batch.batchId);
    }
  };

  const handleBackToStep1 = () => {
    setCurrentStep(1);
    localStorage.setItem("pradem_extractor_step", "1");
  };

  const handleProceedToStep3 = () => {
    setCurrentStep(3);
    localStorage.setItem("pradem_extractor_step", "3");
  };

  const handleBackToStep2 = () => {
    setCurrentStep(2);
    localStorage.setItem("pradem_extractor_step", "2");
  };

  if (loadingInitial) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
      </div>
    );
  }

  // Paso 3: Filtros Regex y Tabla Supabase
  if (currentStep === 3 && batchData) {
    return (
      <RegexExtractionStep
        batchData={batchData}
        onBackToStep2={handleBackToStep2}
      />
    );
  }

  // Paso 2: Conversión y Explorador Markdown con unpdf
  if (currentStep === 2 && batchData) {
    return (
      <MarkdownExplorerStep
        batchData={batchData}
        onBackToStep1={handleBackToStep1}
        onProceedToStep3={handleProceedToStep3}
      />
    );
  }

  // Paso 1: Subida de Archivos y Almacenamiento en Cliente
  return (
    <UploadStep
      initialBatch={batchData}
      onBatchLoaded={handleBatchLoaded}
      onProceedToStep2={handleProceedToStep2}
      onBatchCleared={handleBatchCleared}
    />
  );
}
