class AudioTranscriptionApp {
    constructor() {
        this.selectedFile = null;
        this.initializeElements();
        this.attachEventListeners();
    }

    initializeElements() {
        // Upload elements
        this.uploadArea = document.getElementById('uploadArea');
        this.audioFileInput = document.getElementById('audioFile');
        this.fileInfo = document.getElementById('fileInfo');
        this.fileName = document.getElementById('fileName');
        this.fileSize = document.getElementById('fileSize');
        this.removeFileBtn = document.getElementById('removeFile');
        this.audioPreview = document.getElementById('audioPreview');

        // Options elements
        this.llmSelect = document.getElementById('llmSelect');
        this.transcriptionTypeRadios = document.querySelectorAll('input[name="transcriptionType"]');
        this.customInstructions = document.getElementById('customInstructions');
        this.customPrompt = document.getElementById('customPrompt');

        // Action elements
        this.transcribeBtn = document.getElementById('transcribeBtn');

        // Loading elements
        this.loadingSection = document.getElementById('loadingSection');

        // Result elements
        this.resultSection = document.getElementById('resultSection');
        this.transcriptionResult = document.getElementById('transcriptionResult');
        this.copyBtn = document.getElementById('copyBtn');
        this.downloadBtn = document.getElementById('downloadBtn');

        // Toast
        this.toast = document.getElementById('toast');
    }

    attachEventListeners() {
        // Upload area events
        this.uploadArea.addEventListener('click', () => this.audioFileInput.click());
        this.uploadArea.addEventListener('dragover', this.handleDragOver.bind(this));
        this.uploadArea.addEventListener('dragleave', this.handleDragLeave.bind(this));
        this.uploadArea.addEventListener('drop', this.handleDrop.bind(this));
        
        // File input change
        this.audioFileInput.addEventListener('change', this.handleFileSelect.bind(this));
        
        // Remove file button
        this.removeFileBtn.addEventListener('click', this.removeFile.bind(this));

        // Transcription type radio buttons
        this.transcriptionTypeRadios.forEach(radio => {
            radio.addEventListener('change', this.handleTranscriptionTypeChange.bind(this));
        });

        // Transcribe button
        this.transcribeBtn.addEventListener('click', this.startTranscription.bind(this));

        // Result actions
        this.copyBtn.addEventListener('click', this.copyResult.bind(this));
        this.downloadBtn.addEventListener('click', this.downloadResult.bind(this));
    }

    handleDragOver(e) {
        e.preventDefault();
        this.uploadArea.classList.add('dragover');
    }

    handleDragLeave(e) {
        e.preventDefault();
        this.uploadArea.classList.remove('dragover');
    }

