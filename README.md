# 🛠️ Pradem — Template de Herramienta Satélite

Template base para crear nuevas herramientas integradas al ecosistema Pradem.

## Arquitectura

```
                    Pradem Core (Railway)
                    ┌─────────────────────────────┐
                    │  Middleware (proxy dinámico)  │
  Usuario ────────▶│  Lee pradem_tools de Supabase │
  pradem.com/slug   │  Rewrite → URL de la tool    │
                    └──────────┬──────────────────┘
                               │
                    ┌──────────▼──────────────────┐
                    │  Tu Herramienta (Railway)     │
                    │  basePath: /slug              │
                    │  Autoconfigurada de Supabase │
                    └───────────────────────────────┘
```

**Principios:**
- **Supabase como Única Fuente de la Verdad:** Creas la herramienta en Pradem Core (nombre, emoji, descripción, color, puerto local, URL producción) y tu app satélite la ingiere automáticamente. ¡Cero duplicación!
- **Solo necesitas el SLUG:** En el código de la herramienta solo especificas `TOOL_SLUG`. Todo lo demás viene de la base de datos.
- Cada herramienta se despliega como un servicio independiente en Railway.
- El Core actúa como proxy inverso dinámico.
- Las herramientas comparten la misma instancia de Supabase y cookies de sesión.

---

## 🚀 Crear una Nueva Herramienta (Paso a Paso)

### Paso 1 — Registrar la Herramienta en Pradem Core (Fuente de la Verdad)

Antes de crear código, registra la herramienta en el portal de administración del Core:

1. Inicia sesión como administrador en Pradem Core (`http://localhost:3000` en local o tu dominio de producción).
2. Ve a **Dashboard → ⚙️ Gestionar Herramientas** (o directamente a `/dashboard/admin/tools`).
3. Haz clic en **"+ Nueva Herramienta"**.
4. Completa los datos:
   - **Nombre:** Ej. *Asignador de Salones*
   - **Slug:** Ej. `asignador-salones` (o `admin-asignador-salones` si es de admin)
   - **Descripción:** Breve resumen de lo que hace.
   - **Emoji:** Ej. 🏫
   - **Color:** Elige el color temático para el dashboard.
   - **Puerto Local:** Ej. `3014` (elige el siguiente puerto libre).
   - **URL de Producción:** *(dejar vacío hasta que despliegues en Railway)*.
5. Guarda. ¡La herramienta ya existe en la red Pradem!

---

### Paso 2 — Crear el proyecto desde WSL

```bash
# Desde tu directorio raíz de trabajo en WSL (donde están 02prademCore, etc.)
cp -r 04toolBlankTemplate/ 14asignadorSalones

# Entrar al nuevo directorio
cd 14asignadorSalones

# Inicializar un git limpio (opcional pero recomendado)
rm -rf .git
git init
```

> Sustituye `14` y `asignadorSalones` por el número y nombre descriptivo de tu herramienta.

---

### Paso 3 — Configurar el Slug (Único paso de configuración en código)

Edita **`src/pradem.config.ts`**:

```typescript
export const TOOL_SLUG = "asignador-salones";
```

¡Eso es todo! Tu herramienta ya sabe quién es. Al ejecutarse, obtendrá de Supabase su nombre, descripción, emoji, color y roles.

---

### Paso 4 — Configurar el puerto de desarrollo

Edita **`package.json`** en la sección `"scripts"` para usar el mismo puerto local que registraste en el Paso 1:

```json
"scripts": {
  "dev": "next dev -p 3014",
  ...
}
```

---

### Paso 5 — Variables de entorno e instalación

```bash
# Instalar dependencias
npm install

# Copiar variables de entorno
cp .env.local.example .env.local
```

Edita **`.env.local`** con las credenciales de Supabase del ecosistema Pradem:

```env
NEXT_PUBLIC_SUPABASE_URL=https://yonkcvfzbezflejwwdtg.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_G8v_l57i3Lt5is20BjDiDw_t0BN8ECb
```

*(Son exactamente las mismas que usa `02prademCore`)*.

---

### Paso 6 — Iniciar y Probar

Inicia tu herramienta:

```bash
npm run dev
```

Abre en tu navegador directo:
```
http://localhost:3014/asignador-salones
```

