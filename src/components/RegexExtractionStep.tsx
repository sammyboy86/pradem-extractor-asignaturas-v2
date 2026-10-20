"use client";

import React, { useState, useEffect, useMemo, useTransition, useRef } from "react";
import type { BatchSummary } from "@/lib/temp-storage";
import { TOOL_SLUG } from "@/pradem.config";
import {
  getAllClientDocuments,
  saveClientDocuments,
  updateClientDocumentMarkdown,
  updateClientDocumentStatus,
  deleteClientDocument,
  ClientPdfDocument,
} from "@/lib/client-pdf-storage";
import {
  AsignaturaExtraida,
  FieldRegexRule,
  DEFAULT_SEGMENT_DELIMITER,
  DEFAULT_REGEX_RULES,
  DEFAULT_REGEX_CONFIG,
  RegexConfig,
  processMarkdownWithRules,
  splitMarkdownIntoSegments,
  AsignaturaFieldKey,
  getStructuredMarkdownForView,
  analyzeOutliers,
} from "@/lib/regex-engine";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Database,
  ArrowLeft,
  Search,
  CheckCircle2,
  AlertTriangle,
  Upload,
  RefreshCw,
  FileText,
  Sliders,
  ChevronDown,
  ChevronUp,
  X,
  Sparkles,
  Info,
  Check,
  ShieldAlert,
  Loader2,
  FileCode,
  Columns,
  Table as TableIcon,
  RotateCcw,
  Edit3,
  Save,
  FolderOpen,
  FolderClosed,
  ChevronLeft,
  ChevronRight,
  Zap,
  Eye,
  Hash,
  Copy,
  BookmarkCheck,
  Globe,
  Settings2,
  Calculator,
  ArrowDownUp,
} from "lucide-react";

interface RegexExtractionStepProps {
  batchData: BatchSummary;
  onBackToStep2: () => void;
}

