import PrademLogo from "@/components/PrademLogo";
import { getToolConfig } from "@/lib/tool-config";
import ExampleButton from "@/components/ExampleButton";

/**
 * Página principal de la herramienta satélite.
 * El header, nombre, emoji y descripción se leen automáticamente desde Supabase.
 *
 * Reemplaza el contenido de las secciones con la UI de tu herramienta.
 */
export default async function ToolPage() {
  const config = await getToolConfig();

  return (
    <main className="min-h-screen">
      {/* ── Header con branding Pradem ── */}
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-4">
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
            <h1 className="text-lg font-bold text-white">{config.name}</h1>
            <p className="text-xs text-slate-400">{config.description}</p>
          </div>
          <a
            href="/dashboard"
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-400 transition hover:bg-white/10 hover:text-white"
            title="Volver a Herramientas"
          >
            <span className="text-base">←</span>
            Herramientas
          </a>
        </div>
      </header>

      {/* ── Contenido principal ── */}
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        {/* ━━━ Sección de bienvenida ━━━ */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shadow-lg shadow-indigo-500/30">
              1
            </div>
            <h2 className="text-base font-semibold text-white">Comenzar</h2>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/20 text-3xl">
              {config.emoji}
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">
              ¡Herramienta lista!
            </h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Esta es la página principal de tu herramienta. Reemplaza este
              contenido con la UI de tu herramienta.
            </p>
          </div>
        </section>

        {/* ━━━ Sección con acción de ejemplo ━━━ */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shadow-lg shadow-indigo-500/30">
              2
            </div>
            <h2 className="text-base font-semibold text-white">
              Acción de ejemplo
            </h2>
          </div>

          <p className="mb-4 text-sm text-slate-400">
            Aquí puedes agregar controles, formularios, inputs, etc.
          </p>

          <ExampleButton />
        </section>
      </div>
    </main>
  );
}
