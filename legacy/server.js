const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Configurar multer para manejar archivos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = './uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/ogg', 'audio/mpeg', 'audio/x-wav',
            'audio/aac', 'audio/x-aac', 'audio/mp4', // AAC formats
            'audio/x-ms-wma', 'audio/wma' // WMA formats
        ];
        if (allowedTypes.some(type => file.mimetype.includes(type.split('/')[1]))) {
            cb(null, true);
        } else {
            cb(new Error('Formato de archivo no soportado'));
        }
    }
});

// Función para transcribir con OpenAI Whisper
async function transcribeWithOpenAI(filePath, customPrompt = null) {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    formData.append('model', 'whisper-1');
    
    if (customPrompt) {
        formData.append('prompt', customPrompt);
    }

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.API_KEY_OPENAI}`,
            ...formData.getHeaders()
        },
        body: formData
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const result = await response.json();
    return result.text;
}

// Función para procesar con modelos GPT de OpenAI
async function processWithOpenAIGPT(transcription, customPrompt = null, modelName = 'gpt-4o') {
    try {
        const basePrompt = customPrompt || `Este audio corresponde a la evaluación de proyectos, para cada uno de los proyectos evaluados:
Extrae el código del proyecto.
Extrae exactamente los comentarios de los 3 evaluadores para cada proyecto.
(No es necesario identificar el nombre de cada evaluador, solo separa claramente los 3 comentarios).
No incluyas información de proyectos que no fueron evaluados.

El formato de respuesta debe ser el siguiente para cada proyecto:
Proyecto: [código]
Comentario 1: [texto literal del primer comentario]
Comentario 2: [texto literal del segundo comentario]
Comentario 3: [texto literal del tercer comentario]
Estado del proyecto: [Aprobado / Desaprobado]

Repite esta estructura para cada uno de los proyectos evaluados, manteniendo el texto exactamente como aparece en el audio, sin resumir ni modificar los comentarios.`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.API_KEY_OPENAI}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: modelName,
                messages: [
                    {
                        role: 'system',
                        content: 'Eres un asistente especializado en procesar transcripciones de audio y extraer información estructurada según las instrucciones proporcionadas.'
                    },
                    {
                        role: 'user',
                        content: `${basePrompt}\n\nTranscripción del audio:\n${transcription}`
                    }
                ],
                temperature: 0.1
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OpenAI GPT API error: ${response.status} - ${error}`);
        }

        const result = await response.json();
        return result.choices[0].message.content;

    } catch (error) {
        console.error('Error en procesamiento con OpenAI GPT:', error);
        throw new Error(`OpenAI GPT API error: ${error.message}`);
    }
}

// Función combinada para transcribir y procesar con OpenAI GPT
async function transcribeAndProcessWithOpenAIGPT(filePath, customPrompt = null, modelName = 'gpt-4o') {
    try {
        console.log('Transcribiendo con OpenAI Whisper...');
        const transcription = await transcribeWithOpenAI(filePath);
        
        console.log(`Procesando con ${modelName}...`);
        const processedResult = await processWithOpenAIGPT(transcription, customPrompt, modelName);
        
        return processedResult;
        
    } catch (error) {
        console.error('Error en transcripción y procesamiento con OpenAI:', error);
        throw error;
    }
}

// Función para transcribir con Google Gemini (transcripción nativa)
async function transcribeWithGemini(filePath, customPrompt = null, modelName = 'gemini-1.5-flash') {
    try {
        // Inicializar Gemini AI
        const genAI = new GoogleGenerativeAI(process.env.API_KEY_GEMINI);
        const fileManager = new GoogleAIFileManager(process.env.API_KEY_GEMINI);
        
        // Detectar el tipo MIME del archivo
        const fileExtension = path.extname(filePath).toLowerCase();
        let mimeType = "audio/mpeg"; // default
        
        switch (fileExtension) {
            case '.mp3':
                mimeType = "audio/mpeg";
                break;
            case '.wav':
                mimeType = "audio/wav";
                break;
            case '.m4a':
                mimeType = "audio/mp4";
                break;
            case '.ogg':
                mimeType = "audio/ogg";
                break;
            case '.aac':
                mimeType = "audio/aac";
                break;
            case '.wma':
                mimeType = "audio/x-ms-wma";
                break;
            default:
                mimeType = "audio/mpeg";
        }
        
        // Subir el archivo de audio
        console.log('Subiendo archivo a Gemini...');
        const uploadResponse = await fileManager.uploadFile(filePath, {
            mimeType: mimeType,
            displayName: path.basename(filePath)
        });
        
        console.log('Archivo subido:', uploadResponse.file.displayName);
        
        // Configurar el modelo
        console.log(`Usando modelo: ${modelName}`);
        const model = genAI.getGenerativeModel({ model: modelName });
        
        // Crear el prompt
        const basePrompt = customPrompt || `Este audio corresponde a la evaluación de proyectos, para cada uno de los proyectos evaluados:
Extrae el código del proyecto.
Extrae exactamente los comentarios de los 3 evaluadores para cada proyecto.
(No es necesario identificar el nombre de cada evaluador, solo separa claramente los 3 comentarios).
No incluyas información de proyectos que no fueron evaluados.

El formato de respuesta debe ser el siguiente para cada proyecto:
Proyecto: [código]
Comentario 1: [texto literal del primer comentario]
Comentario 2: [texto literal del segundo comentario]
Comentario 3: [texto literal del tercer comentario]
Estado del proyecto: [Aprobado / Desaprobado]

Repite esta estructura para cada uno de los proyectos evaluados, manteniendo el texto exactamente como aparece en el audio, sin resumir ni modificar los comentarios.`;
        
        // Generar la transcripción
        console.log('Generando transcripción con Gemini...');
        const result = await model.generateContent([
            basePrompt,
            {
                fileData: {
                    mimeType: uploadResponse.file.mimeType,
                    fileUri: uploadResponse.file.uri
                }
            }
        ]);
        
        const transcription = result.response.text();
        
        // Limpiar el archivo de Gemini (opcional)
        try {
            await fileManager.deleteFile(uploadResponse.file.name);
            console.log('Archivo eliminado de Gemini');
        } catch (deleteError) {
            console.warn('No se pudo eliminar el archivo de Gemini:', deleteError.message);
        }
        
        return transcription;
        
    } catch (error) {
        console.error('Error en transcripción con Gemini:', error);
        throw new Error(`Gemini API error: ${error.message}`);
    }
}

