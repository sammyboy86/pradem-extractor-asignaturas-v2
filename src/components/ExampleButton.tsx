"use client";

export default function ExampleButton() {
  return (
    <button
      onClick={() => alert("¡Funciona!")}
      className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-500"
    >
      🚀 Ejecutar acción
    </button>
  );
}
