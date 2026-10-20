import PrademLogo from "@/components/PrademLogo";
import { getToolConfig } from "@/lib/tool-config";
import ExtractorApp from "@/components/ExtractorApp";

/**
 * Página principal de la herramienta satélite.
 * El header, nombre, emoji y descripción se leen automáticamente desde Supabase.
 */
export default async function ToolPage() {
  const config = await getToolConfig();

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      {/* ── Header con branding Pradem ── */}
      <header className="border-b border-white/10 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3.5">
          <a
            href="/dashboard"
            className="relative flex-shrink-0 transition hover:opacity-80"
            title="Volver a Herramientas"
          >
            <PrademLogo className="h-9 w-9 text-[#C8A2C8]" />
            <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500/30 text-[10px] ring-2 ring-slate-900">
              {config.emoji}
            </span>
          </a>
          <div>
            <h1 className="text-base font-bold text-white flex items-center gap-2">
              {config.name}
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                v2.0 unpdf
              </span>
            </h1>
            <p className="text-xs text-slate-400">{config.description}</p>
          </div>
          <a
            href="/dashboard"
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-400 transition hover:bg-white/10 hover:text-white"
            title="Volver a Herramientas"
          >
            <span className="text-sm">←</span>
            Herramientas
          </a>
        </div>
      </header>

      {/* ── Contenido principal: Pipeline de Procesamiento (Pasos 1 a 4) ── */}
      <div className="mx-auto max-w-7xl px-6 py-8">
        <ExtractorApp />
      </div>
    </main>
  );
}
