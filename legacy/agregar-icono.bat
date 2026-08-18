@echo off
echo ========================================
echo AGREGAR ICONO AL EJECUTABLE
echo ========================================
echo.

REM Verificar si existe el ejecutable
if not exist "convierte_audio_texto.exe" (
    echo ERROR: No se encontro convierte_audio_texto.exe
    echo Por favor, ejecuta primero: npm run build
    pause
    exit /b 1
)

REM Verificar si existe el icono PNG
if not exist "icono.png" (
    echo ERROR: No se encontro icono.png
    echo Asegurate de tener el archivo icono.png en esta carpeta
    pause
    exit /b 1
)

echo [1/3] Verificando herramientas necesarias...
echo.

REM Verificar si rcedit esta instalado
where rcedit >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo NOTA: No se encontro 'rcedit' instalado.
    echo.
    echo Para agregar el icono automaticamente, necesitas instalar rcedit:
    echo.
    echo Opcion 1 - Usando npm:
    echo    npm install -g rcedit
    echo.
    echo Opcion 2 - Descarga manual:
    echo    1. Ve a: https://github.com/electron/rcedit/releases
    echo    2. Descarga rcedit-x64.exe
    echo    3. Renombralo a rcedit.exe
    echo    4. Colocalo en esta carpeta o agregalo al PATH
    echo.
    echo Opcion 3 - Conversion manual:
    echo    1. Convierte icono.png a icono.ico usando:
    echo       https://convertio.co/es/png-ico/
    echo    2. Descarga ResourceHacker: http://www.angusj.com/resourcehacker/
    echo    3. Abre convierte_audio_texto.exe con ResourceHacker
    echo    4. Ve a Action ^> Replace Icon
    echo    5. Selecciona icono.ico y guarda
    echo.
    pause
    exit /b 1
)

echo [2/3] Convirtiendo PNG a ICO...
echo.

REM Nota: rcedit puede trabajar directamente con PNG en versiones recientes
REM pero es mejor convertir a ICO primero

echo IMPORTANTE: rcedit requiere un archivo .ICO
echo.
echo Por favor, convierte icono.png a icono.ico usando:
echo   - https://convertio.co/es/png-ico/
echo   - https://www.icoconverter.com/
echo   - O cualquier otra herramienta de conversion
echo.
echo Una vez que tengas icono.ico en esta carpeta, presiona cualquier tecla...
pause >nul

if not exist "icono.ico" (
    echo ERROR: No se encontro icono.ico
    echo Por favor, convierte icono.png a icono.ico y vuelve a ejecutar este script
    pause
    exit /b 1
)

echo [3/3] Agregando icono al ejecutable...
echo.

rcedit "convierte_audio_texto.exe" --set-icon "icono.ico"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo EXITO: Icono agregado correctamente!
    echo ========================================
    echo.
    echo El archivo convierte_audio_texto.exe ahora tiene su icono.
    echo Puedes crear un acceso directo en el escritorio.
    echo.
) else (
    echo.
    echo ERROR: No se pudo agregar el icono
    echo Verifica los mensajes de error anteriores
    echo.
)

pause
