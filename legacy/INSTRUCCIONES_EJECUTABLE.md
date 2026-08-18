# 📋 Instrucciones para usar el Transcriptor de Audio AI (Ejecutable)

## 🚀 Cómo ejecutar la aplicación

### 1. **Ejecutar el archivo .exe**
- Haz doble clic en `transcriptor-audio-ai.exe`
- O ejecuta desde la línea de comandos: `.\transcriptor-audio-ai.exe`

### 2. **Acceder a la aplicación**
- Una vez ejecutado, abre tu navegador web
- Ve a: **http://localhost:3001**
- ¡La aplicación estará lista para usar!

## ⚙️ Configuración inicial

### **API Key de Gemini (OBLIGATORIO)**
Antes de usar la aplicación, debes configurar tu API key de Google Gemini:

1. **Obtener API Key:**
   - Ve a [Google AI Studio](https://makersuite.google.com/)
   - Crea una cuenta o inicia sesión
   - Genera una API key gratuita

2. **Configurar la API Key:**
   - Abre el archivo `.env` (en la misma carpeta del ejecutable)
   - Reemplaza `your_gemini_api_key_here` con tu API key real:
   ```
   API_KEY_GEMINI=tu_api_key_real_aqui
   ```

## 🎯 Cómo usar la aplicación

### **Paso 1: Subir audio**
- Arrastra tu archivo de audio al área designada
- O haz clic para seleccionar un archivo
- Formatos soportados: MP3, WAV, M4A, OGG
- Tamaño máximo: 25MB

### **Paso 2: Seleccionar modelo**
- **Gemini 2.5 Flash** (Recomendado): Rápido y eficiente
- **Gemini 2.5 Pro**: Más potente para análisis complejos

### **Paso 3: Tipo de transcripción**
- **Estándar**: Transcripción directa del audio
- **Personalizada**: Agrega instrucciones específicas

### **Paso 4: Transcribir**
- Haz clic en "Iniciar Transcripción"
- Espera el resultado
- Copia o descarga la transcripción

## 📝 Ejemplos de instrucciones personalizadas

```
Transcribe el audio y extrae solo los nombres y fechas mencionados.
```

```
Transcribe y organiza el contenido en formato de lista con viñetas.
```

```
Transcribe el audio y resume los puntos principales en máximo 3 párrafos.
```

## 🔧 Solución de problemas

### **Error: "API Key no configurada"**
- Verifica que hayas configurado correctamente la API key en el archivo `.env`
- Asegúrate de que la API key sea válida

### **Error: "Puerto ocupado"**
- Si el puerto 3001 está ocupado, cierra otras aplicaciones que puedan usarlo
- O reinicia tu computadora

### **La aplicación no abre**
- Verifica que tengas permisos de administrador
- Asegúrate de que Windows Defender no esté bloqueando el archivo
- Ejecuta como administrador si es necesario

### **Error de transcripción**
- Verifica tu conexión a internet
- Asegúrate de que el archivo de audio no esté corrupto
- Intenta con un archivo más pequeño

## 📁 Archivos incluidos

- `transcriptor-audio-ai.exe` - Aplicación principal
- `.env` - Archivo de configuración (API keys)
- `INSTRUCCIONES_EJECUTABLE.md` - Este archivo

## 🆘 Soporte

Si tienes problemas:
1. Verifica que tu API key de Gemini esté configurada correctamente
2. Asegúrate de tener conexión a internet
3. Intenta reiniciar la aplicación
4. Verifica que el formato de audio sea compatible

---

**¡Disfruta transcribiendo tus audios con IA! 🎉**
