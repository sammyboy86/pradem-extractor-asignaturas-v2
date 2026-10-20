/**
 * Almacenamiento en el navegador usando IndexedDB.
 * Guarda los documentos del lote activo y sus Markdowns extraídos.
 * Cuando se carga un nuevo archivo o lote, los archivos previos de la base de datos local se eliminan.
 */

export interface ClientPdfDocument {
  name: string; // Clave primaria única (nombre exacto del archivo)
  sizeBytes: number;
  formattedSize: string;
  isAnexo3: boolean;
  blob?: Blob; // Archivo PDF original almacenado en el cliente
  markdown?: string; // Markdown extraído
  status: "idle" | "extracting" | "completed" | "error";
  pageCount?: number;
  runtimeSeconds?: number;
  extractedAt?: string;
  uploadedAt: string;
  error?: string;
}

const DB_NAME = "pradem_pdf_storage_v1";
const STORE_NAME = "documents";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      return reject(new Error("IndexedDB no está disponible en este entorno."));
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "name" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Guarda o actualiza un documento.
 * Si ya existe un documento con el mismo 'name', se reemplaza automáticamente.
 */
export async function saveClientDocument(doc: ClientPdfDocument): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(doc);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Guarda múltiples documentos en una sola transacción.
 * Si alguno tiene el mismo 'name', se reemplaza.
 */
export async function saveClientDocuments(docs: ClientPdfDocument[]): Promise<void> {
  if (docs.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);

    for (const doc of docs) {
      store.put(doc);
    }
  });
}

/**
 * Obtiene todos los documentos almacenados en el cliente.
 */
export async function getAllClientDocuments(): Promise<ClientPdfDocument[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Obtiene un documento por su nombre exacto.
 */
export async function getClientDocument(
  name: string
): Promise<ClientPdfDocument | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(name);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Actualiza el estado y markdown de un documento existente.
 */
export async function updateClientDocumentMarkdown(
  name: string,
  markdown: string,
  pageCount: number,
  runtimeSeconds: number
): Promise<void> {
  const existing = await getClientDocument(name);
  if (!existing) return;

  const updated: ClientPdfDocument = {
    ...existing,
    markdown,
    pageCount,
    runtimeSeconds,
    status: "completed",
    extractedAt: new Date().toISOString(),
    error: undefined,
  };

  await saveClientDocument(updated);
}

/**
 * Actualiza el estado (por ejemplo a 'extracting' o 'error') de un documento.
 */
export async function updateClientDocumentStatus(
  name: string,
  status: ClientPdfDocument["status"],
  error?: string
): Promise<void> {
  const existing = await getClientDocument(name);
  if (!existing) return;

  const updated: ClientPdfDocument = {
    ...existing,
    status,
    error: error || undefined,
  };

  await saveClientDocument(updated);
}

/**
 * Elimina un documento específico por nombre.
 */
export async function deleteClientDocument(name: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(name);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Limpia todos los documentos de la base de datos local.
 */
export async function clearAllClientDocuments(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
