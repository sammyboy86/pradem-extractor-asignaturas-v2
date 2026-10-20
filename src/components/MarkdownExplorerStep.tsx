"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FileText,
  Sparkles,
  Play,
  RotateCw,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Download,
  Search,
  X,
  Columns,
  Eye,
  Code,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Pause,
  Zap,
  HardDrive,
  FileCode,
  Layers,
  Trash2,
  Settings2,
  Calculator,
  ArrowDownUp,
} from "lucide-react";
import { TOOL_SLUG } from "@/pradem.config";
import type { BatchSummary } from "@/lib/temp-storage";
import {
  getAllClientDocuments,
  saveClientDocument,
  saveClientDocuments,
  updateClientDocumentMarkdown,
  updateClientDocumentStatus,
  deleteClientDocument,
  type ClientPdfDocument,
} from "@/lib/client-pdf-storage";

interface MarkdownExplorerStepProps {
  batchData: BatchSummary;
  onBackToStep1: () => void;
  onProceedToStep3: () => void;
}

export default function MarkdownExplorerStep({
  batchData,
  onBackToStep1,
  onProceedToStep3,
}: MarkdownExplorerStepProps) {
  // Lista de documentos persistidos en IndexedDB del cliente
  const [documents, setDocuments] = useState<ClientPdfDocument[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(true);

  // Pestañas abiertas (lista de nombres de archivo exactos)
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  // Pestaña activa (nombre del archivo)
  const [activeTabName, setActiveTabName] = useState<string | null>(null);

  // Estados de interfaz y filtrado
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "anexo3" | "completed" | "pending">("all");
  const [viewMode, setViewMode] = useState<"rendered" | "raw" | "split">("rendered");
  const [copied, setCopied] = useState(false);

  // Estado de extracción masiva
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, currentName: "" });
  const stopBatchRef = useRef(false);

  // Estados para el calculador de asignaturas
  const [showSubjectCalculator, setShowSubjectCalculator] = useState(false);
  const [calcDelimiter, setCalcDelimiter] = useState("### DENOMINACIÓN DE LA ASIGNATURA");
  const [calcClaveRegex, setCalcClaveRegex] = useState("\\b([A-Z]{2,6}-?\\d{2,5}[A-Z]?)\\b");
  const [documentSubjectCounts, setDocumentSubjectCounts] = useState<Record<string, number>>({});
  const [isSortedByCount, setIsSortedByCount] = useState(false);

  // 1. Sincronizar lote con IndexedDB al cargar
  useEffect(() => {
    async function initStorage() {
      setIsLoadingDocs(true);
      try {
        const stored = await getAllClientDocuments();
        const storedMap = new Map(stored.map((d) => [d.name, d]));

        // Si batchData trae un lote específico, eliminar de IndexedDB cualquier archivo que no pertenezca al lote actual
        const validBatchNames = new Set(batchData.files.map((f) => f.name));
        if (batchData.batchId !== "client-storage-batch" && batchData.batchId !== "local-indexeddb") {
          for (const doc of stored) {
            if (!validBatchNames.has(doc.name)) {
              await deleteClientDocument(doc.name);
              storedMap.delete(doc.name);
            }
          }
        }

        // Si batchData trae archivos, agregarlos si no existen
        const toSave: ClientPdfDocument[] = [];

        for (const file of batchData.files) {
          const existing = storedMap.get(file.name);
          if (!existing) {
            const newDoc: ClientPdfDocument = {
              name: file.name,
              sizeBytes: file.sizeBytes,
              formattedSize: file.formattedSize,
              isAnexo3: file.isAnexo3,
              status: "idle",
              uploadedAt: new Date().toISOString(),
            };
            toSave.push(newDoc);
            storedMap.set(file.name, newDoc);
          }
        }

        if (toSave.length > 0) {
          await saveClientDocuments(toSave);
        }

        const allDocs = Array.from(storedMap.values())
          .filter((doc) => validBatchNames.size === 0 || validBatchNames.has(doc.name))
          .sort((a, b) => {
            if (a.isAnexo3 && !b.isAnexo3) return -1;
            if (!a.isAnexo3 && b.isAnexo3) return 1;
            return a.name.localeCompare(b.name);
          });

        setDocuments(allDocs);

        // Abrir pestaña para el primer archivo
        if (allDocs.length > 0) {
          const first = allDocs[0].name;
          setOpenTabs([first]);
          setActiveTabName(first);
        }
      } catch (err) {
        console.error("Error al inicializar IndexedDB:", err);
      } finally {
        setIsLoadingDocs(false);
      }
    }

    initStorage();
  }, [batchData]);

  // Documento activo
  const activeDoc = useMemo(() => {
    return documents.find((d) => d.name === activeTabName);
  }, [documents, activeTabName]);

  // 2. Extraer texto a Markdown usando unpdf (ultrarrápido y local)
  const extractSingleDocument = async (docName: string) => {
    const doc = documents.find((d) => d.name === docName);
    if (!doc) return;

    // Actualizar estado a extrayendo
    setDocuments((prev) =>
      prev.map((d) => (d.name === docName ? { ...d, status: "extracting", error: undefined } : d))
    );
    await updateClientDocumentStatus(docName, "extracting");

    try {
      let res: Response;

      // Si tenemos el blob guardado en cliente, enviarlo
      if (doc.blob) {
        const formData = new FormData();
        formData.append("file", doc.blob, doc.name);
        res = await fetch(`/${TOOL_SLUG}/api/unpdf/extract`, {
          method: "POST",
          body: formData,
        });
      } else {
        // Enviar referencia para procesar desde el lote temporal o local
        const fileInBatch = batchData.files.find((f) => f.name === doc.name);
        res = await fetch(`/${TOOL_SLUG}/api/unpdf/extract`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            batchId: batchData.batchId,
            fileId: fileInBatch?.id,
            localFileName: doc.name,
          }),
        });
      }

      const text = await res.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Respuesta no válida del servidor (${res.status}): ${text.slice(0, 100)}`);
      }

      if (json.success && json.markdown) {
        const pageCount = json.pageCount || 1;
        const runtimeSeconds = json.runtimeSeconds || 0.1;

        // Guardar en IndexedDB del cliente
        await updateClientDocumentMarkdown(docName, json.markdown, pageCount, runtimeSeconds);

        // Actualizar estado en memoria
        setDocuments((prev) =>
          prev.map((d) =>
            d.name === docName
              ? {
                  ...d,
                  markdown: json.markdown,
                  pageCount,
                  runtimeSeconds,
                  status: "completed",
                  extractedAt: new Date().toISOString(),
                }
              : d
          )
        );
      } else {
        throw new Error(json.error || "No se pudo extraer el texto del PDF.");
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Error al extraer PDF con unpdf";
      await updateClientDocumentStatus(docName, "error", errMsg);
      setDocuments((prev) =>
        prev.map((d) => (d.name === docName ? { ...d, status: "error", error: errMsg } : d))
      );
    }
  };

  // 3. Extracción en lote (procesa rápido con unpdf)
  const startBatchExtraction = async (onlyPending: boolean = true) => {
    let queue = documents;

    if (onlyPending) {
      queue = queue.filter((d) => d.status !== "completed");
    }

    if (filterType === "anexo3") {
      queue = queue.filter((d) => d.isAnexo3);
    }

    if (queue.length === 0) {
      alert("No hay documentos pendientes para procesar.");
      return;
    }

    setBatchRunning(true);
    stopBatchRef.current = false;
    setBatchProgress({ current: 0, total: queue.length, currentName: "" });

    for (let i = 0; i < queue.length; i++) {
      if (stopBatchRef.current) break;

      const doc = queue[i];
      setBatchProgress({
        current: i + 1,
        total: queue.length,
        currentName: doc.name,
      });

      if (i === 0 && !activeTabName) {
        handleOpenFileTab(doc.name);
      }

      await extractSingleDocument(doc.name);
    }

    setBatchRunning(false);
  };

  const handleStopBatch = () => {
    stopBatchRef.current = true;
    setBatchRunning(false);
  };

  // Pestañas (Tabs)
  const handleOpenFileTab = (docName: string) => {
    if (!openTabs.includes(docName)) {
      setOpenTabs((prev) => [...prev, docName]);
    }
    setActiveTabName(docName);
  };

  const handleCloseTab = (e: React.MouseEvent, docName: string) => {
    e.stopPropagation();
    const remaining = openTabs.filter((name) => name !== docName);
    setOpenTabs(remaining);
    if (activeTabName === docName) {
      setActiveTabName(remaining.length > 0 ? remaining[remaining.length - 1] : null);
    }
  };

  const handleCloseAllTabs = () => {
    setOpenTabs([]);
    setActiveTabName(null);
  };

  // Eliminar un documento de la base de datos local
  const handleDeleteDocument = async (e: React.MouseEvent, docName: string) => {
    e.stopPropagation();
    if (!confirm(`¿Eliminar ${docName} del almacenamiento local?`)) return;

    await deleteClientDocument(docName);
    setDocuments((prev) => prev.filter((d) => d.name !== docName));
    handleCloseTab(e, docName);
  };

  // Copiar y descargar
  const handleCopyMarkdown = () => {
    if (!activeDoc?.markdown) return;
    navigator.clipboard.writeText(activeDoc.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadMarkdown = () => {
    if (!activeDoc?.markdown) return;
    const baseName = activeDoc.name.replace(/\.pdf$/i, "");
    const blob = new Blob([activeDoc.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${baseName}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Calcular asignaturas (Split + Regex)
  const handleCalculateSubjects = () => {
    const counts: Record<string, number> = {};
    let regex: RegExp;
    try {
      regex = new RegExp(calcClaveRegex, "i");
    } catch (e) {
      alert("La expresión regular de la Clave no es válida.");
      return;
    }

    documents.forEach((doc) => {
      if (!doc.markdown) {
        counts[doc.name] = 0;
        return;
      }
      
      const blocks = doc.markdown.split(calcDelimiter);
      let count = 0;
      // Empezar en 1 para saltar el contenido antes del primer delimitador
      for (let i = 1; i < blocks.length; i++) {
        if (regex.test(blocks[i])) {
          count++;
        }
      }
      counts[doc.name] = count;
    });
    setDocumentSubjectCounts(counts);
    setIsSortedByCount(true);
  };

  // Filtrado de documentos para el explorador
  const filteredDocs = useMemo(() => {
    let result = documents.filter((d) => {
      if (filterType === "anexo3" && !d.isAnexo3) return false;
      if (filterType === "completed" && d.status !== "completed") return false;
      if (filterType === "pending" && d.status === "completed") return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return d.name.toLowerCase().includes(q);
      }
      return true;
    });

    if (isSortedByCount) {
      result = [...result].sort((a, b) => {
        const countA = documentSubjectCounts[a.name] || 0;
        const countB = documentSubjectCounts[b.name] || 0;
        return countB - countA;
      });
    }

    return result;
  }, [documents, filterType, searchQuery, isSortedByCount, documentSubjectCounts]);

  // Estadísticas en tiempo real
  const stats = useMemo(() => {
    const total = documents.length;
    let completed = 0;
    let extracting = 0;
    let errors = 0;

    documents.forEach((d) => {
      if (d.status === "completed") completed++;
      else if (d.status === "extracting") extracting++;
      else if (d.status === "error") errors++;
    });

    const pending = total - completed - extracting - errors;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { total, completed, extracting, errors, pending, percent };
  }, [documents]);

  return (
    <div className="space-y-6">
      {/* ── Stepper Visual del Pipeline ── */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={onBackToStep1}
          className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 hover:bg-white/10 transition text-left cursor-pointer"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600/30 text-emerald-400 font-bold text-xs">
            ✓
          </div>
          <div>
            <div className="text-xs font-semibold text-emerald-300">Paso 1 (Completado)</div>
            <div className="text-xs text-slate-300 font-medium">Subida y Almacenamiento</div>
          </div>
        </button>

        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/50 bg-emerald-500/15 p-3 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/30">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 font-bold text-white text-xs">
            2
          </div>
          <div>
            <div className="text-xs font-bold text-emerald-300">Paso 2 (Activo)</div>
            <div className="text-xs text-white font-medium">unpdf Local a Markdown</div>
          </div>
        </div>

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

      {/* ── Banner de Configuración del Extractor unpdf & Almacenamiento Cliente ── */}
      <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/40 via-teal-950/20 to-slate-900/60 p-5 backdrop-blur-md">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="flex h-6 items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 text-xs font-semibold text-emerald-300 border border-emerald-500/30">
                <Zap className="h-3.5 w-3.5 text-emerald-400" />
                Motor: unpdf (Mozilla PDF.js)
              </span>
              <span className="font-mono text-xs font-semibold text-white bg-black/40 px-2.5 py-1 rounded-lg border border-white/10 flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5 text-indigo-400" />
                IndexedDB Cliente Activo
              </span>
              <span className="text-xs text-slate-400">100% Local • Gratuito • Ultrarrápido</span>
            </div>
            <p className="text-xs text-slate-300 max-w-2xl mt-1">
              Extracción instantánea sin costo de APIs externas. Los archivos se almacenan en el navegador y sólo se reemplazan si se sube uno con el mismo nombre exacto.
            </p>
          </div>

          {/* Métricas rápidas */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl bg-black/30 border border-white/10 px-4 py-2 text-right">
              <div>
                <div className="text-[11px] text-slate-400">Markdowns Listos</div>
                <div className="text-sm font-bold text-white">
                  <span className="text-emerald-400">{stats.completed}</span> / {stats.total}
                </div>
              </div>
              <div className="h-8 w-8 rounded-full border-2 border-emerald-500/40 flex items-center justify-center font-bold text-[11px] text-emerald-300">
                {stats.percent}%
              </div>
            </div>
          </div>
        </div>

        {/* Barra de progreso de extracción masiva */}
        {batchRunning && (
          <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
                Extrayendo con unpdf ({batchProgress.current} de {batchProgress.total}):{" "}
                <span className="font-mono text-white font-medium truncate max-w-md">
                  {batchProgress.currentName}
                </span>
              </span>
              <button
                type="button"
                onClick={handleStopBatch}
                className="flex items-center gap-1 text-rose-400 hover:text-rose-300 font-semibold cursor-pointer"
              >
                <Pause className="h-3.5 w-3.5" />
                Detener
              </button>
            </div>
            <div className="w-full bg-black/40 h-2 rounded-full overflow-hidden border border-white/5">
              <div
                className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-200"
                style={{
                  width: `${(batchProgress.current / batchProgress.total) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Contenedor Principal: Explorador de Archivos + Visor de Tabs ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[680px]">
        {/* ── Panel Lateral: Explorador de Documentos del Cliente (4 cols) ── */}
        <div className="lg:col-span-4 flex flex-col rounded-2xl border border-white/10 bg-slate-950/60 backdrop-blur-md overflow-hidden">
          {/* Header del Explorador */}
          <div className="p-4 border-b border-white/10 space-y-3 bg-white/[0.02]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Documentos en Navegador</h3>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                {filteredDocs.length} de {documents.length}
              </span>
            </div>

            {/* Búsqueda */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por nombre..."
                className="w-full h-8 pl-8 pr-8 rounded-lg bg-black/40 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Filtros rápidos */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              <button
                type="button"
                onClick={() => setFilterType("all")}
                className={`px-2.5 py-1 rounded-lg transition whitespace-nowrap text-[11px] cursor-pointer ${
                  filterType === "all"
                    ? "bg-emerald-600 text-white font-medium"
                    : "bg-white/5 text-slate-400 hover:text-white"
                }`}
              >
                Todos ({documents.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterType("anexo3")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition whitespace-nowrap text-[11px] cursor-pointer ${
                  filterType === "anexo3"
                    ? "bg-emerald-600 text-white font-medium"
                    : "bg-white/5 text-slate-400 hover:text-white"
                }`}
              >
                <Sparkles className="h-2.5 w-2.5" />
                Anexo 3 ({documents.filter((d) => d.isAnexo3).length})
              </button>
              <button
                type="button"
                onClick={() => setFilterType("completed")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition whitespace-nowrap text-[11px] cursor-pointer ${
                  filterType === "completed"
                    ? "bg-emerald-600 text-white font-medium"
                    : "bg-white/5 text-slate-400 hover:text-white"
                }`}
              >
                <Check className="h-2.5 w-2.5 text-emerald-300" />
                Listos ({stats.completed})
              </button>
              <button
                type="button"
                onClick={() => setFilterType("pending")}
                className={`px-2.5 py-1 rounded-lg transition whitespace-nowrap text-[11px] cursor-pointer ${
                  filterType === "pending"
                    ? "bg-amber-600 text-white font-medium"
                    : "bg-white/5 text-slate-400 hover:text-white"
                }`}
              >
                Pendientes ({stats.pending})
              </button>
            </div>

            {/* Calculador de Asignaturas */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowSubjectCalculator(!showSubjectCalculator)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition cursor-pointer border ${
                  showSubjectCalculator
                    ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-300"
                    : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Calculator className="h-3.5 w-3.5" />
                  Calculador de Asignaturas
                </div>
                <Settings2 className="h-3.5 w-3.5 opacity-60" />
              </button>

              {showSubjectCalculator && (
                <div className="mt-2 rounded-xl bg-black/40 border border-white/10 p-3 space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-400 uppercase">Delimitador (Texto)</label>
                    <input
                      type="text"
                      value={calcDelimiter}
                      onChange={(e) => setCalcDelimiter(e.target.value)}
                      className="w-full h-8 rounded-lg bg-black/50 border border-white/10 px-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                      placeholder="Ej. ### DENOMINACIÓN DE LA ASIGNATURA"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-400 uppercase">Regex de Clave</label>
                    <input
                      type="text"
                      value={calcClaveRegex}
                      onChange={(e) => setCalcClaveRegex(e.target.value)}
                      className="w-full h-8 rounded-lg bg-black/50 border border-white/10 px-2.5 text-xs text-emerald-300 focus:outline-none focus:border-indigo-500 font-mono"
                      placeholder="\b([A-Z]{2,6}-?\d{2,5}[A-Z]?)\b"
                    />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleCalculateSubjects}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white transition cursor-pointer shadow-md shadow-indigo-600/20"
                    >
                      <ArrowDownUp className="h-3.5 w-3.5" />
                      Contar y Ordenar
                    </button>
                    {isSortedByCount && (
                      <button
                        type="button"
                        onClick={() => setIsSortedByCount(false)}
                        className="flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-medium text-slate-300 transition cursor-pointer"
                        title="Quitar ordenamiento"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Botón de Extracción Masiva */}
            <div className="pt-1 flex gap-2">
              <button
                type="button"
                disabled={batchRunning || stats.pending === 0}
                onClick={() => startBatchExtraction(true)}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-2 text-xs font-semibold text-white shadow-md shadow-emerald-600/20 hover:from-emerald-500 hover:to-teal-500 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {batchRunning ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Extrayendo...
                  </>
                ) : (
                  <>
                    <Zap className="h-3.5 w-3.5" />
                    Extraer Pendientes con unpdf ({stats.pending})
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Lista de Archivos (Scrollable) */}
          <div className="flex-1 overflow-y-auto max-h-[560px] divide-y divide-white/5">
            {isLoadingDocs ? (
              <div className="p-8 text-center text-xs text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2 text-emerald-400" />
                Cargando archivos locales...
              </div>
            ) : filteredDocs.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No hay archivos que coincidan con el filtro.
              </div>
            ) : (
              filteredDocs.map((doc) => {
                const isSelected = activeTabName === doc.name;
                const isExtracting = doc.status === "extracting";
                const isDone = doc.status === "completed";
                const isError = doc.status === "error";

                return (
                  <div
                    key={doc.name}
                    onClick={() => handleOpenFileTab(doc.name)}
                    className={`group flex items-center justify-between p-3 cursor-pointer transition select-none ${
                      isSelected
                        ? "bg-emerald-600/15 border-l-2 border-emerald-400"
                        : "hover:bg-white/[0.03]"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <div
                        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${
                          isDone
                            ? "bg-emerald-500/20 text-emerald-400"
                            : isExtracting
                            ? "bg-emerald-500/20 text-emerald-400 animate-pulse"
                            : isError
                            ? "bg-rose-500/20 text-rose-400"
                            : "bg-white/5 text-slate-400"
                        }`}
                      >
                        {isDone ? (
                          <FileCode className="h-4 w-4" />
                        ) : isExtracting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p
                            className={`text-xs font-medium truncate ${
                              isSelected ? "text-emerald-200" : "text-white"
                            }`}
                            title={doc.name}
                          >
                            {doc.name}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                          <span>{doc.formattedSize}</span>
                          {doc.isAnexo3 && (
                            <span className="text-emerald-400 font-medium">• Anexo 3</span>
                          )}
                          {isDone && doc.pageCount && (
                            <span className="text-emerald-300 font-medium">
                              • {doc.pageCount} pág(s)
                            </span>
                          )}
                          {isSortedByCount && documentSubjectCounts[doc.name] !== undefined && (
                            <span className="text-indigo-400 font-bold bg-indigo-500/20 px-1.5 py-0.5 rounded border border-indigo-500/30 flex items-center gap-1">
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              {documentSubjectCounts[doc.name]} asig.
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Acciones por fila */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isDone ? (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300 border border-emerald-500/30">
                          <Check className="h-2.5 w-2.5" />
                          MD
                        </span>
                      ) : isExtracting ? (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          unpdf...
                        </span>
                      ) : isError ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            extractSingleDocument(doc.name);
                          }}
                          className="flex items-center gap-1 rounded bg-rose-500/20 px-2 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/30 transition cursor-pointer"
                          title={doc.error || "Reintentar extracción"}
                        >
                          <RotateCw className="h-2.5 w-2.5" />
                          Reintentar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            extractSingleDocument(doc.name);
                          }}
                          className="opacity-0 group-hover:opacity-100 flex items-center gap-1 rounded bg-white/10 hover:bg-emerald-600 px-2 py-0.5 text-[10px] text-white transition cursor-pointer"
                          title="Extraer a Markdown con unpdf"
                        >
                          <Play className="h-2.5 w-2.5" />
                          MD
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={(e) => handleDeleteDocument(e, doc.name)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-rose-400 transition"
                        title="Eliminar del almacenamiento local"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Panel Principal: Sistema de Tabs y Visor Markdown (8 cols) ── */}
        <div className="lg:col-span-8 flex flex-col rounded-2xl border border-white/10 bg-slate-950/80 backdrop-blur-md overflow-hidden min-h-[620px]">
          {/* ── Barra Superior de Tabs (Pestañas tipo Explorador/IDE) ── */}
          <div className="flex items-center justify-between border-b border-white/10 bg-black/40 px-2 pt-2">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full">
              {openTabs.length === 0 ? (
                <div className="px-3 py-2 text-xs text-slate-500 italic">
                  Ningún archivo abierto en pestañas. Selecciona un archivo en el explorador.
                </div>
              ) : (
                openTabs.map((tabName) => {
                  const doc = documents.find((d) => d.name === tabName);
                  if (!doc) return null;
                  const isActive = activeTabName === tabName;
                  const isDone = doc.status === "completed";
                  const isExtracting = doc.status === "extracting";

                  return (
                    <div
                      key={tabName}
                      onClick={() => setActiveTabName(tabName)}
                      className={`group flex items-center gap-2 px-3 py-2 rounded-t-xl text-xs font-medium cursor-pointer transition select-none border-t border-x ${
                        isActive
                          ? "bg-slate-900 border-white/20 text-white shadow-md shadow-emerald-500/5 relative -bottom-[1px]"
                          : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]"
                      }`}
                    >
                      {isDone ? (
                        <FileCode className="h-3.5 w-3.5 text-emerald-400" />
                      ) : isExtracting ? (
                        <Loader2 className="h-3.5 w-3.5 text-emerald-400 animate-spin" />
                      ) : (
                        <FileText className="h-3.5 w-3.5 text-slate-500" />
                      )}

                      <span className="truncate max-w-[160px]" title={doc.name}>
                        {doc.name.replace(/\.pdf$/i, "")}
                      </span>

                      <button
                        type="button"
                        onClick={(e) => handleCloseTab(e, tabName)}
                        className="rounded p-0.5 text-slate-500 hover:text-white hover:bg-white/10 transition ml-0.5 cursor-pointer"
                        title="Cerrar pestaña"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Acción de pestañas */}
            {openTabs.length > 1 && (
              <button
                type="button"
                onClick={handleCloseAllTabs}
                className="text-[11px] text-slate-500 hover:text-slate-300 px-2 py-1 transition whitespace-nowrap cursor-pointer"
                title="Cerrar todas las pestañas"
              >
                Cerrar todas
              </button>
            )}
          </div>

          {/* ── Subheader de Archivo Activo y Controles de Vista ── */}
          {activeDoc ? (
            <div className="p-4 border-b border-white/10 bg-white/[0.01] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    {activeDoc.name}
                    {activeDoc.isAnexo3 && (
                      <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300 border border-emerald-500/30">
                        Anexo 3
                      </span>
                    )}
                  </h4>
                  <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                    {activeDoc.status === "completed" ? (
                      <>
                        Motor: <span className="text-emerald-300">unpdf</span> •{" "}
                        {activeDoc.pageCount ? `${activeDoc.pageCount} pág(s) • ` : ""}
                        Tiempo: {activeDoc.runtimeSeconds?.toFixed(2) || "0.1"}s • Longitud:{" "}
                        {(activeDoc.markdown?.length || 0).toLocaleString()} caracteres
                      </>
                    ) : activeDoc.status === "extracting" ? (
                      <span className="text-emerald-300 flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" /> Extrayendo con unpdf...
                      </span>
                    ) : (
                      "Sin extraer"
                    )}
                  </p>
                </div>
              </div>

              {/* Botones de Vista & Acciones */}
              <div className="flex items-center gap-2">
                {activeDoc.status === "completed" && (
                  <>
                    {/* Toggle Render / Raw / Split */}
                    <div className="flex items-center bg-black/40 rounded-xl p-1 border border-white/10 text-xs">
                      <button
                        type="button"
                        onClick={() => setViewMode("rendered")}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition cursor-pointer ${
                          viewMode === "rendered"
                            ? "bg-emerald-600 text-white font-medium"
                            : "text-slate-400 hover:text-white"
                        }`}
                        title="Vista previa formateada"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Vista
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewMode("raw")}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition cursor-pointer ${
                          viewMode === "raw"
                            ? "bg-emerald-600 text-white font-medium"
                            : "text-slate-400 hover:text-white"
                        }`}
                        title="Ver código fuente Markdown"
                      >
                        <Code className="h-3.5 w-3.5" />
                        Raw
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewMode("split")}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition cursor-pointer ${
                          viewMode === "split"
                            ? "bg-emerald-600 text-white font-medium"
                            : "text-slate-400 hover:text-white"
                        }`}
                        title="Vista dividida código / renderizado"
                      >
                        <Columns className="h-3.5 w-3.5" />
                        Dividida
                      </button>
                    </div>

                    {/* Copiar */}
                    <button
                      type="button"
                      onClick={handleCopyMarkdown}
                      className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition cursor-pointer"
                      title="Copiar contenido Markdown"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                          Copiado
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copiar
                        </>
                      )}
                    </button>

                    {/* Descargar */}
                    <button
                      type="button"
                      onClick={handleDownloadMarkdown}
                      className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition cursor-pointer"
                      title="Descargar archivo .md"
                    >
                      <Download className="h-3.5 w-3.5" />
                      .md
                    </button>
                  </>
                )}

                {/* Extraer / Re-extraer */}
                <button
                  type="button"
                  onClick={() => extractSingleDocument(activeDoc.name)}
                  disabled={activeDoc.status === "extracting"}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition disabled:opacity-40 cursor-pointer"
                >
                  {activeDoc.status === "extracting" ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Extrayendo...
                    </>
                  ) : activeDoc.status === "completed" ? (
                    <>
                      <RotateCw className="h-3.5 w-3.5" />
                      Re-extraer
                    </>
                  ) : (
                    <>
                      <Zap className="h-3.5 w-3.5" />
                      Extraer Markdown
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : null}

          {/* ── Cuerpo del Editor / Visor de Markdown ── */}
          <div className="flex-1 overflow-y-auto p-6 max-h-[580px]">
            {!activeDoc ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-12 text-slate-500">
                <FileText className="h-12 w-12 text-slate-600 mb-3" />
                <p className="text-sm font-medium text-slate-400">
                  Ningún archivo seleccionado
                </p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm">
                  Haz clic en un documento del explorador a la izquierda para abrirlo en una pestaña y ver su contenido Markdown.
                </p>
              </div>
            ) : activeDoc.status === "extracting" ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-12 space-y-4">
                <div className="relative">
                  <div className="h-16 w-16 rounded-2xl bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                  <Zap className="h-5 w-5 text-emerald-300 absolute -top-1 -right-1 animate-bounce" />
                </div>
                <div>
                  <h4 className="text-base font-semibold text-white">
                    Extrayendo contenido con unpdf
                  </h4>
                  <p className="text-xs text-slate-400 mt-2 max-w-md">
                    Procesando las páginas del PDF en memoria y estructurando el formato Markdown...
                  </p>
                </div>
              </div>
            ) : activeDoc.status === "completed" && activeDoc.markdown ? (
              /* Contenido Markdown según el viewMode */
              <div className="h-full">
                {viewMode === "rendered" && (
                  <div className="prose prose-invert max-w-none text-slate-200">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: ({ ...props }) => (
                          <h1
                            className="text-2xl font-bold text-white mt-6 mb-3 border-b border-white/10 pb-2 flex items-center gap-2"
                            {...props}
                          />
                        ),
                        h2: ({ ...props }) => (
                          <h2
                            className="text-xl font-semibold text-emerald-200 mt-6 mb-3 border-b border-white/5 pb-1"
                            {...props}
                          />
                        ),
                        h3: ({ ...props }) => (
                          <h3 className="text-base font-semibold text-emerald-300 mt-5 mb-2" {...props} />
                        ),
                        h4: ({ ...props }) => (
                          <h4 className="text-sm font-semibold text-teal-300 mt-4 mb-1.5" {...props} />
                        ),
                        p: ({ ...props }) => (
                          <p className="text-sm text-slate-300 leading-relaxed my-2" {...props} />
                        ),
                        ul: ({ ...props }) => (
                          <ul className="list-disc list-inside text-sm text-slate-300 my-2 space-y-1 pl-2" {...props} />
                        ),
                        ol: ({ ...props }) => (
                          <ol className="list-decimal list-inside text-sm text-slate-300 my-2 space-y-1 pl-2" {...props} />
                        ),
                        table: ({ ...props }) => (
                          <div className="overflow-x-auto my-4 rounded-xl border border-white/10 bg-black/40">
                            <table
                              className="w-full text-xs text-left text-slate-300 border-collapse"
                              {...props}
                            />
                          </div>
                        ),
                        th: ({ ...props }) => (
                          <th className="px-3 py-2.5 border-b border-white/10 bg-white/5 text-white font-semibold" {...props} />
                        ),
                        td: ({ ...props }) => (
                          <td className="px-3 py-2 border-b border-white/5 font-mono text-[11px] text-slate-300" {...props} />
                        ),
                        blockquote: ({ ...props }) => (
                          <blockquote
                            className="border-l-4 border-emerald-500 bg-emerald-500/10 p-2.5 my-3 rounded-r-lg text-xs italic text-emerald-200"
                            {...props}
                          />
                        ),
                      }}
                    >
                      {activeDoc.markdown}
                    </ReactMarkdown>
                  </div>
                )}

                {viewMode === "raw" && (
                  <div className="relative">
                    <pre className="font-mono text-xs text-emerald-300 bg-black/60 p-4 rounded-xl border border-white/10 overflow-x-auto whitespace-pre-wrap leading-relaxed select-text">
                      {activeDoc.markdown}
                    </pre>
                  </div>
                )}

                {viewMode === "split" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
                    <div className="flex flex-col rounded-xl border border-white/10 bg-black/50 overflow-hidden">
                      <div className="px-3 py-2 bg-white/5 border-b border-white/10 text-[11px] font-mono text-slate-400">
                        Markdown Source (Raw)
                      </div>
                      <pre className="p-3 font-mono text-xs text-emerald-300/90 overflow-y-auto max-h-[500px] whitespace-pre-wrap leading-relaxed flex-1">
                        {activeDoc.markdown}
                      </pre>
                    </div>

                    <div className="flex flex-col rounded-xl border border-white/10 bg-slate-900/50 overflow-hidden">
                      <div className="px-3 py-2 bg-white/5 border-b border-white/10 text-[11px] font-mono text-slate-400">
                        Vista Formateada
                      </div>
                      <div className="p-4 overflow-y-auto max-h-[500px] flex-1 text-slate-300">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            h1: ({ ...props }) => (
                              <h1 className="text-lg font-bold text-white mb-2" {...props} />
                            ),
                            h2: ({ ...props }) => (
                              <h2 className="text-base font-semibold text-emerald-200 mt-4 mb-2" {...props} />
                            ),
                            h3: ({ ...props }) => (
                              <h3 className="text-sm font-semibold text-emerald-300 mt-3 mb-1" {...props} />
                            ),
                            p: ({ ...props }) => (
                              <p className="text-xs text-slate-300 my-1.5 leading-relaxed" {...props} />
                            ),
                          }}
                        >
                          {activeDoc.markdown}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : activeDoc.status === "error" ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-10 space-y-4">
                <div className="h-14 w-14 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center">
                  <AlertCircle className="h-7 w-7" />
                </div>
                <div>
                  <h4 className="text-base font-semibold text-white">
                    Error al extraer documento
                  </h4>
                  <p className="text-xs text-rose-300 mt-2 max-w-md bg-rose-500/10 p-3 rounded-xl border border-rose-500/20 font-mono">
                    {activeDoc.error || "Ocurrió un error inesperado al procesar con unpdf."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => extractSingleDocument(activeDoc.name)}
                  className="flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 transition cursor-pointer"
                >
                  <RotateCw className="h-4 w-4" />
                  Reintentar Extracción
                </button>
              </div>
            ) : (
              /* Estado inicial sin extraer */
              <div className="h-full flex flex-col items-center justify-center text-center p-12 space-y-4 border-2 border-dashed border-white/10 rounded-2xl">
                <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center ring-8 ring-emerald-500/5">
                  <FileText className="h-8 w-8" />
                </div>
                <div>
                  <h4 className="text-base font-semibold text-white">
                    Documento listo para extracción
                  </h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-md">
                    Haz clic para extraer el contenido completo a Markdown de forma instantánea usando unpdf.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => extractSingleDocument(activeDoc.name)}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-emerald-500/25 hover:from-emerald-500 hover:to-teal-500 transition cursor-pointer"
                >
                  <Zap className="h-4 w-4" />
                  Extraer a Markdown con unpdf
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Footer de Navegación de Pasos ── */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 backdrop-blur-sm flex flex-col sm:flex-row items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBackToStep1}
          className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a Paso 1 (Subida)
        </button>

        <div className="flex items-center gap-3">
          <p className="text-xs text-slate-400">
            {stats.completed > 0 ? (
              <span className="text-emerald-400 font-medium">
                {stats.completed} documento(s) listos en Markdown en el cliente
              </span>
            ) : (
              "Extrae los documentos a Markdown para continuar"
            )}
          </p>

          <button
            type="button"
            onClick={onProceedToStep3}
            disabled={stats.completed === 0}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-semibold text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-500 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Continuar a Paso 3: Extracción de Asignaturas
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
