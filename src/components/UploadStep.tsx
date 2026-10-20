"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  UploadCloud,
  FileArchive,
  FileText,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ArrowRight,
  Search,
  Sparkles,
  Loader2,
  FolderSync,
  HardDrive,
  Check,
} from "lucide-react";
import { TOOL_SLUG } from "@/pradem.config";
import type { BatchSummary, StoredPdfInfo } from "@/lib/temp-storage";
import {
  getAllClientDocuments,
  saveClientDocument,
  saveClientDocuments,
  clearAllClientDocuments,
  type ClientPdfDocument,
} from "@/lib/client-pdf-storage";

interface UploadStepProps {
  initialBatch?: BatchSummary | null;
  onBatchLoaded?: (batch: BatchSummary) => void;
  onProceedToStep2?: (batch: BatchSummary) => void;
  onBatchCleared?: () => void;
}

export default function UploadStep({
  initialBatch = null,
  onBatchLoaded,
  onProceedToStep2,
  onBatchCleared,
}: UploadStepProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchData, setBatchData] = useState<BatchSummary | null>(initialBatch);
  const [filterAnexoOnly, setFilterAnexoOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [localFolderPath, setLocalFolderPath] = useState("anexo3PaqueteAdicional");

  // Documentos guardados persistentemente en el cliente (IndexedDB)
  const [clientDocs, setClientDocs] = useState<ClientPdfDocument[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cargar documentos guardados en el navegador
  const loadStoredClientDocs = async () => {
    try {
      const docs = await getAllClientDocuments();
      setClientDocs(docs);
    } catch (err) {
      console.warn("No se pudieron cargar los documentos locales de IndexedDB:", err);
    }
  };

  useEffect(() => {
    loadStoredClientDocs();
  }, []);

  useEffect(() => {
    if (initialBatch) {
      setBatchData(initialBatch);
    }
  }, [initialBatch]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleSelectedFile(e.target.files[0]);
    }
  };

  const handleSelectedFile = (selectedFile: File) => {
    setError(null);
    const ext = selectedFile.name.toLowerCase();
    if (!ext.endsWith(".pdf") && !ext.endsWith(".zip")) {
      setError("Por favor selecciona un archivo con extensión .pdf o .zip.");
      return;
    }
    setFile(selectedFile);
  };

  // Guardar archivo individual o lote en IndexedDB
  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const endpoint = `/${TOOL_SLUG}/api/upload`;
      const res = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Ocurrió un error al subir el archivo.");
      }

      const summary: BatchSummary = json.data;
      setBatchData(summary);
      onBatchLoaded?.(summary);

      // Limpiar documentos previos de la base de datos local (IndexedDB) al cargar un nuevo archivo
      await clearAllClientDocuments();

      // Guardar en IndexedDB del cliente: nuevos documentos del lote
      const docsToStore: ClientPdfDocument[] = summary.files.map((f) => ({
        name: f.name,
        sizeBytes: f.sizeBytes,
        formattedSize: f.formattedSize,
        isAnexo3: f.isAnexo3,
        blob: file.name === f.name ? file : undefined,
        status: "idle",
        uploadedAt: new Date().toISOString(),
      }));

      await saveClientDocuments(docsToStore);
      await loadStoredClientDocs();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Error inesperado al subir el archivo.");
    } finally {
      setUploading(false);
    }
  };

  // Cargar rápidamente el lote local de prueba (anexo3Paquete)
  const handleLoadLocalFolder = async () => {
    setLoadingLocal(true);
    setError(null);

    try {
      const endpoint = `/${TOOL_SLUG}/api/upload`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          loadLocalFolder: true,
          folderPath: localFolderPath
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "No se pudo cargar la carpeta local.");
      }

      const summary: BatchSummary = json.data;
      setBatchData(summary);
      onBatchLoaded?.(summary);

      // Limpiar documentos previos de la base de datos local (IndexedDB) al cargar un nuevo lote
      await clearAllClientDocuments();

      // Guardar en IndexedDB del cliente los nuevos archivos
      const docsToStore: ClientPdfDocument[] = summary.files.map((f) => ({
        name: f.name,
        sizeBytes: f.sizeBytes,
        formattedSize: f.formattedSize,
        isAnexo3: f.isAnexo3,
        status: "idle",
        uploadedAt: new Date().toISOString(),
      }));

      await saveClientDocuments(docsToStore);
      await loadStoredClientDocs();
    } catch (err) {
      console.error("Error al cargar carpeta local:", err);
      setError(
        err instanceof Error ? err.message : "Error al cargar carpeta local anexo3Paquete."
      );
    } finally {
      setLoadingLocal(false);
    }
  };

  const handleClearClientStorage = async () => {
    if (!confirm("¿Deseas vaciar todos los archivos guardados en el almacenamiento local del navegador?")) {
      return;
    }
    await clearAllClientDocuments();
    setClientDocs([]);
    setBatchData(null);
    setFile(null);
    onBatchCleared?.();
  };

  const handleCancelAndCleanup = async () => {
    if (!batchData) {
      setFile(null);
      setError(null);
      return;
    }

    setIsDeleting(true);
    try {
      const endpoint = `/${TOOL_SLUG}/api/upload`;
      await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: batchData.batchId }),
      });
    } catch (err) {
      console.error("Error al limpiar lote:", err);
    } finally {
      await clearAllClientDocuments();
      await loadStoredClientDocs();
      setBatchData(null);
      setFile(null);
      setError(null);
      setIsDeleting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onBatchCleared?.();
    }
  };

  const filteredFiles = (batchData?.files || []).filter((f) => {
    if (filterAnexoOnly && !f.isAnexo3) return false;
    if (searchQuery.trim()) {
      return (
        f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.relativePath.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    return true;
  });

  return (
    <div className="space-y-8">
      {/* ── Stepper Visual del Pipeline ── */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/50 bg-emerald-500/15 p-3 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/30">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 font-bold text-white text-xs">
            1
          </div>
          <div>
            <div className="text-xs font-bold text-emerald-300">Paso 1 (Activo)</div>
            <div className="text-xs text-white font-medium">Subida y Almacenamiento</div>
          </div>
        </div>

        <button
          type="button"
          disabled={!batchData && clientDocs.length === 0}
          onClick={() => {
            if (batchData) onProceedToStep2?.(batchData);
            else if (clientDocs.length > 0) {
              // Si ya hay archivos en IndexedDB, crear un batch dummy para continuar
              onProceedToStep2?.({
                batchId: "client-storage-batch",
                originalFileName: "Almacenamiento Local",
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
              });
            }
          }}
          className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
            batchData || clientDocs.length > 0
              ? "border-white/10 bg-white/5 hover:bg-white/10 cursor-pointer"
              : "border-white/5 bg-white/[0.02] opacity-50 cursor-not-allowed"
          }`}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 font-bold text-slate-400 text-xs">
            2
          </div>
          <div>
            <div className="text-xs font-medium text-slate-400">Paso 2</div>
            <div className="text-xs text-slate-300">unpdf Local a Markdown</div>
          </div>
        </button>

        <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3 opacity-60">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 font-bold text-slate-400 text-xs">
            3
          </div>
          <div>
            <div className="text-xs font-medium text-slate-400">Paso 3</div>
            <div className="text-xs text-slate-300">Extracción de Asignaturas</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3 opacity-60">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 font-bold text-slate-400 text-xs">
            4
          </div>
          <div>
            <div className="text-xs font-medium text-slate-400">Paso 4</div>
            <div className="text-xs text-slate-300">Carga a Supabase</div>
          </div>
        </div>
      </div>

      {/* ── Aviso de Archivos Guardados en el Navegador ── */}
      {clientDocs.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between p-4 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-300">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-white flex items-center gap-2">
                Almacenamiento Local (IndexedDB)
                <span className="rounded bg-indigo-500/30 px-2 py-0.5 text-[10px] text-indigo-200">
                  {clientDocs.length} archivo(s) guardado(s)
                </span>
              </h4>
              <p className="text-[11px] text-slate-300 mt-0.5">
                Los archivos se conservan en tu navegador. Al cargar un nuevo archivo, los archivos previos de la base de datos local se eliminan automáticamente.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClearClientStorage}
              className="text-xs text-slate-400 hover:text-rose-400 px-3 py-1.5 rounded-lg border border-white/10 hover:border-rose-500/30 transition cursor-pointer"
            >
              Vaciar navegador
            </button>
            <button
              type="button"
              onClick={() => {
                const effectiveBatch: BatchSummary = batchData || {
                  batchId: "client-storage-batch",
                  originalFileName: "Almacenamiento Local",
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
                onProceedToStep2?.(effectiveBatch);
              }}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white shadow-md shadow-emerald-500/20 hover:bg-emerald-500 transition cursor-pointer"
            >
              Ir a Paso 2: Explorador de Tabs
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Zona de Carga ── */}
      {!batchData ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/5 pb-4">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <UploadCloud className="h-5 w-5 text-emerald-400" />
                Subida de Archivos para Extracción con unpdf
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Puedes subir un PDF individual o un archivo ZIP comprimido (como el paquete con los Anexo 3).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300 border border-emerald-500/20">
                <Sparkles className="h-3 w-3" />
                Extracción Local sin Costo
              </span>
            </div>
          </div>

          {/* Drag & Drop Area */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition-all cursor-pointer ${
              isDragging
                ? "border-emerald-400 bg-emerald-500/10 scale-[1.005]"
                : "border-white/15 bg-white/[0.01] hover:border-emerald-500/50 hover:bg-white/[0.03]"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.zip"
              onChange={handleFileInputChange}
              className="hidden"
            />

            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400 ring-8 ring-emerald-500/5 group-hover:scale-105 transition-transform">
              {file?.name.endsWith(".zip") ? (
                <FileArchive className="h-8 w-8 text-amber-400" />
              ) : file?.name.endsWith(".pdf") ? (
                <FileText className="h-8 w-8 text-emerald-400" />
              ) : (
                <UploadCloud className="h-8 w-8" />
              )}
            </div>

            {file ? (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">{file.name}</p>
                <p className="text-xs text-slate-400">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB • Haz clic o arrastra para cambiar archivo
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium text-white">
                  Arrastra y suelta tu archivo aquí, o{" "}
                  <span className="text-emerald-400 underline decoration-emerald-400/30 underline-offset-4">
                    haz clic para explorar
                  </span>
                </p>
                <p className="text-xs text-slate-400">
                  Formatos admitidos: <span className="font-semibold text-slate-300">.PDF</span> o{" "}
                  <span className="font-semibold text-slate-300">.ZIP</span> (paquete masivo)
                </p>
              </div>
            )}
          </div>

          {/* Opción rápida de desarrollo: Cargar anexo3Paquete */}
          <div className="flex flex-col sm:flex-row items-center justify-between p-4 rounded-xl border border-white/5 bg-white/[0.01] gap-3">
            <div className="flex-1 flex flex-col gap-2">
              <div className="text-xs text-slate-400">
                <span className="font-semibold text-slate-300">¿Pruebas en local?</span> Puedes sincronizar un directorio de tu repositorio.
              </div>
              <input 
                type="text" 
                value={localFolderPath} 
                onChange={(e) => setLocalFolderPath(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-md px-2 py-1.5 focus:outline-none focus:border-emerald-500/50"
                placeholder="Ej. anexo3PaqueteAdicional"
              />
            </div>
            <button
              type="button"
              disabled={loadingLocal || uploading || !localFolderPath}
              onClick={handleLoadLocalFolder}
              className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition disabled:opacity-50 whitespace-nowrap cursor-pointer mt-auto"
            >
              {loadingLocal ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Sincronizando...
                </>
              ) : (
                <>
                  <FolderSync className="h-3.5 w-3.5" />
                  ⚡ Cargar carpeta
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300">
              <AlertCircle className="h-4 w-4 flex-shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {file && (
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                  setError(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                disabled={uploading}
                className="rounded-lg px-4 py-2.5 text-xs font-medium text-slate-400 hover:text-white transition hover:bg-white/5 cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-2.5 text-xs font-semibold text-white shadow-lg shadow-emerald-500/25 hover:from-emerald-500 hover:to-teal-500 transition disabled:opacity-50 cursor-pointer"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Procesando y guardando...
                  </>
                ) : (
                  <>
                    <ArrowRight className="h-4 w-4" />
                    Subir y Guardar en Navegador
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      ) : (
        /* ── Resumen de Archivos Subidos y Descomprimidos ── */
        <div className="space-y-6">
          {/* Header informativo del lote */}
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-6 backdrop-blur-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-white">
                      Archivos cargados y sincronizados en IndexedDB
                    </h3>
                    <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-mono text-emerald-300 uppercase">
                      {batchData.fileType}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1">
                    Nombre: <span className="font-mono text-white">{batchData.originalFileName}</span> • Total PDFs:{" "}
                    <span className="font-mono text-emerald-300 font-semibold">{batchData.totalPdfs}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancelAndCleanup}
                  disabled={isDeleting}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-rose-500/10 hover:border-rose-500/30 hover:text-rose-300 transition cursor-pointer"
                >
                  {isDeleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5 text-slate-400" />
                  )}
                  Limpiar lote
                </button>
              </div>
            </div>

            {/* Métricas rápidas */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-6 pt-6 border-t border-emerald-500/15">
              <div className="rounded-xl bg-white/[0.03] p-3 border border-white/5">
                <div className="text-[11px] text-slate-400">Total PDFs encontrados</div>
                <div className="text-xl font-bold text-white mt-0.5">{batchData.totalPdfs}</div>
              </div>

              <div className="rounded-xl bg-emerald-500/10 p-3 border border-emerald-500/20">
                <div className="text-[11px] text-emerald-300 flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  Anexo 3 detectados
                </div>
                <div className="text-xl font-bold text-emerald-200 mt-0.5">{batchData.anexo3Count}</div>
              </div>

              <div className="rounded-xl bg-white/[0.03] p-3 border border-white/5 col-span-2 sm:col-span-1">
                <div className="text-[11px] text-slate-400">Almacenamiento Cliente</div>
                <div className="text-xs font-mono text-emerald-300 mt-1 truncate">
                  IndexedDB Persistente
                </div>
              </div>
            </div>
          </div>

          {/* Lista de archivos encontrados */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-white">Documentos PDF Disponibles</h4>
                <p className="text-xs text-slate-400">
                  Mostrando {filteredFiles.length} de {batchData.files.length} archivos
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Filtrar por nombre..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 rounded-lg border border-white/10 bg-white/5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setFilterAnexoOnly(!filterAnexoOnly)}
                  className={`flex items-center gap-1.5 h-8 rounded-lg px-3 text-xs font-medium transition cursor-pointer ${
                    filterAnexoOnly
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                  }`}
                >
                  <Sparkles className="h-3 w-3" />
                  Solo Anexo 3 ({batchData.anexo3Count})
                </button>
              </div>
            </div>

            {/* Tabla / Lista */}
            <div className="max-h-96 overflow-y-auto rounded-xl border border-white/5 bg-black/20 divide-y divide-white/5">
              {filteredFiles.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No se encontraron archivos que coincidan con el filtro.
                </div>
              ) : (
                filteredFiles.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between p-3.5 hover:bg-white/[0.02] transition"
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-4">
                      <div
                        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
                          f.isAnexo3
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-white/5 text-slate-400"
                        }`}
                      >
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-medium text-white truncate" title={f.name}>
                            {f.name}
                          </p>
                          {f.isAnexo3 && (
                            <span className="flex-shrink-0 inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 border border-emerald-500/30">
                              <Sparkles className="h-2.5 w-2.5" />
                              Anexo 3
                            </span>
                          )}
                        </div>
                        {f.relativePath !== f.name && (
                          <p className="text-[11px] text-slate-500 truncate mt-0.5" title={f.relativePath}>
                            {f.relativePath}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex-shrink-0 text-right">
                      <span className="text-xs font-mono text-slate-400">{f.formattedSize}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Siguiente paso */}
            <div className="pt-4 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-white/5">
              <p className="text-xs text-slate-400">
                Lote preparado. Listo para navegar y extraer a Markdown con unpdf de forma ultrarrápida.
              </p>
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-2.5 text-xs font-semibold text-white shadow-lg shadow-emerald-500/25 hover:from-emerald-500 hover:to-teal-500 transition cursor-pointer"
                onClick={() => onProceedToStep2?.(batchData)}
              >
                Continuar a Paso 2: Explorador y Extracción (unpdf)
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
