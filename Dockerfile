FROM node:20-bookworm

# 1. Dependencias del sistema (descomentar según necesidad)
# RUN apt-get update && apt-get install -y python3 python3-pip

# 2. Directorio de trabajo
WORKDIR /app

# 3. Instalar dependencias de Node.js
COPY package.json package-lock.json* ./
RUN npm install

# 4. Copiar código fuente
COPY . .

# 5. Build de producción
RUN npm run build

# 6. Puerto (Railway inyecta PORT automáticamente)
EXPOSE 3000

# 7. Iniciar
CMD ["npm", "run", "start"]
