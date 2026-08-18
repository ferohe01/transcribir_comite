# Transcriptor de Audio AI - Versión Ejecutable Actualizada

## 🎯 Características Nuevas

### ✅ Tamaño de archivo aumentado
- **Antes**: Máximo 25MB
- **Ahora**: Máximo 50MB

### ✅ Formatos de audio soportados
- **WAV** (sin comprimir)
- **MP3** (comprimido)
- **M4A** (comprimido)
- **OGG** (comprimido)
- **AAC** (comprimido) - ¡NUEVO!
- **WMA** (comprimido) - ¡NUEVO!

## 🚀 Instrucciones de Uso

### 1. Configuración Inicial
1. Asegúrate de tener el archivo `.env` en la misma carpeta que el ejecutable
2. El archivo `.env` debe contener tus claves API:
   ```
   API_KEY_OPENAI=tu_clave_openai_aqui
   API_KEY_GEMINI=tu_clave_gemini_aqui
   API_KEY_AZURE=tu_clave_azure_aqui
   API_KEY_AWS=tu_clave_aws_aqui
   ```

### 2. Ejecutar la Aplicación
1. Haz doble clic en `transcriptor-audio-ai.exe`
2. La aplicación se iniciará automáticamente
3. Se abrirá una ventana de consola mostrando:
   ```
   🚀 Servidor backend corriendo en http://localhost:3001
   📁 Archivos estáticos servidos desde: [ruta]
   🔑 APIs configuradas:
      - OpenAI: ✅
      - Gemini: ✅
      - Azure: ✅
      - AWS: ✅
   ```

### 3. Acceder a la Interfaz Web
1. Abre tu navegador web
2. Ve a: `http://localhost:3001`
3. La interfaz se cargará automáticamente

### 4. Usar la Aplicación
1. **Subir archivo**: Arrastra tu archivo de audio o haz clic para seleccionar
   - Formatos soportados: MP3, WAV, M4A, OGG, AAC, WMA
   - Tamaño máximo: 50MB
2. **Seleccionar modelo**: Elige entre Gemini 2.5 Flash o Gemini 2.5 Pro
3. **Tipo de transcripción**:
   - **Estándar**: Usa el prompt predefinido para evaluación de proyectos
   - **Personalizada**: Define tus propias instrucciones
4. **Iniciar transcripción**: Haz clic en "Iniciar Transcripción"
5. **Resultados**: Copia o descarga el texto transcrito

## 📁 Estructura de Archivos Necesarios

```
📁 Carpeta de la aplicación/
├── transcriptor-audio-ai.exe     # Ejecutable principal
├── .env                          # Claves API (REQUERIDO)
├── index.html                    # Interfaz web principal
├── index-embedded.html           # Interfaz web embebida
├── styles.css                    # Estilos CSS
├── script.js                     # JavaScript del frontend
├── config.js                     # Configuración
└── uploads/                      # Carpeta para archivos temporales
```

## ⚠️ Requisitos del Sistema

- **Sistema Operativo**: Windows 10/11 (64-bit)
- **Memoria RAM**: Mínimo 4GB recomendado
- **Espacio en disco**: 100MB libres
- **Conexión a Internet**: Requerida para APIs de IA
- **Navegador**: Chrome, Firefox, Edge o Safari actualizado

## 🔧 Solución de Problemas

### El ejecutable no inicia
- Verifica que el archivo `.env` esté presente
- Asegúrate de que el puerto 3001 no esté en uso
- Ejecuta como administrador si es necesario

### Error de APIs
- Verifica que las claves API en `.env` sean correctas
- Asegúrate de tener créditos/cuota disponible en las APIs
- Revisa tu conexión a Internet

### Archivo no se puede subir
- Verifica que el formato sea soportado (MP3, WAV, M4A, OGG, AAC, WMA)
- Asegúrate de que el archivo sea menor a 50MB
- Intenta con un archivo diferente

### La transcripción falla
- Verifica que el archivo de audio no esté corrupto
- Asegúrate de que el archivo contenga audio audible
- Intenta con un archivo más pequeño

## 📞 Soporte

Si encuentras problemas:
1. Revisa los logs en la ventana de consola
2. Verifica que todos los archivos estén presentes
3. Asegúrate de que las claves API sean válidas
4. Intenta reiniciar la aplicación

## 🔄 Actualizaciones

Esta versión incluye:
- ✅ Soporte para archivos de hasta 50MB (antes 25MB)
- ✅ Nuevos formatos: AAC y WMA
- ✅ Mejor manejo de errores
- ✅ Interfaz actualizada con información de límites

---

**© 2025 Transcriptor de Audio AI - Powered by Multiple AI Models**