export default function RegexExtractionStep({
  batchData,
  onBackToStep2,
}: RegexExtractionStepProps) {
  // ── Documentos y Explorador Lateral ──
  const [documents, setDocuments] = useState<ClientPdfDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState<boolean>(true);
  const [activeDocName, setActiveDocName] = useState<string>("");
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [docSearch, setDocSearch] = useState<string>("");
  const [docFilter, setDocFilter] = useState<"all" | "has_md" | "anexo3" | "pending">("all");
  const [showFileExplorer, setShowFileExplorer] = useState<boolean>(true);

  // Estados para el calculador de asignaturas
  const [showSubjectCalculator, setShowSubjectCalculator] = useState(false);
  const [calcDelimiter, setCalcDelimiter] = useState("### DENOMINACIÓN DE LA ASIGNATURA");
  const [calcClaveRegex, setCalcClaveRegex] = useState("\\b([A-Z]{2,6}-?\\d{2,5}[A-Z]?)\\b");
  const [documentSubjectCounts, setDocumentSubjectCounts] = useState<Record<string, { total: number, ready: number, inDb: number }>>({});
  const [isSortedByCount, setIsSortedByCount] = useState(false);
  const [isCalculatingSubjects, setIsCalculatingSubjects] = useState(false);
  const [markdownSearchText, setMarkdownSearchText] = useState("");

  const escapeRegExp = (string: string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const documentSearchCounts = useMemo(() => {
    if (!markdownSearchText.trim()) return {};
    const counts: Record<string, number> = {};
    const regex = new RegExp(escapeRegExp(markdownSearchText.trim()), "gi");
    for (const doc of documents) {
      if (!doc.markdown) {
        counts[doc.name] = 0;
        continue;
      }
      const matches = doc.markdown.match(regex);
      counts[doc.name] = matches ? matches.length : 0;
    }
    return counts;
  }, [markdownSearchText, documents]);

  // ── Configuración de Delimitador y Regex a Nivel Documento y Default Global ──
  const STORAGE_KEY_DEFAULT_CONFIG = "pradem_regex_default_config_v2";
  const STORAGE_KEY_DOC_CONFIGS = "pradem_regex_doc_configs_v2";
  const STORAGE_KEY_PROFILES = "pradem_regex_profiles_v1";

  const [defaultConfig, setDefaultConfig] = useState<RegexConfig>(DEFAULT_REGEX_CONFIG);
  const [docConfigs, setDocConfigs] = useState<Record<string, RegexConfig>>({});
  const [savedProfiles, setSavedProfiles] = useState<Record<string, RegexConfig>>({});
  const [draftConfig, setDraftConfig] = useState<RegexConfig | null>(null);
  const [showConfigPanel, setShowConfigPanel] = useState<boolean>(false);
  const [activeConfigTab, setActiveConfigTab] = useState<AsignaturaFieldKey>("nombre");
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);

  // Cargar configuraciones guardadas de localStorage al inicializar
  useEffect(() => {
    try {
      let initialDefault: RegexConfig = DEFAULT_REGEX_CONFIG;
      const savedDefaultStr = localStorage.getItem(STORAGE_KEY_DEFAULT_CONFIG);
      if (savedDefaultStr) {
        const parsed = JSON.parse(savedDefaultStr);
        if (parsed && typeof parsed === "object") {
          initialDefault = {
            delimiter: parsed.delimiter || DEFAULT_SEGMENT_DELIMITER,
            rules: { ...DEFAULT_REGEX_RULES, ...(parsed.rules || {}) },
          };
        }
      } else {
        // Fallback a v1 por si el usuario ya tenía configuraciones previas guardadas
        const savedDelim = localStorage.getItem("pradem_regex_delimiter_v1");
        const savedRulesStr = localStorage.getItem("pradem_regex_rules_v1");
        let legacyRules = DEFAULT_REGEX_RULES;
        if (savedRulesStr) {
          try {
            legacyRules = { ...DEFAULT_REGEX_RULES, ...JSON.parse(savedRulesStr) };
          } catch { }
        }
        if (savedDelim || savedRulesStr) {
          initialDefault = {
            delimiter: savedDelim || DEFAULT_SEGMENT_DELIMITER,
            rules: legacyRules,
          };
        }
      }
      setDefaultConfig(initialDefault);

      const savedDocConfigsStr = localStorage.getItem(STORAGE_KEY_DOC_CONFIGS);
      if (savedDocConfigsStr) {
        const parsedMap = JSON.parse(savedDocConfigsStr);
        if (parsedMap && typeof parsedMap === "object") {
          setDocConfigs(parsedMap);
        }
      }
      const savedProfilesStr = localStorage.getItem(STORAGE_KEY_PROFILES);
      if (savedProfilesStr) {
        try {
          const parsedProfiles = JSON.parse(savedProfilesStr);
          if (parsedProfiles && typeof parsedProfiles === "object") {
            setSavedProfiles(parsedProfiles);
          }
        } catch (err) { }
      }
    } catch (err) {
      console.warn("No se pudieron cargar las configuraciones regex de localStorage:", err);
    }
  }, []);

  // Determinar si el documento activo tiene configuración propia personalizada
  const isCurrentDocCustom = Boolean(activeDocName && docConfigs[activeDocName]);

  // Configuración activa actual (del documento activo o la predeterminada global)
  const activeRegexConfig: RegexConfig = useMemo(() => {
    if (activeDocName && docConfigs[activeDocName]) {
      return docConfigs[activeDocName];
    }
    return defaultConfig;
  }, [activeDocName, docConfigs, defaultConfig]);

  const currentDraft = draftConfig || activeRegexConfig;
  const delimiter = currentDraft.delimiter;
  const rules = currentDraft.rules;

  // Limpiar draft si se cambia de documento
  useEffect(() => {
    setDraftConfig(null);
  }, [activeDocName]);

  // Cambiar delimitador en el borrador
  const handleDelimiterChange = (newDelim: string, isRegex?: boolean) => {
    setDraftConfig(prev => {
      const base = prev || activeRegexConfig;
      return {
        ...base,
        delimiter: newDelim,
        isDelimiterRegex: isRegex !== undefined ? isRegex : base.isDelimiterRegex,
      };
    });
  };

  // Cambiar regla regex en el borrador
  const handleRuleChange = (
    fieldKey: AsignaturaFieldKey,
    updates: Partial<FieldRegexRule>
  ) => {
    setDraftConfig(prev => {
      const base = prev || activeRegexConfig;
      return {
        ...base,
        rules: {
          ...base.rules,
          [fieldKey]: { ...base.rules[fieldKey], ...updates },
        },
      };
    });
  };

  // Aplicar borrador
  const handleApplyDraft = () => {
    if (!draftConfig) return;
    const timeStr = new Date().toLocaleTimeString();
    setLastSavedTime(timeStr);

    if (activeDocName) {
      const updatedMap = {
        ...docConfigs,
        [activeDocName]: draftConfig,
      };
      setDocConfigs(updatedMap);
      try {
        localStorage.setItem(STORAGE_KEY_DOC_CONFIGS, JSON.stringify(updatedMap));
      } catch (err) { }
    } else {
      setDefaultConfig(draftConfig);
      try {
        localStorage.setItem(STORAGE_KEY_DEFAULT_CONFIG, JSON.stringify(draftConfig));
      } catch (err) { }
    }
    setDraftConfig(null);
  };

  // Volver la configuración actual el nuevo DEFAULT global
  // "no sobre-escribe los que ya se cambiaron pero se usa por todos los que no se han cambiado"
  const handleMakeCurrentDefault = () => {
    const targetConfig = draftConfig || activeRegexConfig;
    const newDefault: RegexConfig = {
      delimiter: targetConfig.delimiter,
      isDelimiterRegex: targetConfig.isDelimiterRegex,
      rules: { ...targetConfig.rules },
    };
    setDefaultConfig(newDefault);
    setDraftConfig(null);
    try {
      localStorage.setItem(STORAGE_KEY_DEFAULT_CONFIG, JSON.stringify(newDefault));
    } catch (err) {
      console.warn("Error guardando nuevo defaultConfig en localStorage:", err);
    }

    // Para el documento activo actual: al convertirse en el default, quitamos su override específico
    // para que ahora use limpiamente el nuevo default (los DEMÁS documentos con cambios propios se conservan intactos)
    if (activeDocName && docConfigs[activeDocName]) {
      const updatedMap = { ...docConfigs };
      delete updatedMap[activeDocName];
      setDocConfigs(updatedMap);
      try {
        localStorage.setItem(STORAGE_KEY_DOC_CONFIGS, JSON.stringify(updatedMap));
      } catch (err) {
        console.warn("Error actualizando docConfigs:", err);
      }
    }

    // Re-evaluar extracciones de otros documentos que NO tienen configuración personalizada
    setExtractionsMap((prev) => {
      const nextMap = { ...prev };
      for (const doc of documents) {
        if (!docConfigs[doc.name] && doc.markdown) {
          try {
            const extracted = processMarkdownWithRules(doc.markdown, newDefault.delimiter, newDefault.rules, newDefault.isDelimiterRegex);
            nextMap[doc.name] = extracted.map((item) => ({
              ...item,
              status: dbExistingClaves.has(item.clave.trim().toLowerCase())
                ? ("skipped_duplicate" as const)
                : ("pending" as const),
            }));
          } catch { }
        }
      }
      return nextMap;
    });

    setNotification({
      type: "success",
      title: "Configuración establecida como Default",
      message: "Este delimitador y reglas regex ahora son el predeterminado para todos los documentos que no tengan ajustes propios. Los documentos que ya tenían cambios específicos se conservaron intactos.",
    });
  };

  // ── Manejo de Perfiles ──
  const handleSaveProfile = () => {
    const profileName = window.prompt("Ingresa un nombre para este perfil de filtros:");
    if (!profileName || !profileName.trim()) return;
    const name = profileName.trim();

    if (savedProfiles[name]) {
      const ok = window.confirm(`El perfil "${name}" ya existe. ¿Deseas sobreescribirlo?`);
      if (!ok) return;
    }

    const configToSave = draftConfig || activeRegexConfig;
    const updatedProfiles = {
      ...savedProfiles,
      [name]: configToSave
    };
    setSavedProfiles(updatedProfiles);
    try {
      localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(updatedProfiles));
      setNotification({
        type: "success",
        title: "Perfil guardado",
        message: `El perfil "${name}" se guardó correctamente.`,
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleLoadProfile = (profileName: string) => {
    const profile = savedProfiles[profileName];
    if (profile) {
      setDraftConfig(profile);
      setNotification({
        type: "info",
        title: "Perfil cargado",
        message: `Se cargó el perfil "${profileName}" como borrador. Da clic en "Aplicar y Guardar" cuando estés listo.`,
      });
    }
  };

  const handleDeleteProfile = (profileName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = window.confirm(`¿Seguro que quieres eliminar el perfil "${profileName}"?`);
    if (!ok) return;
    const updatedProfiles = { ...savedProfiles };
    delete updatedProfiles[profileName];
    setSavedProfiles(updatedProfiles);
    try {
      localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(updatedProfiles));
    } catch (err) { }
  };

  // Restablecer el documento activo actual a la configuración DEFAULT
  const handleResetCurrentDocToDefault = () => {
    if (!activeDocName) return;
    if (docConfigs[activeDocName]) {
      const updatedMap = { ...docConfigs };
      delete updatedMap[activeDocName];
      setDocConfigs(updatedMap);
      try {
        localStorage.setItem(STORAGE_KEY_DOC_CONFIGS, JSON.stringify(updatedMap));
      } catch (err) {
        console.warn("Error actualizando docConfigs:", err);
      }
    }
    setDraftConfig(null);
    setNotification({
      type: "info",
      title: "Documento restablecido al Default",
      message: `El documento "${activeDocName}" ahora utiliza la configuración predeterminada global.`,
    });
  };

  // Restablecer valores de fábrica originales
  const handleResetFactoryDefaults = () => {
    setDefaultConfig(DEFAULT_REGEX_CONFIG);
    setDraftConfig(null);
    try {
      localStorage.removeItem(STORAGE_KEY_DEFAULT_CONFIG);
      localStorage.removeItem("pradem_regex_delimiter_v1");
      localStorage.removeItem("pradem_regex_rules_v1");
    } catch (err) {
      console.warn("Error eliminando configuración default:", err);
    }
    setNotification({
      type: "info",
      title: "Valores de fábrica restablecidos",
      message: "La configuración predeterminada volvió a los valores de fábrica. Los documentos con configuración personalizada propia se mantienen intactos.",
    });
  };

  // ── Asignaturas Extraídas por Documento ──
  // Mapa de docName -> AsignaturaExtraida[]
  const [extractionsMap, setExtractionsMap] = useState<Record<string, AsignaturaExtraida[]>>({});
  const [, startTransition] = useTransition();

  // ── Estados de Supabase y Claves Existentes ──
  const [dbExistingClaves, setDbExistingClaves] = useState<Set<string>>(new Set());
  const [checkingDb, setCheckingDb] = useState<boolean>(false);
  const [uploadingAll, setUploadingAll] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [notification, setNotification] = useState<{
    type: "success" | "warning" | "error" | "info";
    title: string;
    message: string;
  } | null>(null);

  // ── Visor de Markdown & Modos de Visualización ──
  const [viewMode, setViewMode] = useState<"split" | "entries" | "markdown">("split");
  const [markdownViewType, setMarkdownViewType] = useState<"rendered" | "raw">("rendered");
  const [extractingSingle, setExtractingSingle] = useState<boolean>(false);
  const [highlightedSegmentIndex, setHighlightedSegmentIndex] = useState<number | null>(null);
  const markdownContainerRef = useRef<HTMLDivElement>(null);
  const [copiedBlockId, setCopiedBlockId] = useState<number | string | null>(null);

  const handleCopyMarkdownBlock = async (
    text: string,
    blockId: number | string,
    e?: React.MouseEvent
  ) => {
    if (e) e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopiedBlockId(blockId);
      setTimeout(() => {
        setCopiedBlockId((prev) => (prev === blockId ? null : prev));
      }, 2000);
    } catch (err) {
      console.error("Error al copiar bloque:", err);
    }
  };

  // ── Modal de Edición de Asignatura ──
  const [editingItem, setEditingItem] = useState<{
    docName: string;
    item: AsignaturaExtraida;
  } | null>(null);

  // ── Drawer de Inspección de Supabase ──
  const [showDbDrawer, setShowDbDrawer] = useState<boolean>(false);
  const [dbRecords, setDbRecords] = useState<any[]>([]);
  const [dbTotalCount, setDbTotalCount] = useState<number>(0);
  const [loadingDbRecords, setLoadingDbRecords] = useState<boolean>(false);
  const [dbSearchQuery, setDbSearchQuery] = useState<string>("");

  // 1. Sincronizar documentos de IndexedDB y lote al montar
  useEffect(() => {
    async function loadDocs() {
      setLoadingDocs(true);
      try {
        const stored = await getAllClientDocuments();
        const storedMap = new Map(stored.map((d) => [d.name, d]));

        const validNames = batchData?.files && batchData.files.length > 0 ? new Set(batchData.files.map((f) => f.name)) : null;

        // Si batchData trae un lote específico, eliminar de IndexedDB cualquier archivo que no pertenezca al lote actual
        if (validNames && batchData?.batchId !== "client-storage-batch" && batchData?.batchId !== "local-indexeddb") {
          for (const doc of stored) {
            if (!validNames.has(doc.name)) {
              await deleteClientDocument(doc.name);
              storedMap.delete(doc.name);
            }
          }
        }

        // Si batchData trae archivos, fusionarlos
        const toSave: ClientPdfDocument[] = [];
        if (batchData?.files) {
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
        }

        if (toSave.length > 0) {
          await saveClientDocuments(toSave);
        }

        const allDocs = Array.from(storedMap.values())
          .filter((doc) => !validNames || validNames.has(doc.name))
          .sort((a, b) => {
            // Primero los que ya tienen markdown
            const aHasMd = a.markdown && a.markdown.length > 0;
            const bHasMd = b.markdown && b.markdown.length > 0;
            if (aHasMd && !bHasMd) return -1;
            if (!aHasMd && bHasMd) return 1;
            if (a.isAnexo3 && !b.isAnexo3) return -1;
            if (!a.isAnexo3 && b.isAnexo3) return 1;
            return a.name.localeCompare(b.name);
          });

        setDocuments(allDocs);

        // Seleccionar primer documento que tenga Markdown
        const firstWithMd = allDocs.find((d) => d.markdown && d.markdown.length > 0);
        if (firstWithMd) {
          setActiveDocName(firstWithMd.name);
          setOpenTabs([firstWithMd.name]);
        } else if (allDocs.length > 0) {
          setActiveDocName(allDocs[0].name);
          setOpenTabs([allDocs[0].name]);
        }
      } catch (err) {
        console.error("Error al cargar documentos de IndexedDB:", err);
      } finally {
        setLoadingDocs(false);
      }
    }
    loadDocs();
  }, [batchData]);

  const activeDoc = useMemo(
    () => documents.find((d) => d.name === activeDocName),
    [documents, activeDocName]
  );

  // 2. Extraer asignaturas cuando cambie el documento activo, el delimitador o las reglas
  useEffect(() => {
    if (!activeDoc || !activeDoc.markdown) return;

    startTransition(() => {
      const extracted = processMarkdownWithRules(
        activeDoc.markdown!,
        activeRegexConfig.delimiter,
        activeRegexConfig.rules,
        activeRegexConfig.isDelimiterRegex
      );

      // Sincronizar estado con claves existentes en la base de datos
      const withStatus = extracted.map((item) => {
        const cleanUpper = item.clave.trim().toUpperCase();
        if (cleanUpper && dbExistingClaves.has(cleanUpper)) {
          return {
            ...item,
            status: "skipped_duplicate" as const,
            statusMessage: `La clave "${item.clave}" ya existe en Supabase`,
          };
        }
        return item;
      });

      setExtractionsMap((prev) => ({
        ...prev,
        [activeDoc.name]: withStatus,
      }));
    });
  }, [
    activeDoc?.name,
    activeDoc?.markdown,
    activeRegexConfig.delimiter,
    activeRegexConfig.rules,
    activeRegexConfig.isDelimiterRegex,
    dbExistingClaves
  ]);

  // Asignaturas del documento activo
  const activeEntries = useMemo(() => {
    return extractionsMap[activeDocName] || [];
  }, [extractionsMap, activeDocName]);

  // Segmentos estructurados sincronizados para el visor de Markdown
  const structuredMarkdown = useMemo(() => {
    if (!activeDoc?.markdown) return null;
    return getStructuredMarkdownForView(
      activeDoc.markdown,
      activeRegexConfig.delimiter,
      activeRegexConfig.isDelimiterRegex
    );
  }, [activeDoc?.markdown, activeRegexConfig.delimiter, activeRegexConfig.isDelimiterRegex]);

  // Análisis de valores atípicos de longitud de caracteres por campo
  const outlierReports = useMemo(() => {
    return analyzeOutliers(activeEntries);
  }, [activeEntries]);

  // Filtro de visualización en el listado de asignaturas
  // "all" = todas, "not_in_db" = solo las que no están en Supabase, "outliers" = solo con valores atípicos
  const [entriesFilter, setEntriesFilter] = useState<"all" | "not_in_db" | "outliers">("all");

  // Conteo de asignaturas que NO están en la tabla de Supabase (pendientes o con error)
  const notInDbCount = useMemo(() => {
    return activeEntries.filter(
      (e) => e.status !== "skipped_duplicate" && e.status !== "uploaded"
    ).length;
  }, [activeEntries]);

  // Lista de asignaturas visibles según el filtro seleccionado
  const displayedEntries = useMemo(() => {
    return activeEntries.filter((e) => {
      if (entriesFilter === "not_in_db") {
        if (e.status === "skipped_duplicate" || e.status === "uploaded") return false;
      }
      if (entriesFilter === "outliers") {
        if (!outlierReports.get(e.segmentIndex)?.hasOutliers) return false;
      }
      return true;
    });
  }, [activeEntries, entriesFilter, outlierReports]);

  // 3. Extraer Markdown con unpdf bajo demanda si el archivo aún no tiene
  const handleExtractWithUnpdf = async (docName: string) => {
    const doc = documents.find((d) => d.name === docName);
    if (!doc) return;

    setExtractingSingle(true);
    try {
      let res: Response;
      if (doc.blob) {
        const formData = new FormData();
        formData.append("file", doc.blob, doc.name);
        res = await fetch(`/${TOOL_SLUG}/api/unpdf/extract`, {
          method: "POST",
          body: formData,
        });
      } else {
        const fileInBatch = batchData.files?.find((f) => f.name === doc.name);
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

      const json = await res.json();
      if (json.success && json.markdown) {
        const pageCount = json.pageCount || 1;
        const runtimeSeconds = json.runtimeSeconds || 0.1;

        await updateClientDocumentMarkdown(docName, json.markdown, pageCount, runtimeSeconds);

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

        setNotification({
          type: "success",
          title: "Markdown extraído exitosamente",
          message: `"${docName}" convertido a Markdown en ${runtimeSeconds}s (${pageCount} págs) con unpdf.`,
        });
      } else {
        throw new Error(json.error || "No se pudo extraer el texto del PDF.");
      }
    } catch (err: any) {
      setNotification({
        type: "error",
        title: "Error al extraer con unpdf",
        message: err.message || "Error al procesar el archivo.",
      });
    } finally {
      setExtractingSingle(false);
    }
  };

  // 4. Consultar claves existentes en Supabase cuando cambien las asignaturas del documento activo
  const verifyClavesAgainstDb = async (entriesToCheck?: AsignaturaExtraida[]) => {
    const list = entriesToCheck || activeEntries;
    const claves = list
      .map((e) => e.clave?.trim())
      .filter((c) => Boolean(c) && c.length > 0);

    if (claves.length === 0) return;

    setCheckingDb(true);
    try {
      const res = await fetch(`/${TOOL_SLUG}/api/asignaturas/check-claves`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claves }),
      });

      const json = await res.json();
      if (json.success && Array.isArray(json.existingClaves)) {
        const newSet = new Set(dbExistingClaves);
        json.existingClaves.forEach((k: string) => newSet.add(k.toUpperCase()));
        setDbExistingClaves(newSet);

        // Actualizar estados en el mapa
        setExtractionsMap((prev) => {
          const updated = { ...prev };
          Object.keys(updated).forEach((docKey) => {
            updated[docKey] = updated[docKey].map((item) => {
              const upper = item.clave?.trim().toUpperCase();
              if (upper && newSet.has(upper) && item.status !== "uploaded") {
                return {
                  ...item,
                  status: "skipped_duplicate",
                  statusMessage: `La clave "${item.clave}" ya existe en la base de datos de Supabase`,
                };
              }
              return item;
            });
          });
          return updated;
        });

        if (json.existingClaves.length > 0) {
          setNotification({
            type: "warning",
            title: "Claves existentes detectadas",
            message: `Se encontraron ${json.existingClaves.length} asignaturas cuya clave ya está en Supabase (${json.existingClaves.slice(0, 4).join(", ")}${json.existingClaves.length > 4 ? "..." : ""}). No se duplicarán.`,
          });
        } else {
          setNotification({
            type: "success",
            title: "Todas las claves son nuevas",
            message: `Las ${claves.length} claves verificadas están disponibles para insertarse sin conflictos.`,
          });
        }
      }
    } catch (err) {
      console.error("Error verificando claves contra Supabase:", err);
      setNotification({
        type: "error",
        title: "Error de conexión",
        message: "No se pudieron verificar las claves con Supabase.",
      });
    } finally {
      setCheckingDb(false);
    }
  };

  useEffect(() => {
    if (activeEntries.length > 0 && !checkingDb) {
      verifyClavesAgainstDb(activeEntries);
    }
  }, [activeDocName]);

  // 5. Subir una sola asignatura a Supabase
  const handleUploadSingle = async (item: AsignaturaExtraida) => {
    const cleanClave = item.clave?.trim().toUpperCase();

    if (cleanClave && dbExistingClaves.has(cleanClave)) {
      setNotification({
        type: "error",
        title: "Registro omitido",
        message: `La clave "${item.clave}" ya existe en la tabla de Supabase. No se permite duplicar.`,
      });
      return;
    }

    setExtractionsMap((prev) => ({
      ...prev,
      [activeDocName]: prev[activeDocName].map((x) =>
        x.segmentIndex === item.segmentIndex ? { ...x, status: "uploading" } : x
      ),
    }));

    try {
      const res = await fetch(`/${TOOL_SLUG}/api/asignaturas/insert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item: {
            nombre: item.nombre,
            clave: item.clave || null,
            fines_de_aprendizaje_o_formacion: item.fines_de_aprendizaje_o_formacion,
            contenido_tematico: item.contenido_tematico,
            actividades_de_aprendizaje: item.actividades_de_aprendizaje,
          },
        }),
      });

      const json = await res.json();

      if (json.success && json.insertedCount > 0) {
        const insertedId = json.inserted[0]?.id;
        if (cleanClave) {
          setDbExistingClaves((prev) => new Set([...prev, cleanClave]));
        }

        setExtractionsMap((prev) => ({
          ...prev,
          [activeDocName]: prev[activeDocName].map((x) =>
            x.segmentIndex === item.segmentIndex
              ? {
                ...x,
                status: "uploaded",
                uploadedId: insertedId,
                statusMessage: `Insertado con ID #${insertedId}`,
              }
              : x
          ),
        }));

        setNotification({
          type: "success",
          title: "Asignatura subida exitosamente",
          message: `"${item.nombre}" (${item.clave || "Sin clave"}) guardada en Supabase con ID #${insertedId}.`,
        });
      } else if (json.skippedCount > 0) {
        if (cleanClave) {
          setDbExistingClaves((prev) => new Set([...prev, cleanClave]));
        }
        setExtractionsMap((prev) => ({
          ...prev,
          [activeDocName]: prev[activeDocName].map((x) =>
            x.segmentIndex === item.segmentIndex
              ? {
                ...x,
                status: "skipped_duplicate",
                statusMessage: json.skipped[0]?.reason || "Clave ya existe en BD",
              }
              : x
          ),
        }));
        setNotification({
          type: "warning",
          title: "Registro omitido",
          message: json.skipped[0]?.reason || "La clave ya existe en Supabase.",
        });
      } else {
        throw new Error(json.error || "No se pudo insertar la asignatura.");
      }
    } catch (err: any) {
      setExtractionsMap((prev) => ({
        ...prev,
        [activeDocName]: prev[activeDocName].map((x) =>
          x.segmentIndex === item.segmentIndex
            ? { ...x, status: "error", statusMessage: err.message || "Error al subir" }
            : x
        ),
      }));
      setNotification({
        type: "error",
        title: "Error al subir",
        message: err.message || "No se pudo conectar con Supabase.",
      });
    }
  };

  // 6. Subir todas las asignaturas nuevas a Supabase
  const handleUploadAllNew = async () => {
    const candidates = activeEntries.filter(
      (e) => e.status !== "uploaded" && e.status !== "skipped_duplicate"
    );

    if (candidates.length === 0) {
      setNotification({
        type: "info",
        title: "No hay asignaturas nuevas",
        message: "Todas las asignaturas ya fueron subidas o sus claves ya existen en Supabase.",
      });
      return;
    }

    setUploadingAll(true);
    setUploadProgress({ current: 0, total: candidates.length });

    try {
      const payloadItems = candidates.map((item) => ({
        nombre: item.nombre,
        clave: item.clave || null,
        fines_de_aprendizaje_o_formacion: item.fines_de_aprendizaje_o_formacion,
        contenido_tematico: item.contenido_tematico,
        actividades_de_aprendizaje: item.actividades_de_aprendizaje,
      }));

      const res = await fetch(`/${TOOL_SLUG}/api/asignaturas/insert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payloadItems }),
      });

      const json = await res.json();

      if (json.success) {
        const insertedMap = new Map<string, number>();
        (json.inserted || []).forEach((row: any) => {
          if (row.clave) {
            insertedMap.set(row.clave.trim().toUpperCase(), row.id);
          }
        });

        const skippedSet = new Set<string>();
        (json.skipped || []).forEach((s: any) => {
          if (s.item?.clave) {
            skippedSet.add(s.item.clave.trim().toUpperCase());
          }
        });

        setDbExistingClaves((prev) => {
          const next = new Set(prev);
          insertedMap.forEach((_, k) => next.add(k));
          skippedSet.forEach((k) => next.add(k));
          return next;
        });

        setExtractionsMap((prev) => ({
          ...prev,
          [activeDocName]: prev[activeDocName].map((item) => {
            const upper = item.clave?.trim().toUpperCase();
            if (upper && insertedMap.has(upper)) {
              return {
                ...item,
                status: "uploaded",
                uploadedId: insertedMap.get(upper),
                statusMessage: `Insertado con ID #${insertedMap.get(upper)}`,
              };
            }
            if (upper && skippedSet.has(upper)) {
              return {
                ...item,
                status: "skipped_duplicate",
                statusMessage: "Omitido: clave ya existe en Supabase",
              };
            }
            return item;
          }),
        }));

        setNotification({
          type: json.insertedCount > 0 ? "success" : "warning",
          title: "Proceso de sincronización completado",
          message: json.message,
        });
      } else {
        throw new Error(json.error || "Error al insertar lote.");
      }
    } catch (err: any) {
      setNotification({
        type: "error",
        title: "Error en inserción",
        message: err.message || "Error al comunicarse con Supabase.",
      });
    } finally {
      setUploadingAll(false);
      setUploadProgress(null);
    }
  };

  // 7. Drawer de inspección de Supabase
  const fetchDbRecords = async () => {
    setLoadingDbRecords(true);
    try {
      const url = `/${TOOL_SLUG}/api/asignaturas/list?limit=60${dbSearchQuery ? `&query=${encodeURIComponent(dbSearchQuery)}` : ""
        }`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.success) {
        setDbRecords(json.data || []);
        setDbTotalCount(json.totalCount || 0);
      }
    } catch (err) {
      console.error("Error al obtener registros de Supabase:", err);
    } finally {
      setLoadingDbRecords(false);
    }
  };

  useEffect(() => {
    if (showDbDrawer) {
      fetchDbRecords();
    }
  }, [showDbDrawer, dbSearchQuery]);

  // 8. Manejo de Pestañas y Navegación entre Documentos
  const handleOpenDoc = (docName: string) => {
    if (!openTabs.includes(docName)) {
      setOpenTabs([...openTabs, docName]);
    }
    setActiveDocName(docName);
  };

  const handleCloseTab = (docName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const filtered = openTabs.filter((t) => t !== docName);
    setOpenTabs(filtered);
    if (activeDocName === docName && filtered.length > 0) {
      setActiveDocName(filtered[filtered.length - 1]);
    }
  };

  // Calcular asignaturas (Split + Regex)
  const handleCalculateSubjects = async () => {
    setIsCalculatingSubjects(true);
    let regex: RegExp;
    try {
      regex = new RegExp(calcClaveRegex, "i");
    } catch (e) {
      alert("La expresión regular de la Clave no es válida.");
      setIsCalculatingSubjects(false);
      return;
    }

    const docExtractedClaves: Record<string, string[]> = {};
    const allClaves: string[] = [];

    documents.forEach((doc) => {
      if (!doc.markdown) {
        docExtractedClaves[doc.name] = [];
        return;
      }

      const blocks = doc.markdown.split(calcDelimiter);
      const clavesInDoc: string[] = [];
      // Empezar en 1 para saltar el contenido antes del primer delimitador
      for (let i = 1; i < blocks.length; i++) {
        const match = blocks[i].match(regex);
        if (match && match[1]) {
          const clave = match[1].trim().toUpperCase();
          clavesInDoc.push(clave);
          allClaves.push(clave);
        } else if (match && match[0]) {
          const clave = match[0].trim().toUpperCase();
          clavesInDoc.push(clave);
          allClaves.push(clave);
        }
      }
      docExtractedClaves[doc.name] = clavesInDoc;
    });

    let existingClavesSet = new Set<string>();
    if (allClaves.length > 0) {
      try {
        const res = await fetch(`/${TOOL_SLUG}/api/asignaturas/check-claves`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claves: allClaves }),
        });
        const json = await res.json();
        if (json.success && Array.isArray(json.existingClaves)) {
          json.existingClaves.forEach((k: string) => existingClavesSet.add(k.toUpperCase()));
        }
      } catch (e) {
        console.error("Error verificando claves masivas:", e);
      }
    }

    const counts: Record<string, { total: number, ready: number, inDb: number }> = {};
    Object.keys(docExtractedClaves).forEach(docName => {
      const claves = docExtractedClaves[docName];
      let inDb = 0;
      claves.forEach(c => {
        if (existingClavesSet.has(c)) {
          inDb++;
        }
      });
      counts[docName] = {
        total: claves.length,
        inDb,
        ready: claves.length - inDb
      };
    });

    setDocumentSubjectCounts(counts);
    setIsSortedByCount(true);
    setIsCalculatingSubjects(false);
  };

  // Filtrado de documentos en la barra lateral
  const filteredDocs = useMemo(() => {
    let result = documents.filter((d) => {
      const matchesSearch = d.name.toLowerCase().includes(docSearch.toLowerCase());
      if (!matchesSearch) return false;

      if (docFilter === "has_md") return Boolean(d.markdown && d.markdown.length > 0);
      if (docFilter === "anexo3") return d.isAnexo3;
      if (docFilter === "pending") return !d.markdown || d.markdown.length === 0;
      return true;
    });

    if (markdownSearchText.trim()) {
      result = [...result].sort((a, b) => {
        const countA = documentSearchCounts[a.name] || 0;
        const countB = documentSearchCounts[b.name] || 0;
        return countB - countA;
      });
    } else if (isSortedByCount) {
      result = [...result].sort((a, b) => {
        const statsA = documentSubjectCounts[a.name];
        const statsB = documentSubjectCounts[b.name];
        const readyA = statsA ? statsA.ready : 0;
        const readyB = statsB ? statsB.ready : 0;
        return readyB - readyA;
      });
    }

    return result;
  }, [documents, docSearch, docFilter, isSortedByCount, documentSubjectCounts, markdownSearchText, documentSearchCounts]);

  // Índice actual para Anterior / Siguiente
  const currentDocIndex = useMemo(() => {
    return filteredDocs.findIndex((d) => d.name === activeDocName);
  }, [filteredDocs, activeDocName]);

  const handlePrevDoc = () => {
    if (currentDocIndex > 0) {
      const prev = filteredDocs[currentDocIndex - 1];
      handleOpenDoc(prev.name);
    }
  };

  const handleNextDoc = () => {
    if (currentDocIndex >= 0 && currentDocIndex < filteredDocs.length - 1) {
      const next = filteredDocs[currentDocIndex + 1];
      handleOpenDoc(next.name);
    }
  };

  // Scroll a segmento en el Visor de Markdown con soporte para cambio de vista y resaltado garantizado
  const scrollToSegment = (segmentIdx: number) => {
    setHighlightedSegmentIndex(segmentIdx);

    const wasEntriesOnly = viewMode === "entries";
    if (wasEntriesOnly) {
      setViewMode("split");
    }

    const performScroll = () => {
      if (!markdownContainerRef.current) return;
      const container = markdownContainerRef.current;
      const target = container.querySelector<HTMLElement>(
        `[data-segment="${segmentIdx}"]`
      );

      if (target) {
        // Calcular la posición exacta con respecto al contenedor con scroll
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const relativeTop = targetRect.top - containerRect.top + container.scrollTop;

        container.scrollTo({
          top: Math.max(0, relativeTop - 12),
          behavior: "smooth",
        });

        // Asegurar que el visor de Markdown sea visible en la ventana si el usuario estaba scrolleado abajo
        if (containerRect.top < 70 || containerRect.bottom > window.innerHeight) {
          container.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        }
      }
    };

    // Si cambió de vista, dar tiempo para que el DOM se monte
    setTimeout(performScroll, wasEntriesOnly ? 150 : 40);
  };

  // Estadísticas del documento activo
  const stats = useMemo(() => {
    const total = activeEntries.length;
    const uploaded = activeEntries.filter((e) => e.status === "uploaded").length;
    const skippedDuplicate = activeEntries.filter(
      (e) => e.status === "skipped_duplicate"
    ).length;
    const readyToUpload = activeEntries.filter(
      (e) => e.status === "pending"
    ).length;
    const withOutliers = activeEntries.filter(
      (e) => outlierReports.get(e.segmentIndex)?.hasOutliers
    ).length;

    return { total, uploaded, skippedDuplicate, readyToUpload, withOutliers };
  }, [activeEntries, outlierReports]);

  // Contadores de documentos globales
  const docCounts = useMemo(() => {
    const total = documents.length;
    const withMd = documents.filter((d) => d.markdown && d.markdown.length > 0).length;
    const anexo3 = documents.filter((d) => d.isAnexo3).length;
    const pending = total - withMd;
    return { total, withMd, anexo3, pending };
  }, [documents]);

  return (
    <div className="space-y-5">
      {/* ── Barra Superior / Stepper & Acciones Globales ── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between rounded-2xl border border-white/10 bg-slate-900/60 p-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToStep2}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver a Paso 2 (Explorador)
          </button>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-400 font-mono text-xs font-bold border border-indigo-500/30">
              3
            </span>
            <span className="text-sm font-semibold text-white">
              Paso 3: Extracción Regex y Sincronización con Supabase
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Toggle de Explorador de Archivos */}
          <button
            type="button"
            onClick={() => setShowFileExplorer(!showFileExplorer)}
            className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-medium transition cursor-pointer ${showFileExplorer
              ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-200"
              : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
              }`}
            title="Mostrar u ocultar la barra lateral de navegación de archivos"
          >
            {showFileExplorer ? (
              <FolderOpen className="h-4 w-4 text-emerald-400" />
            ) : (
              <FolderClosed className="h-4 w-4 text-slate-400" />
            )}
            <span>Navegador de Markdowns ({docCounts.withMd}/{docCounts.total})</span>
          </button>

          {/* Botón para abrir el inspector de Supabase */}
          <button
            type="button"
            onClick={() => setShowDbDrawer(true)}
            className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3.5 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-900/50 transition cursor-pointer"
          >
            <Database className="h-4 w-4 text-emerald-400" />
            Tabla Supabase ({dbTotalCount > 0 ? `${dbTotalCount} en BD` : "En vivo"})
          </button>

          {/* Toggle de configuración de Regex */}
          <button
            type="button"
            onClick={() => setShowConfigPanel(!showConfigPanel)}
            className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-medium transition cursor-pointer ${showConfigPanel
              ? "border-indigo-500 bg-indigo-500/20 text-indigo-200"
              : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
              }`}
          >
            <Sliders className="h-4 w-4 text-indigo-400" />
            <span>Configurar Regex</span>
            {isCurrentDocCustom && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-mono text-amber-300 border border-amber-500/30">
                Personalizado
              </span>
            )}
            {showConfigPanel ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          {/* Selector de modo de vista */}
          <div className="flex items-center rounded-xl border border-white/10 bg-slate-950/60 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("split")}
              title="Vista Dividida (Markdown + Asignaturas)"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${viewMode === "split"
                ? "bg-indigo-600 text-white shadow"
                : "text-slate-400 hover:text-white"
                }`}
            >
              <Columns className="h-3.5 w-3.5" />
              Dividida
            </button>
            <button
              type="button"
              onClick={() => setViewMode("entries")}
              title="Solo Asignaturas Extraídas"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${viewMode === "entries"
                ? "bg-indigo-600 text-white shadow"
                : "text-slate-400 hover:text-white"
                }`}
            >
              <TableIcon className="h-3.5 w-3.5" />
              Asignaturas
            </button>
            <button
              type="button"
              onClick={() => setViewMode("markdown")}
              title="Solo Visor de Markdown"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${viewMode === "markdown"
                ? "bg-indigo-600 text-white shadow"
                : "text-slate-400 hover:text-white"
                }`}
            >
              <FileCode className="h-3.5 w-3.5" />
              Markdown
            </button>
          </div>
        </div>
      </div>

      {/* ── Banner de Notificación Dinámica ── */}
      {notification && (
        <div
          className={`flex items-start justify-between gap-3 rounded-xl border p-4 text-xs transition ${notification.type === "success"
            ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-200"
            : notification.type === "warning"
              ? "border-amber-500/40 bg-amber-950/30 text-amber-200"
              : notification.type === "error"
                ? "border-red-500/40 bg-red-950/30 text-red-200"
                : "border-indigo-500/40 bg-indigo-950/30 text-indigo-200"
            }`}
        >
          <div className="flex items-start gap-2.5">
            {notification.type === "success" && <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />}
            {notification.type === "warning" && <ShieldAlert className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />}
            {notification.type === "error" && <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />}
            {notification.type === "info" && <Info className="h-4 w-4 text-indigo-400 mt-0.5 shrink-0" />}
            <div>
              <p className="font-semibold">{notification.title}</p>
              <p className="mt-0.5 opacity-90">{notification.message}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="text-slate-400 hover:text-white transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Barra de Navegación Rápida Anterior / Siguiente / Dropdown Jump ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-900/80 px-4 py-2.5 backdrop-blur-md">
        {/* Navegación Anterior / Selector / Siguiente */}
        <div className="flex items-center gap-2 flex-1 min-w-[280px]">
          <button
            type="button"
            onClick={handlePrevDoc}
            disabled={currentDocIndex <= 0}
            className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            title="PDF Anterior"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Anterior PDF</span>
          </button>

          {/* Selector desplegable de Documentos */}
          <div className="flex-1 max-w-md">
            <select
              value={activeDocName}
              onChange={(e) => handleOpenDoc(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-xs font-medium text-white focus:border-indigo-500 focus:outline-none cursor-pointer truncate"
            >
              {filteredDocs.map((doc, idx) => {
                const hasMd = Boolean(doc.markdown && doc.markdown.length > 0);
                const count = extractionsMap[doc.name]?.length;
                return (
                  <option key={doc.name} value={doc.name}>
                    {idx + 1}. {doc.name} {hasMd ? `(✅ ${count ?? "?"} materias)` : "(⏳ Sin extraer)"}
                  </option>
                );
              })}
            </select>
          </div>

          <button
            type="button"
            onClick={handleNextDoc}
            disabled={currentDocIndex < 0 || currentDocIndex >= filteredDocs.length - 1}
            className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            title="Siguiente PDF"
          >
            <span className="hidden sm:inline">Siguiente PDF</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Indicador de posición y estado de Markdown */}
        <div className="flex items-center gap-3 text-xs">
          <span className="text-slate-400">
            Documento{" "}
            <strong className="text-white font-mono">
              {currentDocIndex >= 0 ? currentDocIndex + 1 : 0}
            </strong>{" "}
            de <strong className="text-white font-mono">{filteredDocs.length}</strong>
          </span>

          {activeDoc?.markdown ? (
            <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
              <Check className="h-3 w-3" />
              Markdown Listo ({activeDoc.pageCount || 1} págs)
            </span>
          ) : (
            <button
              type="button"
              onClick={() => activeDoc && handleExtractWithUnpdf(activeDoc.name)}
              disabled={extractingSingle || !activeDoc}
              className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition cursor-pointer"
            >
              <Zap className="h-3 w-3" />
              {extractingSingle ? "Extrayendo..." : "Extraer con unpdf ahora"}
            </button>
          )}
        </div>
      </div>

      {/* ── Panel de Configuración de Regex y Delimitador (Colapsable) ── */}
      {showConfigPanel && (
        <div className="rounded-2xl border border-indigo-500/30 bg-slate-900/90 p-5 backdrop-blur-xl shadow-2xl space-y-5 animate-in fade-in slide-in-from-top-4 duration-200">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Sliders className="h-5 w-5 text-indigo-400" />
                <h2 className="text-sm font-bold text-white">
                  Configuración del Delimitador y Filtros Regex
                </h2>

                {isCurrentDocCustom ? (
                  <span className="flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300 border border-amber-500/30">
                    <FileText className="h-3 w-3" />
                    Personalizado para este documento
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-300 border border-indigo-500/30">
                    <Globe className="h-3 w-3" />
                    Usando configuración Default global
                  </span>
                )}

                {lastSavedTime && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    (Guardado: {lastSavedTime})
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-400">
                {isCurrentDocCustom ? (
                  <>
                    Modificando reglas específicas para{" "}
                    <span className="font-semibold text-slate-200">{activeDocName}</span>. No afecta a los demás documentos.
                  </>
                ) : (
                  <>
                    {activeDocName ? (
                      <>
                        Documento activo: <span className="font-semibold text-slate-200">{activeDocName}</span>. Cualquier cambio guardará una regla propia para este documento.
                      </>
                    ) : (
                      "Edición de la configuración predeterminada global."
                    )}
                  </>
                )}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative group">
                <button className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-indigo-500/10 px-2.5 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/20 hover:text-indigo-200 transition cursor-pointer h-full">
                  <Save className="h-3 w-3" />
                  Perfiles Guardados
                </button>
                <div className="absolute left-0 top-full mt-2 w-56 bg-slate-900 border border-white/10 rounded-xl shadow-xl shadow-black/50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 overflow-hidden">
                  {Object.keys(savedProfiles).length === 0 ? (
                    <div className="px-3 py-3 text-xs text-slate-500 italic text-center">
                      No tienes perfiles guardados.
                    </div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto">
                      {Object.keys(savedProfiles).map(prof => (
                        <div key={prof} className="flex items-center justify-between px-3 py-2 hover:bg-white/5 cursor-pointer border-b border-white/5 last:border-0" onClick={() => handleLoadProfile(prof)}>
                          <span className="text-xs font-medium text-slate-300 truncate pr-2">{prof}</span>
                          <button onClick={(e) => handleDeleteProfile(prof, e)} className="text-slate-500 hover:text-red-400 transition" title="Eliminar perfil">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="p-2 border-t border-white/10 bg-black/20">
                    <button onClick={handleSaveProfile} className="w-full text-center py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-200 transition">
                      + Guardar Config. Actual
                    </button>
                  </div>
                </div>
              </div>

              <div className="w-px h-4 bg-white/10"></div>

              {/* Botón para volver este filtro el DEFAULT */}
              <button
                type="button"
                onClick={handleMakeCurrentDefault}
                className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-md shadow-indigo-500/25 hover:bg-indigo-500 transition cursor-pointer"
                title="Establece este filtro como el nuevo predeterminado para todos los documentos que no tengan cambios específicos. No sobreescribirá los documentos que ya tienen filtros propios."
              >
                <BookmarkCheck className="h-3.5 w-3.5" />
                Volver este filtro el Default
              </button>

              {/* Si el doc tiene configuración personalizada, botón para volver al default */}
              {isCurrentDocCustom && (
                <button
                  type="button"
                  onClick={handleResetCurrentDocToDefault}
                  className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-950/40 hover:text-amber-100 transition cursor-pointer"
                  title="Elimina los cambios específicos de este documento y vuelve a usar la configuración default"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Volver al Default
                </button>
              )}

              {/* Botón para restablecer valores de fábrica */}
              <button
                type="button"
                onClick={handleResetFactoryDefaults}
                className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition cursor-pointer"
                title="Restaura la configuración default a los valores de fábrica originales"
              >
                <RotateCcw className="h-3 w-3 text-slate-400" />
                Valores de fábrica
              </button>
            </div>
          </div>

          {/* 1. Delimitador de Segmentos */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                <span>1. Delimitador de Segmentos (Markdown)</span>
                <span className="text-[10px] font-normal text-slate-400">
                  {isCurrentDocCustom
                    ? `Regla propia de ${activeDocName || "este documento"}. Se guarda automáticamente.`
                    : "Divide el markdown en asignaturas. Al editarlo se guardará como regla propia para este documento."}
                </span>
              </label>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                {activeEntries.length} asignaturas detectadas
              </span>
            </div>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={delimiter}
                onChange={(e) => handleDelimiterChange(e.target.value)}
                placeholder="Ej. ### DENOMINACIÓN DE LA ASIGNATURA"
                className="flex-1 rounded-xl border border-white/10 bg-slate-950 px-3.5 py-2 text-xs font-mono text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 bg-white/5 cursor-pointer hover:bg-white/10 transition group">
                <input
                  type="checkbox"
                  checked={Boolean(currentDraft.isDelimiterRegex)}
                  onChange={(e) => handleDelimiterChange(delimiter, e.target.checked)}
                  className="rounded border-white/20 bg-slate-900 text-indigo-500 focus:ring-indigo-500/30 w-3.5 h-3.5 cursor-pointer"
                />
                <span className="text-[11px] font-medium text-slate-300 group-hover:text-white flex items-center gap-1">
                  <FileCode className="h-3 w-3 text-indigo-400" />
                  Interpretar como Regex
                </span>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-slate-400 mr-1">Preajustes rápidos:</span>
              {[
                "### DENOMINACIÓN DE LA ASIGNATURA",
                "### DENOMINACIÓN",
                "### FINES DE APRENDIZAJE O FORMACIÓN",
                "---",
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleDelimiterChange(preset)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-mono transition cursor-pointer border ${delimiter === preset
                    ? "bg-indigo-600 text-white border-indigo-500"
                    : "bg-white/5 text-slate-300 border-white/10 hover:bg-white/10 hover:text-white"
                    }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Reglas Regex por Cada Campo */}
          <div className="space-y-3 pt-2 border-t border-white/10">
            <label className="text-xs font-semibold text-slate-200 block">
              2. Expresiones Regulares por Campo de la Tabla (<code className="text-emerald-400 font-mono">public.asignaturas_extraidas</code>)
            </label>

            <div className="flex flex-wrap gap-1.5 border-b border-white/10 pb-2">
              {(Object.keys(rules) as AsignaturaFieldKey[]).map((fieldKey) => {
                const rule = rules[fieldKey];
                const isActive = activeConfigTab === fieldKey;
                return (
                  <button
                    key={fieldKey}
                    type="button"
                    onClick={() => setActiveConfigTab(fieldKey)}
                    className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium transition cursor-pointer border ${isActive
                      ? "bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-500/20"
                      : "bg-slate-950 text-slate-400 border-white/10 hover:text-white hover:bg-white/5"
                      }`}
                  >
                    <span>{rule.label}</span>
                    <span className="font-mono text-[10px] opacity-70">({rule.field})</span>
                  </button>
                );
              })}
            </div>

            {(() => {
              const currentRule = rules[activeConfigTab];
              return (
                <div className="rounded-xl border border-white/10 bg-slate-950 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-semibold text-white flex items-center gap-2">
                        <span>Campo: {currentRule.label}</span>
                        <code className="text-[11px] text-indigo-400 font-mono bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-500/30">
                          {currentRule.field}
                        </code>
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">{currentRule.description}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-2">
                    <div className="md:col-span-8 space-y-1">
                      <label className="text-[11px] text-slate-300 font-medium">Patrón Regex</label>
                      <input
                        type="text"
                        value={currentRule.pattern}
                        onChange={(e) => {
                          handleRuleChange(activeConfigTab, { pattern: e.target.value });
                        }}
                        className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs font-mono text-emerald-300 focus:border-indigo-500 focus:outline-none"
                      />
                    </div>

                    <div className="md:col-span-2 space-y-1">
                      <label className="text-[11px] text-slate-300 font-medium">Banderas</label>
                      <input
                        type="text"
                        value={currentRule.flags}
                        onChange={(e) => {
                          handleRuleChange(activeConfigTab, { flags: e.target.value });
                        }}
                        className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs font-mono text-slate-200 focus:border-indigo-500 focus:outline-none"
                      />
                    </div>

                    <div className="md:col-span-2 space-y-1">
                      <label className="text-[11px] text-slate-300 font-medium">Grupo Captura</label>
                      <select
                        value={currentRule.captureGroup}
                        onChange={(e) => {
                          handleRuleChange(activeConfigTab, { captureGroup: parseInt(e.target.value, 10) });
                        }}
                        className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs font-mono text-slate-200 focus:border-indigo-500 focus:outline-none cursor-pointer"
                      >
                        <option value={0}>Grupo 0 (Todo)</option>
                        <option value={1}>Grupo 1 ()</option>
                        <option value={2}>Grupo 2 ()</option>
                        <option value={3}>Grupo 3 ()</option>
                      </select>
                    </div>
                  </div>

                  {activeEntries.length > 0 && (
                    <div className="pt-2 border-t border-white/5">
                      <span className="text-[11px] text-slate-400 font-medium">
                        Previsualización con Asignatura #1 ({activeEntries[0].nombre}):
                      </span>
                      <div className="mt-1 rounded-lg border border-emerald-500/20 bg-emerald-950/20 p-2.5 text-xs font-mono text-emerald-300 max-h-24 overflow-y-auto whitespace-pre-wrap">
                        {String(activeEntries[0][activeConfigTab] || "(Sin coincidencia)")}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="flex justify-end pt-3 border-t border-white/10 mt-4 gap-2">
              {draftConfig && (
                <>
                  <button
                    type="button"
                    onClick={() => setDraftConfig(null)}
                    className="px-4 py-2 rounded-lg text-xs font-semibold bg-white/10 text-white hover:bg-white/20 transition cursor-pointer"
                  >
                    Descartar Cambios
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyDraft}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 shadow-md shadow-indigo-500/20 transition cursor-pointer"
                  >
                    <Save className="h-4 w-4" />
                    Aplicar y Guardar Filtro
                  </button>
                </>
              )}
              {!draftConfig && (
                <div className="text-xs text-slate-500 italic py-2">
                  Todos los cambios están aplicados.
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-400 pt-3 border-t border-white/5">
              <Info className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
              <span>
                Los cambios que realices se guardan por documento en tu navegador. Puedes pulsar <strong className="text-white font-semibold">«Volver este filtro el Default»</strong> en cualquier momento para que sea la base de todos los documentos que no tengan ajustes propios.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Barra de Pestañas de Archivos / Tabs estilo IDE ── */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-white/10 pb-1 scrollbar-thin">
        {openTabs.map((tabName) => {
          const isActive = tabName === activeDocName;
          const docEntries = extractionsMap[tabName] || [];
          return (
            <div
              key={tabName}
              onClick={() => setActiveDocName(tabName)}
              className={`group flex items-center gap-2 rounded-t-xl border-t border-x px-3.5 py-2 text-xs font-medium transition cursor-pointer select-none shrink-0 ${isActive
                ? "border-indigo-500/50 bg-slate-900 text-white shadow-sm"
                : "border-transparent bg-slate-950/40 text-slate-400 hover:bg-slate-900/50 hover:text-slate-200"
                }`}
            >
              <FileText className={`h-3.5 w-3.5 ${isActive ? "text-indigo-400" : "text-slate-500"}`} />
              <span className="max-w-[200px] truncate" title={tabName}>
                {tabName}
              </span>
              {docEntries.length > 0 && (
                <span className="rounded-full bg-indigo-500/20 px-1.5 py-0.2 text-[10px] font-mono text-indigo-300 border border-indigo-500/30">
                  {docEntries.length}
                </span>
              )}
              <button
                type="button"
                onClick={(e) => handleCloseTab(tabName, e)}
                className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Área de Trabajo Principal con Navegador Lateral y Split View ── */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* ── BARRA LATERAL: Explorador y Navegador de Markdowns ── */}
        {showFileExplorer && (
          <aside className="w-full lg:w-72 shrink-0 rounded-2xl border border-white/10 bg-slate-900/70 backdrop-blur-md p-3.5 space-y-3">
            {/* Header del Explorador */}
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-emerald-400" />
                <h3 className="text-xs font-bold text-white">Explorador de Markdowns</h3>
              </div>
              <span className="text-[10px] font-mono rounded bg-white/10 px-1.5 py-0.5 text-slate-300">
                {filteredDocs.length}
              </span>
            </div>

            {/* Buscador de Archivos */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Buscar PDF o Markdown..."
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {/* Filtros de la lista */}
            <div className="grid grid-cols-2 gap-1 text-[11px]">
              <button
                type="button"
                onClick={() => setDocFilter("all")}
                className={`px-2 py-1 rounded-lg text-left transition truncate cursor-pointer ${docFilter === "all"
                  ? "bg-indigo-600 text-white font-medium"
                  : "bg-white/5 text-slate-400 hover:text-white"
                  }`}
              >
                Todos ({docCounts.total})
              </button>
              <button
                type="button"
                onClick={() => setDocFilter("has_md")}
                className={`px-2 py-1 rounded-lg text-left transition truncate cursor-pointer ${docFilter === "has_md"
                  ? "bg-emerald-600 text-white font-medium"
                  : "bg-white/5 text-slate-400 hover:text-white"
                  }`}
              >
                Con MD ({docCounts.withMd})
              </button>
              <button
                type="button"
                onClick={() => setDocFilter("anexo3")}
                className={`px-2 py-1 rounded-lg text-left transition truncate cursor-pointer ${docFilter === "anexo3"
                  ? "bg-indigo-600 text-white font-medium"
                  : "bg-white/5 text-slate-400 hover:text-white"
                  }`}
              >
                Anexo 3 ({docCounts.anexo3})
              </button>
              <button
                type="button"
                onClick={() => setDocFilter("pending")}
                className={`px-2 py-1 rounded-lg text-left transition truncate cursor-pointer ${docFilter === "pending"
                  ? "bg-amber-600 text-white font-medium"
                  : "bg-white/5 text-slate-400 hover:text-white"
                  }`}
              >
                Pendientes ({docCounts.pending})
              </button>
            </div>

            {/* Calculador de Asignaturas */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowSubjectCalculator(!showSubjectCalculator)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition cursor-pointer border ${showSubjectCalculator
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
                      disabled={isCalculatingSubjects}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 text-xs font-semibold text-white transition cursor-pointer shadow-md shadow-indigo-600/20"
                    >
                      {isCalculatingSubjects ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowDownUp className="h-3.5 w-3.5" />}
                      {isCalculatingSubjects ? "Consultando..." : "Contar y Ordenar"}
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

            {/* Búsqueda en Markdown */}
            <div className="mt-3 space-y-1.5 border-t border-white/10 pt-3">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Buscar en Markdown</div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Escribe para buscar y ordenar..."
                  value={markdownSearchText}
                  onChange={(e) => setMarkdownSearchText(e.target.value)}
                  className="w-full h-8 rounded-lg border border-white/10 bg-slate-950/50 py-1.5 pl-8 pr-8 text-xs text-slate-200 placeholder-slate-500 transition focus:border-indigo-500/50 focus:bg-slate-900 focus:outline-none"
                />
                {markdownSearchText && (
                  <button
                    type="button"
                    onClick={() => setMarkdownSearchText("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Lista scrollable de archivos */}
            <div className="max-h-[600px] overflow-y-auto space-y-1 pr-1 scrollbar-thin mt-3">
              {loadingDocs ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1 text-emerald-400" />
                  Cargando documentos...
                </div>
              ) : filteredDocs.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">
                  No se encontraron documentos con este filtro.
                </div>
              ) : (
                filteredDocs.map((doc) => {
                  const isSelected = activeDocName === doc.name;
                  const hasMd = Boolean(doc.markdown && doc.markdown.length > 0);
                  const count = extractionsMap[doc.name]?.length;

                  return (
                    <div
                      key={doc.name}
                      onClick={() => handleOpenDoc(doc.name)}
                      className={`group flex items-start gap-2 rounded-xl p-2 cursor-pointer transition select-none ${isSelected
                        ? "bg-indigo-600/20 border border-indigo-500/40 text-white"
                        : "border border-transparent hover:bg-white/5 text-slate-300 hover:text-white"
                        }`}
                    >
                      <div className="mt-0.5 shrink-0">
                        {hasMd ? (
                          <FileCode className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <FileText className="h-4 w-4 text-slate-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate" title={doc.name}>
                          {doc.name}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400">
                          {hasMd ? (
                            <span className="text-emerald-400 font-mono">
                              {count ? `${count} materias` : "Markdown listo"}
                            </span>
                          ) : (
                            <span className="text-amber-400">Sin extraer</span>
                          )}
                          <span>•</span>
                          <span>{doc.formattedSize || "PDF"}</span>
                          {docConfigs[doc.name] && (
                            <>
                              <span>•</span>
                              <span
                                className="rounded bg-amber-500/20 border border-amber-500/30 px-1.5 py-0.2 text-[9px] font-mono text-amber-300 font-medium"
                                title="Este documento cuenta con delimitador o filtros regex personalizados propios"
                              >
                                Regex propio
                              </span>
                            </>
                          )}
                          {markdownSearchText.trim() && documentSearchCounts[doc.name] !== undefined && (
                            <>
                              <span>•</span>
                              <span className="text-sky-400 font-bold bg-sky-500/20 px-1.5 py-0.5 rounded border border-sky-500/30 flex items-center gap-1" title={`Apariciones de "${markdownSearchText}"`}>
                                <Search className="h-2.5 w-2.5" />
                                {documentSearchCounts[doc.name]} hits
                              </span>
                            </>
                          )}
                          {!markdownSearchText.trim() && isSortedByCount && documentSubjectCounts[doc.name] !== undefined && (
                            <>
                              <span>•</span>
                              <span className="text-indigo-400 font-bold bg-indigo-500/20 px-1.5 py-0.5 rounded border border-indigo-500/30 flex items-center gap-1" title={`${documentSubjectCounts[doc.name].total} total, ${documentSubjectCounts[doc.name].inDb} en BD`}>
                                <CheckCircle2 className="h-2.5 w-2.5" />
                                {documentSubjectCounts[doc.name].ready} listas
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        )}

        {/* ── PANEL DERECHO / CONTENIDO: Split View, Asignaturas y Markdown ── */}
        <div className="flex-1 min-w-0 space-y-4 w-full">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Panel de Markdown */}
            {(viewMode === "split" || viewMode === "markdown") && (
              <div
                className={`${viewMode === "markdown" ? "lg:col-span-12" : "lg:col-span-5"
                  } space-y-3`}
              >
                {/* Cabecera del Visor de Markdown con Navegador de Segmentos */}
                <div className="rounded-xl border border-white/10 bg-slate-900/80 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <FileCode className="h-4 w-4 text-indigo-400 shrink-0" />
                      <span className="text-xs font-semibold text-white truncate" title={activeDoc?.name}>
                        {activeDoc?.name || "Sin documento seleccionado"}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-950 p-0.5 text-xs shrink-0">
                      <button
                        type="button"
                        onClick={() => setMarkdownViewType("rendered")}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${markdownViewType === "rendered"
                          ? "bg-indigo-600 text-white"
                          : "text-slate-400 hover:text-white"
                          }`}
                      >
                        Render
                      </button>
                      <button
                        type="button"
                        onClick={() => setMarkdownViewType("raw")}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${markdownViewType === "raw"
                          ? "bg-indigo-600 text-white"
                          : "text-slate-400 hover:text-white"
                          }`}
                      >
                        Raw MD
                      </button>
                    </div>
                  </div>

                  {/* Selector para saltar de inmediato a cualquier asignatura en el markdown */}
                  {activeEntries.length > 0 && (
                    <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                      <span className="text-[11px] text-slate-400 whitespace-nowrap flex items-center gap-1">
                        <Hash className="h-3 w-3 text-indigo-400" />
                        Ir a Materia:
                      </span>
                      <select
                        value={highlightedSegmentIndex ?? ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val) scrollToSegment(parseInt(val, 10));
                        }}
                        className="flex-1 rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer truncate"
                      >
                        <option value="">Seleccionar segmento ({activeEntries.length} materias)...</option>
                        {activeEntries.map((e) => (
                          <option key={e.segmentIndex} value={e.segmentIndex}>
                            #{e.segmentIndex} {e.nombre} ({e.clave || "s/c"})
                          </option>
                        ))}
                      </select>
                      {highlightedSegmentIndex !== null && (
                        <button
                          type="button"
                          onClick={() => setHighlightedSegmentIndex(null)}
                          className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                          title="Quitar resaltado activo"
                        >
                          Limpiar
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Caja de visualización del Markdown */}
                <div
                  ref={markdownContainerRef}
                  className="rounded-2xl border border-white/10 bg-slate-950/80 p-5 backdrop-blur-md h-[680px] overflow-y-auto scrollbar-thin"
                >
                  {activeDoc?.markdown ? (
                    structuredMarkdown && structuredMarkdown.segments.length > 0 ? (
                      <div className="space-y-4">
                        {/* Preámbulo o encabezado inicial del documento */}
                        {structuredMarkdown.preamble && (
                          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4 mb-4">
                            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-400 mb-2 pb-1.5 border-b border-white/5">
                              <div className="flex items-center gap-1.5">
                                <FileText className="h-3.5 w-3.5 text-slate-500" />
                                <span>Encabezado / Portada del Documento</span>
                              </div>
                              <button
                                type="button"
                                onClick={(e) =>
                                  handleCopyMarkdownBlock(structuredMarkdown.preamble, "preamble", e)
                                }
                                className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium transition cursor-pointer ${copiedBlockId === "preamble"
                                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                  : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
                                  }`}
                                title="Copiar bloque de encabezado y portada"
                              >
                                {copiedBlockId === "preamble" ? (
                                  <>
                                    <Check className="h-3 w-3 text-emerald-400" />
                                    <span>¡Copiado!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3 w-3 text-slate-400" />
                                    <span>Copiar MD</span>
                                  </>
                                )}
                              </button>
                            </div>
                            {markdownViewType === "rendered" ? (
                              <div className="prose prose-invert prose-indigo max-w-none text-xs leading-relaxed text-slate-300">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {structuredMarkdown.preamble}
                                </ReactMarkdown>
                              </div>
                            ) : (
                              <pre className="font-mono text-xs text-slate-400 whitespace-pre-wrap leading-relaxed select-text">
                                {structuredMarkdown.preamble}
                              </pre>
                            )}
                          </div>
                        )}

                        {/* Segmentos de Asignaturas con Resaltado Completo */}
                        {structuredMarkdown.segments.map((seg) => {
                          const isHighlighted = highlightedSegmentIndex === seg.segmentIndex;
                          const entry = activeEntries.find((e) => e.segmentIndex === seg.segmentIndex);
                          const segOutliers = outlierReports.get(seg.segmentIndex);

                          return (
                            <div
                              key={seg.segmentIndex}
                              data-segment={seg.segmentIndex}
                              id={`md-segment-${seg.segmentIndex}`}
                              onClick={() => setHighlightedSegmentIndex(seg.segmentIndex)}
                              className={`group rounded-2xl transition-all duration-300 scroll-mt-4 cursor-pointer ${isHighlighted
                                ? "border-2 border-indigo-500 bg-indigo-950/35 ring-4 ring-indigo-500/25 shadow-2xl shadow-indigo-500/20"
                                : "border border-white/10 bg-slate-900/40 hover:border-white/20 hover:bg-slate-900/70"
                                }`}
                            >
                              {/* Barra de Título del Segmento */}
                              <div
                                className={`flex items-center justify-between px-4 py-2.5 rounded-t-2xl border-b transition-colors ${isHighlighted
                                  ? "bg-indigo-600/30 border-indigo-500/40 text-white"
                                  : "bg-white/[0.02] border-white/5 text-slate-300 group-hover:bg-white/[0.04]"
                                  }`}
                              >
                                <div className="flex items-center gap-2 min-w-0 pr-2">
                                  <span
                                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-mono font-bold transition ${isHighlighted
                                      ? "bg-indigo-500 text-white shadow-sm shadow-indigo-500/50"
                                      : "bg-white/10 text-slate-300"
                                      }`}
                                  >
                                    #{seg.segmentIndex}
                                  </span>
                                  <h5 className="text-xs font-bold truncate text-white">
                                    {entry?.nombre || `Asignatura #${seg.segmentIndex}`}
                                  </h5>
                                  {entry?.clave && (
                                    <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-mono font-bold text-indigo-300 border border-indigo-500/30 shrink-0">
                                      {entry.clave}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  {segOutliers?.hasOutliers && (
                                    <span
                                      className="flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300 border border-amber-500/40"
                                      title={`Campos con longitud atípica:\n• ${segOutliers.summaryList.join("\n• ")}`}
                                    >
                                      <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
                                      Atípico ({segOutliers.outlierCount})
                                    </span>
                                  )}
                                  {isHighlighted && (
                                    <span className="flex items-center gap-1.5 text-[10px] font-semibold text-indigo-200 bg-indigo-500/30 px-2 py-0.5 rounded-full border border-indigo-400/40 animate-pulse">
                                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-300" />
                                      Segmento Resaltado
                                    </span>
                                  )}
                                  {entry?.status === "uploaded" && (
                                    <span className="flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-500/30">
                                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                                      Subida
                                    </span>
                                  )}
                                  {entry?.status === "skipped_duplicate" && (
                                    <span className="flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 border border-amber-500/30">
                                      <ShieldAlert className="h-3 w-3 text-amber-400" />
                                      Duplicada
                                    </span>
                                  )}

                                  {/* Botón Copiar Bloque de Markdown */}
                                  <button
                                    type="button"
                                    onClick={(e) =>
                                      handleCopyMarkdownBlock(seg.content, seg.segmentIndex, e)
                                    }
                                    className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition cursor-pointer ${copiedBlockId === seg.segmentIndex
                                      ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/50 shadow-sm shadow-emerald-500/20"
                                      : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
                                      }`}
                                    title="Copiar el texto Markdown de este bloque"
                                  >
                                    {copiedBlockId === seg.segmentIndex ? (
                                      <>
                                        <Check className="h-3 w-3 text-emerald-400" />
                                        <span>¡Copiado!</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="h-3 w-3 text-slate-400 group-hover:text-white" />
                                        <span>Copiar MD</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                              </div>

                              {/* Contenido Completo del Segmento */}
                              <div className="p-4 sm:p-5">
                                {markdownViewType === "rendered" ? (
                                  <div className="prose prose-invert prose-indigo max-w-none text-xs leading-relaxed text-slate-200">
                                    <ReactMarkdown
                                      remarkPlugins={[remarkGfm]}
                                      components={{
                                        h1: ({ ...props }) => (
                                          <h1 className="text-lg font-bold text-white mt-3 mb-2 border-b border-white/10 pb-1" {...props} />
                                        ),
                                        h2: ({ ...props }) => (
                                          <h2 className="text-base font-semibold text-indigo-200 mt-3 mb-2" {...props} />
                                        ),
                                        h3: ({ ...props }) => (
                                          <h3 className="text-sm font-semibold text-indigo-300 mt-2.5 mb-1.5" {...props} />
                                        ),
                                        h4: ({ ...props }) => (
                                          <h4 className="text-xs font-semibold text-indigo-400 mt-2 mb-1" {...props} />
                                        ),
                                        table: ({ ...props }) => (
                                          <div className="overflow-x-auto my-3 rounded-xl border border-white/10 bg-black/40">
                                            <table className="w-full text-xs text-left text-slate-300 border-collapse" {...props} />
                                          </div>
                                        ),
                                        th: ({ ...props }) => (
                                          <th className="px-3 py-2 border-b border-white/10 bg-white/5 text-white font-semibold text-[11px]" {...props} />
                                        ),
                                        td: ({ ...props }) => (
                                          <td className="px-3 py-1.5 border-b border-white/5 font-mono text-[11px] text-slate-300" {...props} />
                                        ),
                                      }}
                                    >
                                      {seg.content}
                                    </ReactMarkdown>
                                  </div>
                                ) : (
                                  <pre className="font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed select-text">
                                    {seg.rawText}
                                  </pre>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      /* Fallback si no hay delimitadores coincidentes */
                      markdownViewType === "rendered" ? (
                        <div className="prose prose-invert prose-indigo max-w-none text-xs leading-relaxed">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {activeDoc.markdown}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <pre className="font-mono text-xs text-slate-300 whitespace-pre-wrap">
                          {activeDoc.markdown}
                        </pre>
                      )
                    )
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3 p-6 text-center">
                      <FileText className="h-10 w-10 text-slate-600" />
                      <div>
                        <h4 className="text-sm font-semibold text-white">
                          Este documento no tiene Markdown generado
                        </h4>
                        <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                          Puedes extraer su contenido a Markdown de forma instantánea usando unpdf
                          sin salir de esta pantalla.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => activeDoc && handleExtractWithUnpdf(activeDoc.name)}
                        disabled={extractingSingle || !activeDoc}
                        className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-500 hover:to-teal-500 transition disabled:opacity-40 cursor-pointer"
                      >
                        {extractingSingle ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Extrayendo con unpdf...
                          </>
                        ) : (
                          <>
                            <Zap className="h-4 w-4" />
                            Extraer a Markdown con unpdf
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Panel de Asignaturas Extraídas */}
            {(viewMode === "split" || viewMode === "entries") && (
              <div
                className={`${viewMode === "entries" ? "lg:col-span-12" : "lg:col-span-7"
                  } space-y-4`}
              >
                {/* Barra de Control de Asignaturas & Acciones en Lote */}
                <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 backdrop-blur-md space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-emerald-400" />
                        Entradas de Asignaturas ({activeEntries.length})
                      </h3>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                        <span>
                          Listas para subir:{" "}
                          <strong className="text-emerald-400 font-mono">{stats.readyToUpload}</strong>
                        </span>
                        <span>•</span>
                        <span>
                          Existentes en Supabase:{" "}
                          <strong className="text-amber-400 font-mono">{stats.skippedDuplicate}</strong>
                        </span>
                        <span>•</span>
                        <span>
                          Subidas:{" "}
                          <strong className="text-cyan-400 font-mono">{stats.uploaded}</strong>
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => verifyClavesAgainstDb()}
                        disabled={checkingDb || activeEntries.length === 0}
                        className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white transition disabled:opacity-40 cursor-pointer"
                        title="Consulta en tiempo real cuáles claves ya existen en Supabase"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${checkingDb ? "animate-spin" : ""}`} />
                        Verificar Claves en BD
                      </button>

                      <button
                        type="button"
                        onClick={handleUploadAllNew}
                        disabled={uploadingAll || stats.readyToUpload === 0}
                        className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-500 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {uploadingAll ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Subiendo ({uploadProgress?.current || 0}/{uploadProgress?.total || stats.readyToUpload})...
                          </>
                        ) : (
                          <>
                            <Upload className="h-3.5 w-3.5" />
                            Subir Nuevas a Supabase ({stats.readyToUpload})
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {stats.skippedDuplicate > 0 && (
                    <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
                      <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
                      <span>
                        Hay <strong>{stats.skippedDuplicate}</strong> asignatura(s) con clave existente en Supabase.
                        El sistema las omitirá automáticamente para proteger la integridad de los datos.
                      </span>
                    </div>
                  )}

                  {/* Barra de Filtros de Visualización: Todas / No en Supabase / Valores Atípicos */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/5">
                    <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-950/80 border border-white/10 text-xs">
                      <button
                        type="button"
                        onClick={() => setEntriesFilter("all")}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${entriesFilter === "all"
                          ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/30"
                          : "text-slate-400 hover:text-white"
                          }`}
                      >
                        Todas ({activeEntries.length})
                      </button>

                      <button
                        type="button"
                        onClick={() => setEntriesFilter("not_in_db")}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${entriesFilter === "not_in_db"
                          ? "bg-emerald-600 text-white shadow-sm shadow-emerald-500/30"
                          : "text-slate-400 hover:text-emerald-300"
                          }`}
                        title="Ver únicamente las asignaturas que aún NO están en la tabla de Supabase"
                      >
                        <Upload className="h-3.5 w-3.5 text-emerald-300" />
                        No en Supabase ({notInDbCount})
                      </button>

                      {stats.withOutliers > 0 && (
                        <button
                          type="button"
                          onClick={() => setEntriesFilter("outliers")}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${entriesFilter === "outliers"
                            ? "bg-amber-600 text-white shadow-sm shadow-amber-500/30"
                            : "text-amber-400 hover:text-amber-300"
                            }`}
                          title="Ver únicamente asignaturas con valores atípicos en número de caracteres"
                        >
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />
                          Con valores atípicos ({stats.withOutliers})
                        </button>
                      )}
                    </div>

                    {entriesFilter !== "all" && (
                      <button
                        type="button"
                        onClick={() => setEntriesFilter("all")}
                        className="text-xs text-indigo-400 hover:text-indigo-300 transition underline cursor-pointer"
                      >
                        Mostrar todas ({activeEntries.length})
                      </button>
                    )}
                  </div>
                </div>

                {/* Listado de Asignaturas Extraídas */}
                <div className="space-y-4 max-h-[680px] overflow-y-auto pr-1 scrollbar-thin">
                  {activeEntries.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-8 text-center space-y-3">
                      <AlertTriangle className="mx-auto h-8 w-8 text-amber-400" />
                      <h4 className="text-sm font-semibold text-white">
                        No se detectaron asignaturas con el delimitador actual
                      </h4>
                      <p className="text-xs text-slate-400 max-w-md mx-auto">
                        Intenta ajustar el delimitador de segmentos en el panel de configuración
                        o asegúrate de que el documento tenga Markdown extraído.
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowConfigPanel(true)}
                        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500 transition cursor-pointer"
                      >
                        <Sliders className="h-4 w-4" />
                        Abrir Configuración de Delimitador
                      </button>
                    </div>
                  ) : displayedEntries.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-8 text-center space-y-3">
                      <Sparkles className="mx-auto h-8 w-8 text-indigo-400" />
                      <h4 className="text-sm font-semibold text-white">
                        {entriesFilter === "not_in_db"
                          ? "Todas las asignaturas de este documento ya están en Supabase"
                          : "No se encontraron asignaturas con valores atípicos"}
                      </h4>
                      <p className="text-xs text-slate-400 max-w-md mx-auto">
                        {entriesFilter === "not_in_db"
                          ? "No hay asignaturas pendientes de subir para este documento."
                          : "Todas las asignaturas extraídas tienen longitudes normales de texto."}
                      </p>
                      <button
                        type="button"
                        onClick={() => setEntriesFilter("all")}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-4 py-2 text-xs font-medium text-white hover:bg-white/15 transition cursor-pointer"
                      >
                        Ver todas las asignaturas ({activeEntries.length})
                      </button>
                    </div>
                  ) : (
                    displayedEntries.map((item) => {
                      const isDuplicate = item.status === "skipped_duplicate";
                      const isUploaded = item.status === "uploaded";
                      const isUploading = item.status === "uploading";
                      const isHighlighted = highlightedSegmentIndex === item.segmentIndex;
                      const outlierReport = outlierReports.get(item.segmentIndex);

                      return (
                        <div
                          key={item.segmentIndex}
                          id={`entry-card-${item.segmentIndex}`}
                          className={`rounded-2xl border transition-all duration-300 p-5 space-y-4 ${isHighlighted
                            ? "ring-2 ring-indigo-500 border-indigo-500/80 bg-indigo-950/25 shadow-lg shadow-indigo-500/10"
                            : isUploaded
                              ? "border-emerald-500/40 bg-emerald-950/10"
                              : isDuplicate
                                ? "border-amber-500/30 bg-slate-900/70"
                                : "border-white/10 bg-slate-900/80 hover:border-white/20"
                            }`}
                        >
                          {/* Cabecera de la Tarjeta */}
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-mono font-bold transition ${isHighlighted
                                  ? "bg-indigo-500 text-white shadow-sm shadow-indigo-500/40"
                                  : "bg-white/10 text-slate-300"
                                  }`}>
                                  #{item.segmentIndex}
                                </span>

                                {item.clave ? (
                                  <span
                                    className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-mono font-bold border ${outlierReport?.fields.clave
                                      ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                                      : "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                                      }`}
                                    title={outlierReport?.fields.clave?.message}
                                  >
                                    {outlierReport?.fields.clave && (
                                      <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
                                    )}
                                    Clave: {item.clave}
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 rounded-md bg-red-500/20 px-2 py-0.5 text-xs font-mono text-red-300 border border-red-500/30">
                                    <AlertTriangle className="h-3 w-3 text-red-400 shrink-0" />
                                    Sin clave
                                  </span>
                                )}

                                {isUploaded && (
                                  <span className="flex items-center gap-1 rounded-md bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300 border border-emerald-500/30">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                                    Subida a Supabase (ID #{item.uploadedId})
                                  </span>
                                )}
                                {isDuplicate && (
                                  <span className="flex items-center gap-1 rounded-md bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-300 border border-amber-500/30">
                                    <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
                                    Ya existe en BD (Clave duplicada)
                                  </span>
                                )}
                                {item.status === "pending" && (
                                  <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-300 border border-white/10">
                                    Lista para subir
                                  </span>
                                )}
                                {item.status === "error" && (
                                  <span className="rounded-md bg-red-500/20 px-2 py-0.5 text-xs text-red-300 border border-red-500/30">
                                    Error al subir
                                  </span>
                                )}

                                {/* Señal de advertencia para valores atípicos */}
                                {outlierReport?.hasOutliers && (
                                  <span
                                    className="flex items-center gap-1 rounded-md bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-300 border border-amber-500/40 shadow-sm"
                                    title={`Campos con longitud atípica:\n• ${outlierReport.summaryList.join("\n• ")}`}
                                  >
                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                                    Longitud atípica ({outlierReport.outlierCount} campo{outlierReport.outlierCount > 1 ? "s" : ""})
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2 pt-1 flex-wrap">
                                <h4 className="text-sm font-bold text-white">
                                  {item.nombre || "(Sin nombre extraído)"}
                                </h4>
                                {outlierReport?.fields.nombre && (
                                  <span
                                    className="flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300 border border-amber-500/40"
                                    title={outlierReport.fields.nombre.message}
                                  >
                                    <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
                                    <span>{outlierReport.fields.nombre.message}</span>
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Botones de Acción Individual */}
                            <div className="flex items-center gap-2">
                              {/* Botón Ver en Markdown */}
                              <button
                                type="button"
                                onClick={() => scrollToSegment(item.segmentIndex)}
                                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition cursor-pointer ${isHighlighted
                                  ? "border-indigo-400 bg-indigo-600/30 text-indigo-200 shadow-sm shadow-indigo-500/30 ring-1 ring-indigo-400/50"
                                  : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
                                  }`}
                                title="Localizar y resaltar este segmento en el visor de Markdown"
                              >
                                <Eye className={`h-3.5 w-3.5 ${isHighlighted ? "text-indigo-300 animate-pulse" : "text-indigo-400"}`} />
                                <span className="hidden sm:inline">Ver en MD</span>
                              </button>

                              {/* Botón Copiar Markdown del Bloque */}
                              <button
                                type="button"
                                onClick={() => {
                                  const seg = structuredMarkdown?.segments.find(
                                    (s) => s.segmentIndex === item.segmentIndex
                                  );
                                  const textToCopy = seg?.content || item.rawSegment;
                                  handleCopyMarkdownBlock(textToCopy, `card-${item.segmentIndex}`);
                                }}
                                className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition cursor-pointer ${copiedBlockId === `card-${item.segmentIndex}`
                                  ? "border-emerald-500/50 bg-emerald-600/20 text-emerald-300 shadow-sm shadow-emerald-500/20"
                                  : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
                                  }`}
                                title="Copiar bloque de Markdown de esta asignatura"
                              >
                                {copiedBlockId === `card-${item.segmentIndex}` ? (
                                  <>
                                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                                    <span className="hidden sm:inline">¡Copiado!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3.5 w-3.5 text-slate-400" />
                                    <span className="hidden sm:inline">Copiar MD</span>
                                  </>
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  setEditingItem({
                                    docName: activeDocName,
                                    item: { ...item },
                                  })
                                }
                                className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition cursor-pointer"
                                title="Editar campos manualmente antes de subir"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                                Editar
                              </button>

                              <button
                                type="button"
                                onClick={() => handleUploadSingle(item)}
                                disabled={isUploaded || isDuplicate || isUploading}
                                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${isUploaded
                                  ? "bg-emerald-950/40 text-emerald-400 border border-emerald-500/30 cursor-default"
                                  : isDuplicate
                                    ? "bg-amber-950/30 text-amber-400/60 border border-amber-500/20 cursor-not-allowed"
                                    : "bg-emerald-600 text-white hover:bg-emerald-500 shadow-md shadow-emerald-500/20"
                                  }`}
                              >
                                {isUploading ? (
                                  <>
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Subiendo...
                                  </>
                                ) : isUploaded ? (
                                  <>
                                    <Check className="h-3.5 w-3.5" />
                                    Subida
                                  </>
                                ) : isDuplicate ? (
                                  <>
                                    <ShieldAlert className="h-3.5 w-3.5" />
                                    Bloqueado
                                  </>
                                ) : (
                                  <>
                                    <Upload className="h-3.5 w-3.5" />
                                    Subir a BD
                                  </>
                                )}
                              </button>
                            </div>
                          </div>

                          {/* Campos de Contenido Extraídos con Detección de Valores Atípicos */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                            <div
                              className={`rounded-xl border p-3 space-y-1.5 transition ${outlierReport?.fields.fines_de_aprendizaje_o_formacion
                                ? "border-amber-500/40 bg-amber-950/20 ring-1 ring-amber-500/20"
                                : "border-white/5 bg-slate-950/60"
                                }`}
                            >
                              <div className="flex items-center justify-between gap-1 flex-wrap">
                                <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
                                  Fines de Aprendizaje ({item.fines_de_aprendizaje_o_formacion?.length || 0} car.)
                                </span>
                                {outlierReport?.fields.fines_de_aprendizaje_o_formacion && (
                                  <span
                                    className="flex items-center gap-1 text-[10px] font-bold text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-500/30"
                                    title={outlierReport.fields.fines_de_aprendizaje_o_formacion.message}
                                  >
                                    <AlertTriangle className="h-3 w-3 text-amber-400" />
                                    Atípico
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-300 line-clamp-3 leading-relaxed">
                                {item.fines_de_aprendizaje_o_formacion || (
                                  <em className="text-slate-600">No detectado</em>
                                )}
                              </p>
                              {outlierReport?.fields.fines_de_aprendizaje_o_formacion && (
                                <p className="text-[10px] text-amber-300 font-medium pt-1 border-t border-amber-500/20 flex items-center gap-1">
                                  <AlertTriangle className="h-2.5 w-2.5 text-amber-400 shrink-0" />
                                  <span>{outlierReport.fields.fines_de_aprendizaje_o_formacion.message}</span>
                                </p>
                              )}
                            </div>

                            <div
                              className={`rounded-xl border p-3 space-y-1.5 transition ${outlierReport?.fields.contenido_tematico
                                ? "border-amber-500/40 bg-amber-950/20 ring-1 ring-amber-500/20"
                                : "border-white/5 bg-slate-950/60"
                                }`}
                            >
                              <div className="flex items-center justify-between gap-1 flex-wrap">
                                <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
                                  Contenido Temático ({item.contenido_tematico?.length || 0} car.)
                                </span>
                                {outlierReport?.fields.contenido_tematico && (
                                  <span
                                    className="flex items-center gap-1 text-[10px] font-bold text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-500/30"
                                    title={outlierReport.fields.contenido_tematico.message}
                                  >
                                    <AlertTriangle className="h-3 w-3 text-amber-400" />
                                    Atípico
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-300 line-clamp-3 leading-relaxed">
                                {item.contenido_tematico || (
                                  <em className="text-slate-600">No detectado</em>
                                )}
                              </p>
                              {outlierReport?.fields.contenido_tematico && (
                                <p className="text-[10px] text-amber-300 font-medium pt-1 border-t border-amber-500/20 flex items-center gap-1">
                                  <AlertTriangle className="h-2.5 w-2.5 text-amber-400 shrink-0" />
                                  <span>{outlierReport.fields.contenido_tematico.message}</span>
                                </p>
                              )}
                            </div>

                            <div
                              className={`rounded-xl border p-3 space-y-1.5 transition ${outlierReport?.fields.actividades_de_aprendizaje
                                ? "border-amber-500/40 bg-amber-950/20 ring-1 ring-amber-500/20"
                                : "border-white/5 bg-slate-950/60"
                                }`}
                            >
                              <div className="flex items-center justify-between gap-1 flex-wrap">
                                <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
                                  Actividades de Aprendizaje ({item.actividades_de_aprendizaje?.length || 0} car.)
                                </span>
                                {outlierReport?.fields.actividades_de_aprendizaje && (
                                  <span
                                    className="flex items-center gap-1 text-[10px] font-bold text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-500/30"
                                    title={outlierReport.fields.actividades_de_aprendizaje.message}
                                  >
                                    <AlertTriangle className="h-3 w-3 text-amber-400" />
                                    Atípico
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-300 line-clamp-3 leading-relaxed">
                                {item.actividades_de_aprendizaje || (
                                  <em className="text-slate-600">No detectado</em>
                                )}
                              </p>
                              {outlierReport?.fields.actividades_de_aprendizaje && (
                                <p className="text-[10px] text-amber-300 font-medium pt-1 border-t border-amber-500/20 flex items-center gap-1">
                                  <AlertTriangle className="h-2.5 w-2.5 text-amber-400 shrink-0" />
                                  <span>{outlierReport.fields.actividades_de_aprendizaje.message}</span>
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Modal de Edición de Asignatura ── */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Edit3 className="h-4 w-4 text-indigo-400" />
                  Editar Asignatura #{editingItem.item.segmentIndex}
                </h3>
                <p className="text-xs text-slate-400">
                  Modifica los campos extraídos antes de sincronizar con Supabase.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {(() => {
              const editOutlier = editingItem ? outlierReports.get(editingItem.item.segmentIndex) : null;
              const nombreOutlier = editOutlier?.fields.nombre;
              const claveOutlier = editOutlier?.fields.clave;
              const finesOutlier = editOutlier?.fields.fines_de_aprendizaje_o_formacion;
              const contenidoOutlier = editOutlier?.fields.contenido_tematico;
              const actividadesOutlier = editOutlier?.fields.actividades_de_aprendizaje;

              return (
                <div className="space-y-4">
                  {editOutlier && editOutlier.hasOutliers && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-200">
                      <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold text-amber-300">
                          Esta asignatura tiene campos con longitudes atípicas de texto:
                        </div>
                        <div className="text-[11px] text-amber-300/80 mt-0.5">
                          {editOutlier.summaryList.join(" • ")}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-slate-300">
                          Nombre de la Asignatura
                        </label>
                        <div className="flex items-center gap-1.5 text-[11px]">
                          {nombreOutlier && (
                            <span className="inline-flex items-center gap-1 text-amber-400 font-medium" title={nombreOutlier.message}>
                              <AlertTriangle className="h-3 w-3" />
                              {nombreOutlier.message}
                            </span>
                          )}
                          <span className="text-slate-400 font-mono">
                            {editingItem.item.nombre.length} car.
                          </span>
                        </div>
                      </div>
                      <input
                        type="text"
                        value={editingItem.item.nombre}
                        onChange={(e) =>
                          setEditingItem({
                            ...editingItem,
                            item: { ...editingItem.item, nombre: e.target.value },
                          })
                        }
                        className={`w-full rounded-xl border bg-slate-950 px-3.5 py-2 text-xs text-white focus:outline-none transition ${nombreOutlier
                          ? "border-amber-500/50 focus:border-amber-400 bg-amber-950/10"
                          : "border-white/10 focus:border-indigo-500"
                          }`}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-slate-300">
                          Clave (Única en BD)
                        </label>
                        <div className="flex items-center gap-1.5 text-[11px]">
                          {claveOutlier && (
                            <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
                              <AlertTriangle className="h-3 w-3" />
                              {claveOutlier.reason}
                            </span>
                          )}
                          <span className="text-slate-400 font-mono">
                            {editingItem.item.clave.length} car.
                          </span>
                        </div>
                      </div>
                      <input
                        type="text"
                        value={editingItem.item.clave}
                        onChange={(e) =>
                          setEditingItem({
                            ...editingItem,
                            item: { ...editingItem.item, clave: e.target.value },
                          })
                        }
                        className={`w-full rounded-xl border bg-slate-950 px-3.5 py-2 text-xs font-mono text-white focus:outline-none transition ${claveOutlier
                          ? "border-amber-500/50 focus:border-amber-400 bg-amber-950/10"
                          : "border-white/10 focus:border-indigo-500"
                          }`}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-300">
                        Fines de Aprendizaje o Formación
                      </label>
                      <div className="flex items-center gap-1.5 text-[11px]">
                        {finesOutlier && (
                          <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
                            <AlertTriangle className="h-3 w-3" />
                            {finesOutlier.reason}
                          </span>
                        )}
                        <span className="text-slate-400 font-mono">
                          {editingItem.item.fines_de_aprendizaje_o_formacion.length} car.
                        </span>
                      </div>
                    </div>
                    <textarea
                      rows={4}
                      value={editingItem.item.fines_de_aprendizaje_o_formacion}
                      onChange={(e) =>
                        setEditingItem({
                          ...editingItem,
                          item: {
                            ...editingItem.item,
                            fines_de_aprendizaje_o_formacion: e.target.value,
                          },
                        })
                      }
                      className={`w-full rounded-xl border bg-slate-950 p-3 text-xs text-slate-200 focus:outline-none leading-relaxed transition ${finesOutlier
                        ? "border-amber-500/50 focus:border-amber-400 bg-amber-950/10"
                        : "border-white/10 focus:border-indigo-500"
                        }`}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-300">
                        Contenido Temático
                      </label>
                      <div className="flex items-center gap-1.5 text-[11px]">
                        {contenidoOutlier && (
                          <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
                            <AlertTriangle className="h-3 w-3" />
                            {contenidoOutlier.reason}
                          </span>
                        )}
                        <span className="text-slate-400 font-mono">
                          {editingItem.item.contenido_tematico.length} car.
                        </span>
                      </div>
                    </div>
                    <textarea
                      rows={6}
                      value={editingItem.item.contenido_tematico}
                      onChange={(e) =>
                        setEditingItem({
                          ...editingItem,
                          item: {
                            ...editingItem.item,
                            contenido_tematico: e.target.value,
                          },
                        })
                      }
                      className={`w-full rounded-xl border bg-slate-950 p-3 text-xs text-slate-200 focus:outline-none leading-relaxed font-mono transition ${contenidoOutlier
                        ? "border-amber-500/50 focus:border-amber-400 bg-amber-950/10"
                        : "border-white/10 focus:border-indigo-500"
                        }`}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-300">
                        Actividades de Aprendizaje
                      </label>
                      <div className="flex items-center gap-1.5 text-[11px]">
                        {actividadesOutlier && (
                          <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
                            <AlertTriangle className="h-3 w-3" />
                            {actividadesOutlier.reason}
                          </span>
                        )}
                        <span className="text-slate-400 font-mono">
                          {editingItem.item.actividades_de_aprendizaje.length} car.
                        </span>
                      </div>
                    </div>
                    <textarea
                      rows={5}
                      value={editingItem.item.actividades_de_aprendizaje}
                      onChange={(e) =>
                        setEditingItem({
                          ...editingItem,
                          item: {
                            ...editingItem.item,
                            actividades_de_aprendizaje: e.target.value,
                          },
                        })
                      }
                      className={`w-full rounded-xl border bg-slate-950 p-3 text-xs text-slate-200 focus:outline-none leading-relaxed font-mono transition ${actividadesOutlier
                        ? "border-amber-500/50 focus:border-amber-400 bg-amber-950/10"
                        : "border-white/10 focus:border-indigo-500"
                        }`}
                    />
                  </div>
                </div>
              );
            })()}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-white/10 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const updated = editingItem.item;
                  setExtractionsMap((prev) => ({
                    ...prev,
                    [editingItem.docName]: prev[editingItem.docName].map((x) =>
                      x.segmentIndex === updated.segmentIndex ? updated : x
                    ),
                  }));
                  setEditingItem(null);
                  setNotification({
                    type: "info",
                    title: "Cambios guardados localmente",
                    message: `Se actualizaron los campos para la asignatura #${updated.segmentIndex}.`,
                  });
                }}
                className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition cursor-pointer"
              >
                <Save className="h-4 w-4" />
                Guardar Cambios
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Drawer de Inspección de Supabase en Vivo ── */}
      {showDbDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-2xl bg-slate-900 border-l border-white/10 h-full p-6 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Registros en Supabase (<code className="text-emerald-400 font-mono">asignaturas_extraidas</code>)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Total registrado: <strong>{dbTotalCount}</strong> asignaturas
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDbDrawer(false)}
                className="text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="py-4">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Buscar por clave o nombre..."
                  value={dbSearchQuery}
                  onChange={(e) => setDbSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950 pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
              {loadingDbRecords ? (
                <div className="flex items-center justify-center h-48 text-slate-400 gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
                  <span className="text-xs">Consultando Supabase...</span>
                </div>
              ) : dbRecords.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-xs">
                  No se encontraron registros en la tabla.
                </div>
              ) : (
                dbRecords.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-xl border border-white/10 bg-slate-950 p-4 space-y-2 hover:border-emerald-500/30 transition"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-bold text-emerald-300 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                        {row.clave || "SIN_CLAVE"}
                      </span>
                      <span className="text-[11px] text-slate-500 font-mono">
                        ID #{row.id}
                      </span>
                    </div>
                    <h5 className="text-xs font-semibold text-white">{row.nombre}</h5>
                    {row.fines_de_aprendizaje_o_formacion && (
                      <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                        {row.fines_de_aprendizaje_o_formacion}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="pt-4 border-t border-white/10 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Mostrando {dbRecords.length} de {dbTotalCount} registros
              </span>
              <button
                type="button"
                onClick={fetchDbRecords}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition cursor-pointer"
              >
                <RefreshCw className={`h-3 w-3 ${loadingDbRecords ? "animate-spin" : ""}`} />
                Actualizar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