Verás el header con el nombre, emoji y datos leídos directamente desde Supabase. ✅

Y si `02prademCore` está corriendo en el puerto 3000, puedes entrar directamente vía proxy unificado:
```
http://localhost:3000/asignador-salones
```
El Core redirigirá el tráfico transparente y compartirá la sesión de usuario.

---

## 🔗 Conectar a Producción (Railway)

1. **Crear servicio en Railway:**
   - En Railway → proyecto Pradem → **"+ New Service"** → **"GitHub Repo"**.
   - Selecciona el repositorio de tu herramienta.
   - Railway detectará el `Dockerfile` incluido automáticamente.

2. **Configurar Variables de Entorno en Railway:**
   - En las variables del servicio en Railway, agrega:
     ```env
     NEXT_PUBLIC_SUPABASE_URL=https://yonkcvfzbezflejwwdtg.supabase.co
     NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_G8v_l57i3Lt5is20BjDiDw_t0BN8ECb
     ```

3. **Copiar la URL pública de Railway:**
   - En Railway → *Settings* → *Networking* → *Generate Domain* (o copia el dominio existente).
   - Ejemplo: `https://asignador-salones-production.up.railway.app`

4. **Actualizar en Pradem Core:**
   - Ve a Pradem Core en producción → **Dashboard → ⚙️ Gestionar Herramientas**.
   - Haz clic en **"Editar"** en tu herramienta.
   - Pega la URL en **"URL de Producción"** y guarda.
   - ¡Listo! En ~30 segundos (vencimiento de caché del middleware), la herramienta estará disponible en:
     ```
     https://pradem.com/asignador-salones
     ```

---

## 📂 Estructura del Proyecto

```
14asignadorSalones/
├── src/
│   ├── pradem.config.ts         ← Solo define TOOL_SLUG
│   ├── lib/
│   │   ├── tool-config.ts       ← Ingesta metadatos desde Supabase con caché
│   │   └── supabase/
│   │       ├── client.ts        ← Cliente Supabase (navegador)
│   │       └── server.ts        ← Cliente Supabase (Server Components)
│   ├── components/
│   │   ├── PrademLogo.tsx       ← Logo unificado
│   │   └── ExampleButton.tsx    ← Componente de cliente de ejemplo
│   └── app/
│       ├── globals.css          ← Estilos Tailwind v4
│       ├── layout.tsx           ← Layout raíz con generateMetadata dinámico
│       └── page.tsx             ← Página Server Component (lee de Supabase)
├── next.config.ts               ← Configura basePath dinámicamente con TOOL_SLUG
├── package.json                 ← Puerto en comando "dev"
├── Dockerfile                   ← Listo para Railway
└── README.md
```

---

## ✅ Checklist Rápido

```
[ ] 1. Registrar en Core: /dashboard/admin/tools → "+ Nueva Herramienta" (slug, puerto, etc.)
[ ] 2. Copiar template:   cp -r 04toolBlankTemplate/ XX_miHerramienta
[ ] 3. pradem.config.ts:  poner el TOOL_SLUG que registraste
[ ] 4. package.json:      actualizar el puerto en "dev"
[ ] 5. npm install && cp .env.local.example .env.local
[ ] 6. npm run dev        verificar en http://localhost:{PUERTO}/{SLUG}
[ ] 7. Probar con Core:   verificar en http://localhost:3000/{SLUG}
[ ] 8. Deploy Railway:    crear servicio con Dockerfile + variables Supabase
[ ] 9. Registrar URL:     pegar URL Railway en el gestor de herramientas del Core
```

---

## 🛡️ Herramientas de Administrador

Si la herramienta es de administrador:
1. El slug debe iniciar con `admin-` (ej. `admin-asignador-salones`).
2. El middleware de Pradem Core bloqueará automáticamente a cualquier usuario no-admin.
3. Para validar dentro de tus Server Components:
   ```typescript
   import { createClient } from "@/lib/supabase/server";
   import { redirect } from "next/navigation";

   export default async function AdminPage() {
     const supabase = await createClient();
     const { data: { user } } = await supabase.auth.getUser();

     if (!user || user.app_metadata?.role !== "admin") {
       redirect("/dashboard");
     }

     return <div>Panel Administrador</div>;
   }
   ```