// Función para transcribir con Azure Speech Services
async function transcribeWithAzure(filePath, customPrompt = null) {
    // Implementación para Azure Speech Services
    throw new Error('Azure transcription not implemented yet');
}

// Función para transcribir con AWS Transcribe
async function transcribeWithAWS(filePath, customPrompt = null) {
    // Implementación para AWS Transcribe
    throw new Error('AWS transcription not implemented yet');
}

// Endpoint principal para transcripción
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se proporcionó archivo de audio' });
        }

        const { llm, transcriptionType, customPrompt } = req.body;
        const filePath = req.file.path;

        console.log(`Transcribiendo con ${llm}...`);
        console.log(`Tipo: ${transcriptionType}`);
        console.log(`Prompt personalizado: ${customPrompt || 'No'}`);

        let transcription;
        const prompt = transcriptionType === 'custom' ? customPrompt : null;

        // Configurar headers para Server-Sent Events si es necesario
        if (req.headers.accept && req.headers.accept.includes('text/event-stream')) {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Cache-Control'
            });
        }

        switch (llm) {
            case 'gemini-2.5-flash':
                transcription = await transcribeWithGemini(filePath, prompt, 'gemini-2.5-flash');
                break;
            case 'gemini-2.5-pro':
                transcription = await transcribeWithGemini(filePath, prompt, 'gemini-2.5-pro');
                break;
            case 'gpt-4o':
                transcription = await transcribeAndProcessWithOpenAIGPT(filePath, prompt, 'gpt-4o');
                break;
            case 'gpt-5':
                transcription = await transcribeAndProcessWithOpenAIGPT(filePath, prompt, 'gpt-5');
                break;
            default:
                throw new Error('Modelo no soportado. Se admiten: Gemini 2.5 Flash, Gemini 2.5 Pro, GPT-4o, GPT-5');
        }

        // Limpiar archivo temporal
        fs.unlinkSync(filePath);

        // Si hay prompt personalizado, procesarlo
        if (transcriptionType === 'custom' && customPrompt) {
            transcription = `Transcripción procesada según instrucciones: "${customPrompt}"\n\n${transcription}`;
        }

        res.json({ 
            success: true, 
            transcription: transcription,
            llm: llm,
            transcriptionType: transcriptionType
        });

    } catch (error) {
        console.error('Error en transcripción:', error);
        
        // Limpiar archivo si existe
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({ 
            error: error.message || 'Error interno del servidor',
            success: false 
        });
    }
});

// Endpoint para verificar el estado de las APIs
app.get('/api/status', (req, res) => {
    const status = {
        openai: !!process.env.API_KEY_OPENAI,
        gemini: !!process.env.API_KEY_GEMINI,
        azure: !!process.env.API_KEY_AZURE,
        aws: !!process.env.API_KEY_AWS
    };

    res.json({ status, timestamp: new Date().toISOString() });
});

// Servir archivos estáticos
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index-embedded.html'));
});

// Servir CSS
app.get('/styles.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'styles.css'));
});

// Servir JS
app.get('/script.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'script.js'));
});

// Servir config.js
app.get('/config.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'config.js'));
});

// Función para abrir el navegador automáticamente
function openBrowser(url) {
    const { exec } = require('child_process');
    const os = require('os');
    
    let command;
    switch (os.platform()) {
        case 'win32':
            command = `start ${url}`;
            break;
        case 'darwin':
            command = `open ${url}`;
            break;
        default:
            command = `xdg-open ${url}`;
    }
    
    exec(command, (error) => {
        if (error) {
            console.error('Error al abrir el navegador:', error);
        }
    });
}

// Iniciar servidor
app.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    
    console.log(`🚀 Servidor backend corriendo en ${url}`);
    console.log(`📁 Archivos estáticos servidos desde: ${__dirname}`);
    console.log(`🔑 APIs configuradas:`);
    console.log(`   - OpenAI: ${process.env.API_KEY_OPENAI ? '✅' : '❌'}`);
    console.log(`   - Gemini: ${process.env.API_KEY_GEMINI ? '✅' : '❌'}`);
    console.log(`   - Azure: ${process.env.API_KEY_AZURE ? '✅' : '❌'}`);
    console.log(`   - AWS: ${process.env.API_KEY_AWS ? '✅' : '❌'}`);
    console.log(`\n🌐 Abriendo navegador en ${url}...`);
    
    // Abrir el navegador automáticamente después de 1 segundo
    setTimeout(() => {
        openBrowser(url);
    }, 1000);
});

// Manejo de errores global
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'Archivo demasiado grande (máximo 50MB)' });
        }
    }
    
    console.error('Error no manejado:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
});