    handleDrop(e) {
        e.preventDefault();
        this.uploadArea.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            this.processFile(files[0]);
        }
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            this.processFile(file);
        }
    }

    processFile(file) {
        // Validate file type
        const validTypes = [
            'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/ogg', 'audio/mpeg', 'audio/x-wav',
            'audio/aac', 'audio/x-aac', 'audio/mp4', // AAC formats
            'audio/x-ms-wma', 'audio/wma' // WMA formats
        ];
        const isValidType = validTypes.some(type => file.type.includes(type.split('/')[1])) || 
                           file.name.match(/\.(mp3|wav|m4a|ogg|aac|wma)$/i);

        if (!isValidType) {
            this.showToast('Por favor selecciona un archivo de audio válido (MP3, WAV, M4A, OGG, AAC, WMA)', 'error');
            return;
        }

        // Validate file size (max 50MB)
        const maxSize = 50 * 1024 * 1024; // 50MB
        if (file.size > maxSize) {
            this.showToast('El archivo es demasiado grande. Máximo 50MB permitido.', 'error');
            return;
        }

        this.selectedFile = file;
        this.displayFileInfo(file);
        this.transcribeBtn.disabled = false;
    }

    displayFileInfo(file) {
        this.fileName.textContent = file.name;
        this.fileSize.textContent = this.formatFileSize(file.size);
        
        // Create audio preview
        const url = URL.createObjectURL(file);
        this.audioPreview.src = url;
        
        // Show file info and hide upload area
        this.uploadArea.style.display = 'none';
        this.fileInfo.style.display = 'block';
    }

    removeFile() {
        this.selectedFile = null;
        this.audioFileInput.value = '';
        this.uploadArea.style.display = 'block';
        this.fileInfo.style.display = 'none';
        this.transcribeBtn.disabled = true;
        // No ocultamos el resultado en diseño de 2 columnas
        
        // Revoke object URL to free memory
        if (this.audioPreview.src) {
            URL.revokeObjectURL(this.audioPreview.src);
            this.audioPreview.src = '';
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    handleTranscriptionTypeChange(e) {
        if (e.target.value === 'custom') {
            this.customInstructions.style.display = 'block';
        } else {
            this.customInstructions.style.display = 'none';
        }
    }

    async startTranscription() {
        if (!this.selectedFile) {
            this.showToast('Por favor selecciona un archivo de audio primero', 'error');
            return;
        }

        // Show loading with progress
        this.showLoadingWithProgress();
        // No ocultamos el resultado, solo lo limpiamos si es necesario

        try {
            // Get selected options
            const selectedLLM = this.llmSelect.value;
            const transcriptionType = document.querySelector('input[name="transcriptionType"]:checked').value;
            const customPrompt = transcriptionType === 'custom' ? this.customPrompt.value.trim() : '';

            // Validate custom prompt if needed
            if (transcriptionType === 'custom' && !customPrompt) {
                this.showToast('Por favor ingresa el prompt personalizado', 'error');
                this.hideLoading();
                return;
            }

            // Call API with progress tracking
            const result = await this.callTranscriptionAPIWithProgress(selectedLLM, transcriptionType, customPrompt);
            
            // Show result
            this.showResult(result);
            this.showToast('Transcripción completada exitosamente');

        } catch (error) {
            console.error('Error during transcription:', error);
            this.showToast('Error durante la transcripción: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    async callTranscriptionAPI(llm, type, customPrompt) {
        // Crear FormData para enviar el archivo
        const formData = new FormData();
        formData.append('audio', this.selectedFile);
        formData.append('llm', llm);
        formData.append('transcriptionType', type);
        
        if (type === 'custom' && customPrompt) {
            formData.append('customPrompt', customPrompt);
        }

        try {
            const response = await fetch('http://localhost:3001/api/transcribe', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Error en la transcripción');
            }

            if (!result.success) {
                throw new Error(result.error || 'Error desconocido');
            }

            return result.transcription;

        } catch (error) {
            console.error('Error en API call:', error);
            throw error;
        }
    }

    showLoading() {
        this.loadingSection.style.display = 'block';
        this.transcribeBtn.disabled = true;
    }

    showLoadingWithProgress() {
        this.loadingSection.style.display = 'block';
        this.transcribeBtn.disabled = true;
        
        // Initialize progress elements
        this.progressFill = document.getElementById('progressFill');
        this.progressPercentage = document.getElementById('progressPercentage');
        this.loadingMessage = document.getElementById('loadingMessage');
        this.loadingDetails = document.getElementById('loadingDetails');
        this.estimatedTime = document.getElementById('estimatedTime');
        this.timeRemaining = document.getElementById('timeRemaining');
        
        // Reset progress
        this.updateProgress(0, 'Preparando archivo...', 'Iniciando proceso de transcripción');
    }

    updateProgress(percentage, message, details, timeRemaining = null) {
        if (this.progressFill) {
            this.progressFill.style.width = `${percentage}%`;
        }
        if (this.progressPercentage) {
            this.progressPercentage.textContent = `${Math.round(percentage)}%`;
        }
        if (this.loadingMessage) {
            this.loadingMessage.textContent = message;
        }
        if (this.loadingDetails) {
            this.loadingDetails.textContent = details;
        }
        if (timeRemaining && this.timeRemaining) {
            this.estimatedTime.style.display = 'block';
            this.timeRemaining.textContent = timeRemaining;
        }
    }

    async callTranscriptionAPIWithProgress(llm, type, customPrompt) {
        // Crear FormData para enviar el archivo
        const formData = new FormData();
        formData.append('audio', this.selectedFile);
        formData.append('llm', llm);
        formData.append('transcriptionType', type);
        
        if (type === 'custom' && customPrompt) {
            formData.append('customPrompt', customPrompt);
        }

        // Simulate progress for different stages
        const startTime = Date.now();
        
        try {
            // Stage 1: Uploading file
            this.updateProgress(10, 'Subiendo archivo...', 'Enviando audio al servidor');
            await this.delay(500);

            // Stage 2: Processing based on LLM
            if (llm.startsWith('gpt')) {
                // OpenAI GPT process
                this.updateProgress(25, 'Transcribiendo con Whisper...', 'Convirtiendo audio a texto', '2-3 minutos');
                await this.delay(1000);
                
                this.updateProgress(60, 'Procesando con ' + llm.toUpperCase() + '...', 'Analizando y estructurando la transcripción', '1-2 minutos');
                await this.delay(1000);
                
                this.updateProgress(85, 'Finalizando procesamiento...', 'Aplicando formato y validaciones');
                await this.delay(500);
            } else {
                // Gemini process
                this.updateProgress(30, 'Subiendo a Gemini...', 'Preparando archivo para procesamiento', '1-2 minutos');
                await this.delay(1000);
                
                this.updateProgress(70, 'Procesando con ' + llm + '...', 'Transcribiendo y analizando contenido', '30-60 segundos');
                await this.delay(1000);
                
                this.updateProgress(90, 'Limpiando archivos temporales...', 'Finalizando proceso');
                await this.delay(500);
            }

            // Make the actual API call
            const response = await fetch('http://localhost:3001/api/transcribe', {
                method: 'POST',
                body: formData
            });

            this.updateProgress(95, 'Recibiendo resultado...', 'Procesando respuesta del servidor');

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Error en la transcripción');
            }

            if (!result.success) {
                throw new Error(result.error || 'Error desconocido');
            }

            // Complete
            this.updateProgress(100, 'Transcripción completada', 'Proceso finalizado exitosamente');
            await this.delay(500);

            const endTime = Date.now();
            const totalTime = Math.round((endTime - startTime) / 1000);
            console.log(`Transcripción completada en ${totalTime} segundos`);

            return result.transcription;

        } catch (error) {
            console.error('Error en API call:', error);
            this.updateProgress(0, 'Error en la transcripción', error.message);
            throw error;
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    hideLoading() {
        this.loadingSection.style.display = 'none';
        this.transcribeBtn.disabled = false;
    }

    showResult(text) {
        this.transcriptionResult.value = text;
        this.resultSection.style.display = 'block';
        
        // Scroll to result
        this.resultSection.scrollIntoView({ behavior: 'smooth' });
    }

    hideResult() {
        this.resultSection.style.display = 'none';
    }

    async copyResult() {
        try {
            await navigator.clipboard.writeText(this.transcriptionResult.value);
            this.showToast('Texto copiado al portapapeles');
        } catch (error) {
            // Fallback for older browsers
            this.transcriptionResult.select();
            document.execCommand('copy');
            this.showToast('Texto copiado al portapapeles');
        }
    }

    downloadResult() {
        const text = this.transcriptionResult.value;
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `transcripcion_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        URL.revokeObjectURL(url);
        this.showToast('Archivo descargado exitosamente');
    }

    showToast(message, type = 'success') {
        this.toast.textContent = message;
        this.toast.className = `toast ${type}`;
        this.toast.classList.add('show');
        
        setTimeout(() => {
            this.toast.classList.remove('show');
        }, 3000);
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AudioTranscriptionApp();
    initializeModal();
});

// Modal functionality
function initializeModal() {
    const showDefaultPromptBtn = document.getElementById('showDefaultPromptBtn');
    const defaultPromptModal = document.getElementById('defaultPromptModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const copyPromptBtn = document.getElementById('copyPromptBtn');
    const defaultPromptText = document.getElementById('defaultPromptText');

    // Show modal
    if (showDefaultPromptBtn) {
        showDefaultPromptBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            defaultPromptModal.classList.add('show');
        });
    }

    // Close modal
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            defaultPromptModal.classList.remove('show');
        });
    }

    // Close modal when clicking outside
    if (defaultPromptModal) {
        defaultPromptModal.addEventListener('click', (e) => {
            if (e.target === defaultPromptModal) {
                defaultPromptModal.classList.remove('show');
            }
        });
    }

    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && defaultPromptModal.classList.contains('show')) {
            defaultPromptModal.classList.remove('show');
        }
    });

    // Copy prompt button
    if (copyPromptBtn && defaultPromptText) {
        copyPromptBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(defaultPromptText.textContent);
                
                // Change button text temporarily
                const originalHTML = copyPromptBtn.innerHTML;
                copyPromptBtn.innerHTML = '<i class="fas fa-check"></i> Copiado';
                copyPromptBtn.style.background = '#48bb78';
                copyPromptBtn.style.borderColor = '#48bb78';
                
                setTimeout(() => {
                    copyPromptBtn.innerHTML = originalHTML;
                    copyPromptBtn.style.background = '#667eea';
                    copyPromptBtn.style.borderColor = '#667eea';
                }, 2000);
            } catch (error) {
                console.error('Error al copiar:', error);
                alert('Error al copiar el prompt');
            }
        });
    }
}

// Additional utility functions for future API integration
class APIService {
    constructor() {
        this.apiKeys = {
            openai: process.env.API_KEY_OPENAI || '',
            gemini: process.env.API_KEY_GEMINI || '',
            azure: process.env.API_KEY_AZURE || '',
            aws: process.env.API_KEY_AWS || ''
        };
    }

    async transcribeWithOpenAI(audioFile, customPrompt = null) {
        // Implementation for OpenAI Whisper API
        const formData = new FormData();
        formData.append('file', audioFile);
        formData.append('model', 'whisper-1');
        
        if (customPrompt) {
            formData.append('prompt', customPrompt);
        }

        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKeys.openai}`
            },
            body: formData
        });

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.statusText}`);
        }

        const result = await response.json();
        return result.text;
    }

    async transcribeWithGemini(audioFile, customPrompt = null) {
        // Implementation for Google Gemini API
        // Note: This would require converting audio to base64 and using Gemini's multimodal capabilities
        throw new Error('Gemini transcription not implemented yet');
    }

    async transcribeWithAzure(audioFile, customPrompt = null) {
        // Implementation for Azure Speech Services
        throw new Error('Azure transcription not implemented yet');
    }

    async transcribeWithAWS(audioFile, customPrompt = null) {
        // Implementation for AWS Transcribe
        throw new Error('AWS transcription not implemented yet');
    }
}
