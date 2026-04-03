# RecruitAI Backend — Dev Setup Script (Windows PowerShell)
# Run this from the /backend directory:  .\setup_dev.ps1

Write-Host "=== RecruitAI Backend Dev Setup ===" -ForegroundColor Cyan

# Check Python
$pythonCmd = $null
foreach ($cmd in @("python3.11", "python3", "python")) {
    try {
        $ver = & $cmd --version 2>&1
        if ($ver -match "Python 3\.(9|10|11|12)") {
            $pythonCmd = $cmd
            Write-Host "Found: $ver using '$cmd'" -ForegroundColor Green
            break
        }
    } catch {}
}

if (-not $pythonCmd) {
    Write-Host "ERROR: Python 3.9+ not found." -ForegroundColor Red
    Write-Host "Install from: https://www.python.org/downloads/release/python-31110/" -ForegroundColor Yellow
    Write-Host "IMPORTANT: Check 'Add Python to PATH' during installation!" -ForegroundColor Yellow
    exit 1
}

# Create virtual environment
if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment..." -ForegroundColor Cyan
    & $pythonCmd -m venv .venv
}

# Activate venv
$activateScript = ".venv\Scripts\Activate.ps1"
if (Test-Path $activateScript) {
    & $activateScript
    Write-Host "Virtual environment activated." -ForegroundColor Green
} else {
    Write-Host "Could not activate venv — continuing with global Python" -ForegroundColor Yellow
}

# Install dependencies
Write-Host "Installing Python packages..." -ForegroundColor Cyan
pip install -r requirements.txt

if ($LASTEXITCODE -eq 0) {
    Write-Host "=== Setup complete! ===" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Edit .env and add your OPENAI_API_KEY"
    Write-Host "  2. Start the server:"
    Write-Host "     .venv\Scripts\uvicorn.exe app.main:app --reload --port 8000"
    Write-Host ""
    Write-Host "API docs at: http://localhost:8000/docs"
} else {
    Write-Host "pip install failed. Check the error above." -ForegroundColor Red
}
