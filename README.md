# RecruitAI

AI-powered recruitment automation platform with:
- FastAPI backend (`backend/`)
- React + Vite frontend (`frontend/`)
- PostgreSQL + Redis dependencies (local or Docker)

---

## What This README Covers

- Full project setup with Docker (recommended)
- Local setup without Docker (backend + frontend)
- Backend-only quick start for API development
- Environment variables and required keys
- Common errors and how to fix them

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Backend | FastAPI, Python 3.11, SQLAlchemy |
| Frontend | React, Vite, TypeScript |
| Database | PostgreSQL 16 (+ pgvector image in Docker) |
| Cache/Queue | Redis 7 |
| AI | OpenAI / Anthropic via LangChain + LangGraph |
| Deployment (dev) | Docker Compose |

---

## Prerequisites

### Required for Docker workflow

- Docker Desktop (with Compose v2)
- Git

Check:

```powershell
docker --version
docker compose version
```

### Required for non-Docker workflow

- Python 3.11
- Node.js 20+
- npm
- (Optional) Docker Desktop to run only Postgres/Redis containers

Check:

```powershell
python --version
node --version
npm --version
```

---

## Project Structure

```text
recruitment-ai/
├── backend/
│   ├── app/
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   ├── package.json
│   └── Dockerfile
└── docker-compose.yml
```

---

## Option A: Run Everything with Docker (Recommended)

From project root (`recruitment-ai`):

```powershell
cd "C:\Users\Admin\Apptware Data\Client Projects\recruitment-ai"
docker compose up --build
```

Services:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/health`

Stop:

```powershell
docker compose down
```

Stop + remove DB/Redis volumes (clean reset):

```powershell
docker compose down -v
```

### Notes

- Use `docker compose` (with a space), not `docker-compose`.
- `backend/.env` is still useful if you want real API keys during local backend development.

---

## Option B: Local Run (No Backend Container)

This mode runs backend + frontend on your machine directly.

### 1) Prepare backend environment file

```powershell
cd "C:\Users\Admin\Apptware Data\Client Projects\recruitment-ai\backend"
Copy-Item .env.example .env
```

Edit `backend/.env` and set values (especially API keys and `SECRET_KEY`).

### 2) Start infrastructure (Postgres + Redis)

From repo root:

```powershell
cd "C:\Users\Admin\Apptware Data\Client Projects\recruitment-ai"
docker compose up -d postgres redis
```

### 3) Start backend

In a new terminal:

```powershell
cd "C:\Users\Admin\Apptware Data\Client Projects\recruitment-ai\backend"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 4) Start frontend

In another terminal:

```powershell
cd "C:\Users\Admin\Apptware Data\Client Projects\recruitment-ai\frontend"
npm install
npm run dev
```

Frontend runs at `http://localhost:5173` and proxies `/api` requests to backend (`http://localhost:8000`).

---

## Option C: Backend-Only Quick Start (Fastest API Development)

Use this when you only need backend endpoints.

### Variant 1: SQLite dev mode (no Postgres required)

```powershell
cd "C:\Users\Admin\Apptware Data\Client Projects\recruitment-ai\backend"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

This uses default SQLite configuration from app settings if `DATABASE_URL` is not set.

### Variant 2: Postgres mode (closer to production)

- Use `requirements.txt`
- Ensure `DATABASE_URL` and `SYNC_DATABASE_URL` point to PostgreSQL
- Start Postgres + Redis first

---

## Environment Variables (`backend/.env`)

Base file: `backend/.env.example`

Important variables:

- `APP_ENV=development`
- `SECRET_KEY=...` (required for JWT/auth)
- `DATABASE_URL=...`
- `SYNC_DATABASE_URL=...`
- `REDIS_URL=redis://localhost:6379`
- `OPENAI_API_KEY=...` and/or `ANTHROPIC_API_KEY=...`
- `EXA_API_KEY=...` (optional, feature-dependent)
- `SENDGRID_API_KEY=...` (optional, feature-dependent)
- `FRONTEND_URL=http://localhost:5173`

If AI/email keys are missing, some features may use fallback behavior or return limited functionality.

---

## Useful Commands

### Backend

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```powershell
cd frontend
npm run dev
```

### Docker logs

```powershell
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f postgres
docker compose logs -f redis
```

---

## Verify Setup

After startup:

1. Open `http://localhost:8000/health` (should return `{"status":"ok",...}`)
2. Open `http://localhost:8000/docs` (Swagger UI)
3. Open `http://localhost:5173` (frontend)

---

## Troubleshooting

### `docker-compose: command not found`

Use:

```powershell
docker compose up --build
```

### Ran `node base.py` and got module errors

This backend is Python, not Node. Use:

```powershell
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Port already in use (`8000`, `5173`, `5432`, `6379`)

Stop conflicting processes/containers, then restart.

### `ModuleNotFoundError` / missing Python package

Activate virtual environment and reinstall:

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Frontend cannot connect to backend

- Confirm backend is running on `http://localhost:8000`
- Confirm frontend is running on `http://localhost:5173`
- Check backend CORS setting (`FRONTEND_URL`) in `backend/.env`

---

## API Endpoints

Primary docs: `http://localhost:8000/docs`

Common endpoints:

- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/workflows`
- `POST /api/workflows/{id}/run`
- `GET /api/candidates/run/{run_id}`
- `POST /api/chat/message`
- `WS /api/chat/ws`
