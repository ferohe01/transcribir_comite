// Configuración de la aplicación
const CONFIG = {
    // Configuración de archivos
    FILE: {
        MAX_SIZE_MB: 25,
        MAX_SIZE_BYTES: 25 * 1024 * 1024,
        SUPPORTED_FORMATS: ['mp3', 'wav', 'm4a', 'ogg'],
        SUPPORTED_MIME_TYPES: [
            'audio/mp3', 
            'audio/wav', 
            'audio/m4a', 
            'audio/ogg', 
            'audio/mpeg', 
            'audio/x-wav',
            'audio/mp4',
            'audio/x-m4a'
        ]
    },

    // Configuración de LLMs
    LLMS: {
        OPENAI: {
            id: 'openai',
            name: 'OpenAI Whisper',
            description: 'Excelente precisión general y soporte multiidioma',
            endpoint: 'https://api.openai.com/v1/audio/transcriptions',
            model: 'whisper-1',
            maxFileSize: 25 * 1024 * 1024, // 25MB
            supportedFormats: ['mp3', 'wav', 'm4a', 'ogg']
        },
        GEMINI: {
            id: 'gemini',
            name: 'Google Gemini',
            description: 'Bueno para análisis contextual y comprensión avanzada',
            endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
            model: 'gemini-pro',
            maxFileSize: 20 * 1024 * 1024, // 20MB
            supportedFormats: ['mp3', 'wav', 'm4a']
        },
        AZURE: {
            id: 'azure',
            name: 'Azure Speech Services',
            description: 'Robusto para aplicaciones empresariales',
            endpoint: 'https://[region].stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1',
            model: 'latest',
            maxFileSize: 100 * 1024 * 1024, // 100MB
            supportedFormats: ['wav', 'ogg', 'mp3', 'm4a']
        },
        AWS: {
            id: 'aws',
            name: 'AWS Transcribe',
            description: 'Escalable y confiable para grandes volúmenes',
            endpoint: 'https://transcribe.[region].amazonaws.com/',
            model: 'default',
            maxFileSize: 2 * 1024 * 1024 * 1024, // 2GB
            supportedFormats: ['mp3', 'wav', 'm4a', 'ogg']
        }
    },

    // Prompts por defecto
    PROMPTS: {
        DEFAULT: "Realiza la transcripción del audio que el usuario ha subido y entrégame en formato texto",
        EXAMPLES: [
            "Transcribe el audio y resume los puntos principales en formato de lista",
            "Transcribe solo las preguntas y respuestas, ignorando muletillas y sonidos de fondo",
            "Transcribe y traduce al inglés manteniendo el contexto original",
            "Transcribe y extrae las fechas, nombres y lugares mencionados",
            "Transcribe y organiza el contenido en párrafos temáticos",
            "Transcribe y corrige errores gramaticales manteniendo el sentido original"
        ]
    },

    // Configuración de UI
    UI: {
        TOAST_DURATION: 3000,
        LOADING_SIMULATION_TIME: 3000,
        SCROLL_BEHAVIOR: 'smooth',
        ANIMATION_DURATION: 300
    },

    // Mensajes de error
    MESSAGES: {
        ERRORS: {
            INVALID_FILE_TYPE: 'Por favor selecciona un archivo de audio válido',
            FILE_TOO_LARGE: 'El archivo es demasiado grande. Máximo {size}MB permitido',
            NO_FILE_SELECTED: 'Por favor selecciona un archivo de audio primero',
            EMPTY_CUSTOM_PROMPT: 'Por favor ingresa el prompt personalizado',
            API_CONNECTION_ERROR: 'Error de conexión con el servicio de transcripción',
            TRANSCRIPTION_FAILED: 'Error durante la transcripción',
            COPY_FAILED: 'Error al copiar al portapapeles'
        },
        SUCCESS: {
            TRANSCRIPTION_COMPLETED: 'Transcripción completada exitosamente',
            TEXT_COPIED: 'Texto copiado al portapapeles',
            FILE_DOWNLOADED: 'Archivo descargado exitosamente'
        },
        INFO: {
            PROCESSING: 'Procesando tu audio...',
            PROCESSING_SUBTITLE: 'Esto puede tomar unos momentos dependiendo del tamaño del archivo'
        }
    },

    // Configuración de desarrollo
    DEV: {
        SIMULATE_API_CALLS: true,
        API_SUCCESS_RATE: 0.9, // 90% success rate for simulation
        LOG_LEVEL: 'info' // 'debug', 'info', 'warn', 'error'
    }
};

// Utilidades de configuración
const ConfigUtils = {
    // Obtener configuración de LLM por ID
    getLLMConfig(llmId) {
        return CONFIG.LLMS[llmId.toUpperCase()] || CONFIG.LLMS.OPENAI;
    },

    // Validar formato de archivo
    isValidFileFormat(file) {
        const extension = file.name.split('.').pop().toLowerCase();
        const mimeType = file.type.toLowerCase();
        
        return CONFIG.FILE.SUPPORTED_FORMATS.includes(extension) ||
               CONFIG.FILE.SUPPORTED_MIME_TYPES.some(type => mimeType.includes(type.split('/')[1]));
    },

    // Validar tamaño de archivo
    isValidFileSize(file, llmId = 'openai') {
        const llmConfig = this.getLLMConfig(llmId);
        return file.size <= llmConfig.maxFileSize;
    },

    // Formatear tamaño de archivo
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    // Obtener mensaje de error formateado
    getErrorMessage(errorKey, params = {}) {
        let message = CONFIG.MESSAGES.ERRORS[errorKey] || 'Error desconocido';
        
        // Reemplazar parámetros en el mensaje
        Object.keys(params).forEach(key => {
            message = message.replace(`{${key}}`, params[key]);
        });
        
        return message;
    },

    // Logging con niveles
    log(level, message, data = null) {
        const levels = ['debug', 'info', 'warn', 'error'];
        const currentLevelIndex = levels.indexOf(CONFIG.DEV.LOG_LEVEL);
        const messageLevelIndex = levels.indexOf(level);
        
        if (messageLevelIndex >= currentLevelIndex) {
            const timestamp = new Date().toISOString();
            const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
            
            switch (level) {
                case 'error':
                    console.error(logMessage, data);
                    break;
                case 'warn':
                    console.warn(logMessage, data);
                    break;
                case 'debug':
                    console.debug(logMessage, data);
                    break;
                default:
                    console.log(logMessage, data);
            }
        }
    }
};

// Exportar configuración para uso global
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CONFIG, ConfigUtils };
} else {
    window.CONFIG = CONFIG;
    window.ConfigUtils = ConfigUtils;
}
