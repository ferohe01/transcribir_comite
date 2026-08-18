@echo off
echo ========================================
echo   Transcriptor de Audio AI - Iniciando
echo ========================================
echo.
echo Verificando archivos necesarios...

if not exist ".env" (
    echo ERROR: Archivo .env no encontrado
    echo Por favor configura tu API key de Gemini en el archivo .env
    pause
    exit /b 1
)

echo Iniciando servidor...
echo.
echo La aplicacion estara disponible en: http://localhost:3001
echo.
echo Presiona Ctrl+C para detener el servidor
echo ========================================
echo.

transcriptor-audio-ai-final.exe

pause
