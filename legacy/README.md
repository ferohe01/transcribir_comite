# Convertidor de Audio a Texto con IA

Una aplicación completa para transcribir archivos de audio utilizando múltiples modelos de inteligencia artificial.

## Características

- **Múltiples modelos de IA soportados:**
  - OpenAI GPT-4o y GPT-4o-mini
  - Google Gemini (gemini-1.5-flash, gemini-1.5-pro)
  - Azure OpenAI
  - AWS Bedrock

- **Formatos de audio soportados:** MP3, WAV, M4A, FLAC, OGG
- **Interfaz web intuitiva**
- **Procesamiento local seguro**
- **Ejecutable independiente (no requiere instalación)**

## Instalación y Uso

### Opción 1: Ejecutable Sin Ventana de Consola (Recomendado)

1. Descarga todos los archivos de la aplicación
2. Crea un archivo `.env` en la misma carpeta con tus claves API:

```env
# OpenAI
OPENAI_API_KEY=tu_clave_openai_aqui

# Google Gemini
GEMINI_API_KEY=tu_clave_gemini_aqui

# Azure OpenAI (opcional)
AZURE_OPENAI_API_KEY=tu_clave_azure_aqui
AZURE_OPENAI_ENDPOINT=tu_endpoint_azure_aqui

# AWS Bedrock (opcional)
AWS_ACCESS_KEY_ID=tu_access_key_aqui
AWS_SECRET_ACCESS_KEY=tu_secret_key_aqui
AWS_REGION=us-east-1
```

3. **Haz doble clic en `start-hidden.vbs`** (inicia sin mostrar ventana de DOS)
4. El navegador se abrirá automáticamente en `http://localhost:3001`
5. ¡Listo! La aplicación corre en segundo plano

**Nota:** Si Windows bloquea el archivo VBS, haz clic derecho > Propiedades > Desbloquear

**Alternativa:** También puedes hacer doble clic en `convierte_audio_texto.exe` directamente, pero se mostrará una ventana de consola que debes mantener abierta.

### Opción 2: Desarrollo

1. Clona o descarga el proyecto
2. Instala las dependencias: `npm install`
3. Configura el archivo `.env` con tus claves API
4. Ejecuta: `npm start`
5. Abre tu navegador en `http://localhost:3000`

## Configuración de APIs

### OpenAI
1. Ve a [OpenAI Platform](https://platform.openai.com/)
2. Crea una cuenta y genera una API key
3. Agrega `OPENAI_API_KEY=tu_clave` al archivo `.env`

### Google Gemini
1. Ve a [Google AI Studio](https://aistudio.google.com/)
2. Genera una API key
3. Agrega `GEMINI_API_KEY=tu_clave` al archivo `.env`

### Azure OpenAI (Opcional)
1. Configura un recurso de Azure OpenAI
2. Obtén tu endpoint y API key
3. Agrega las variables correspondientes al `.env`

### AWS Bedrock (Opcional)
1. Configura AWS CLI o credenciales
2. Habilita los modelos en AWS Bedrock
3. Agrega las credenciales al `.env`

## Uso de la Aplicación

1. **Selecciona el modelo de IA** que deseas usar
2. **Sube tu archivo de audio** (arrastra y suelta o haz clic para seleccionar)
3. **Haz clic en "Transcribir Audio"**
4. **Espera el resultado** - aparecerá en la pantalla
5. **Copia o descarga** la transcripción

## Modelos Disponibles

### OpenAI
- **GPT-4o**: Modelo más avanzado, mejor calidad
- **GPT-4o-mini**: Más rápido y económico

### Google Gemini
- **gemini-1.5-flash**: Rápido y eficiente
- **gemini-1.5-pro**: Mayor precisión y capacidades

### Azure OpenAI
- Modelos de OpenAI a través de Azure

### AWS Bedrock
- Modelos de Amazon y otros proveedores

## Solución de Problemas

### Error: "No se pudo conectar al servidor"
- Verifica que el ejecutable esté corriendo
- Comprueba que el puerto 3000 no esté ocupado

### Error: "API Key inválida"
- Verifica que las claves API estén correctas en el archivo `.env`
- Asegúrate de que las claves tengan los permisos necesarios

### Error: "Formato de archivo no soportado"
- Convierte tu audio a MP3, WAV, M4A, FLAC u OGG
- Verifica que el archivo no esté corrupto

### El archivo de audio es muy grande
- Los archivos deben ser menores a 25MB
- Considera comprimir el audio o dividirlo en partes más pequeñas

## Desarrollo

### Comandos disponibles
- `npm start`: Ejecutar la aplicación
- `npm run dev`: Ejecutar en modo desarrollo con auto-reload
- `npm run build`: Crear ejecutable
- `npm install`: Instalar dependencias

### Estructura del proyecto
```
audio-transcription-app/
├── server.js              # Servidor principal
├── index.html            # Interfaz web principal
├── index-embedded.html   # Interfaz embebida
├── styles.css            # Estilos
├── script.js             # JavaScript del frontend
├── config.js             # Configuración
├── .env                  # Variables de entorno
├── package.json          # Dependencias y scripts
└── uploads/              # Archivos temporales
```

## Licencia

MIT License - Puedes usar, modificar y distribuir libremente.

## Soporte

Para reportar problemas o sugerir mejoras, crea un issue en el repositorio del proyecto.
