# MedTrust AI — Local Run Order & Health Check Guide

## Prerequisites

| Requirement | Check |
|-------------|-------|
| Docker Desktop running | `docker info` |
| Docker Compose v2 | `docker compose version` |
| Node.js ≥ 20 | `node --version` |
| Python 3.11 | `python3 --version` |
| Git | `git --version` |

---

## STEP 1 — Start Docker Desktop

The error you saw (`Cannot connect to the Docker daemon`) means Docker is not running.

**macOS:**
```bash
open -a Docker
# Wait ~30 seconds for the whale icon in the menu bar to stop animating
docker info   # Must succeed before continuing
```

---

## STEP 2 — Full Stack via Docker Compose (Recommended)

This single command builds and starts everything:

```bash
cd /Users/devvirat/Downloads/MedTrust

docker compose up --build
```

Services start in dependency order automatically:
1. `postgres` → `redis` (infrastructure)
2. `backend` (waits for postgres + redis healthchecks)
3. `video_service`, `audio_service`, `biometric_service` (AI gRPC)
4. `frontend` (waits for backend healthcheck)
5. `prometheus`, `grafana` (monitoring)

To run in background:
```bash
docker compose up --build -d
docker compose logs -f backend   # tail backend logs
```

---

## STEP 3 — Health Checks (run after compose up)

### PostgreSQL
```bash
docker exec medtrust_postgres pg_isready -U medtrust_user -d medtrust
# Expected: /var/run/postgresql:5432 - accepting connections
```

### Redis
```bash
docker exec medtrust_redis redis-cli -a redis_secret ping
# Expected: PONG
```

### Backend API
```bash
curl -s http://localhost:4000/api/v1/health | python3 -m json.tool
# Expected: {"status": "ok", "service": "MedTrust API Gateway", ...}
```

### Frontend
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
# Expected: 200
```

### Video gRPC Service
```bash
docker exec medtrust_video_service python3 -c "
import grpc
ch = grpc.insecure_channel('localhost:50051')
fut = grpc.channel_ready_future(ch)
fut.result(timeout=5)
print('video_service: READY')
"
```

### Audio gRPC Service
```bash
docker exec medtrust_audio_service python3 -c "
import grpc
ch = grpc.insecure_channel('localhost:50052')
grpc.channel_ready_future(ch).result(timeout=5)
print('audio_service: READY')
"
```

### Biometric gRPC Service
```bash
docker exec medtrust_biometric_service python3 -c "
import grpc
ch = grpc.insecure_channel('localhost:50053')
grpc.channel_ready_future(ch).result(timeout=5)
print('biometric_service: READY')
"
```

### Prometheus
```bash
curl -s http://localhost:9090/-/healthy
# Expected: Prometheus Server is Healthy.
```

### Grafana
```bash
curl -s http://localhost:3001/api/health | python3 -m json.tool
# Expected: {"commit":"...","database":"ok","version":"..."}
```

---

## STEP 4 — Verify Authentication (Login)

```bash
curl -s -X POST http://localhost:4000/api/v1/doctor/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@medtrust.ai","password":"Admin@MedTrust2024!"}' \
  | python3 -m json.tool

# Expected: {"access_token": "eyJ...", "doctor": {"role": "admin", ...}}
```

Save the token for subsequent calls:
```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/doctor/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@medtrust.ai","password":"Admin@MedTrust2024!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
echo "Token: $TOKEN"
```

---

## STEP 5 — Verify Trust Score & Dashboard

```bash
# Get admin dashboard stats
curl -s http://localhost:4000/api/v1/admin/dashboard \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Get AI config
curl -s http://localhost:4000/api/v1/admin/config \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## STEP 6 — Verify WebRTC Signaling (Socket.IO)

```bash
# Install wscat if needed: npm install -g wscat
# Test Socket.IO polling transport (quick check)
curl -s "http://localhost:4000/socket.io/?EIO=4&transport=polling" | head -c 100
# Expected: starts with 0{ (Socket.IO handshake)
```

Full WebRTC test: open http://localhost:3000, log in, open two browser tabs, and verify peer connection is established via browser console logs `[WebRTC] Connection state: connected`.

---

## STEP 7 — Verify Trust Score Live Updates

```bash
# Start a test stream
STREAM_RESPONSE=$(curl -s -X POST http://localhost:4000/api/v1/admin/stream/start \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"doctor_id":"<doctor-uuid>","patient_id":"patient-001","icu_room":"ICU-A1"}')
echo $STREAM_RESPONSE | python3 -m json.tool

STREAM_ID=$(echo $STREAM_RESPONSE | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# Poll live trust score (will be 404 until first analysis chunk is sent)
curl -s "http://localhost:4000/api/v1/trustscore/live/$STREAM_ID" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## ALTERNATIVE — Local Dev (without Docker, services only in Docker)

Use this for rapid frontend/backend iteration:

```bash
# 1. Start only DB and Redis in Docker
docker compose up -d postgres redis

# 2. Start backend locally
cd backend
npm install
npm run dev    # Port 4000, auto-restarts on change

# 3. Start frontend locally
cd ../frontend
npm install
npm run dev    # Port 5173, hot module reload

# 4. Start AI services locally (Python 3.11)
cd ../ai-services
pip install -r requirements.txt

# Generate gRPC stubs (one-time)
mkdir -p proto_gen && touch proto_gen/__init__.py
python -m grpc_tools.protoc -I./proto \
  --python_out=./proto_gen --grpc_python_out=./proto_gen \
  proto/video_detection.proto proto/audio_detection.proto proto/biometric_engine.proto

# In separate terminals:
PYTHONPATH=. python video_detection/video_service.py
PYTHONPATH=. python audio_detection/audio_service.py
PYTHONPATH=. python biometric_engine/biometric_service.py
```

---

## Debug Logging

### Enable verbose backend logs
```bash
# In docker-compose, backend environment already has LOG_LEVEL=info
# For debug level, override:
LOG_LEVEL=debug docker compose up backend
```

### View backend logs
```bash
docker compose logs -f backend --tail=100
```

### View AI service logs
```bash
docker compose logs -f video_service --tail=50
docker compose logs -f audio_service --tail=50
```

### Check postgres schema was applied
```bash
docker exec medtrust_postgres psql -U medtrust_user -d medtrust \
  -c "\dt"
# Expected: doctors, voice_embeddings, streams, trust_logs, blockchain_logs, audit_events, admin_configurations
```

### Inspect Redis trust cache
```bash
docker exec medtrust_redis redis-cli -a redis_secret KEYS "trust_score:*"
docker exec medtrust_redis redis-cli -a redis_secret GET "trust_score:<stream-id>"
```

---

## Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `Cannot connect to Docker daemon` | Docker Desktop not running | `open -a Docker` and wait |
| `port is already allocated` | Port conflict | `lsof -i :4000` then kill or change port |
| `password authentication failed for user "medtrust_user"` | Wrong DB password | Check `POSTGRES_PASSWORD` env matches `DB_PASSWORD` |
| `WRONGPASS invalid username-password pair` | Wrong Redis password | Check `REDIS_PASSWORD` matches `redis-server --requirepass` value |
| `ENOENT: no such file or directory, open '.../proto/video_detection.proto'` | Proto path wrong in grpc.js | Verify `ai-services/proto/` is copied into backend container |
| `gRPC video client init failed` | AI service not started yet | Normal during startup — backend continues without AI; retry after AI services are healthy |
| `trust_score.proto not found` | Was removed from grpc.js | Already fixed — no trust_score.proto needed |
| `relation "trust_logs" does not exist` | Schema not applied | Run `docker compose down -v && docker compose up --build` to re-initialize DB |
| Frontend blank page | Build args not set | Rebuild: `docker compose build --no-cache frontend` |

---

## Service URLs Summary

| Service | URL |
|---------|-----|
| Frontend Dashboard | http://localhost:3000 |
| Backend API | http://localhost:4000/api/v1/health |
| Socket.IO | http://localhost:4000/socket.io |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001 (admin/admin) |
| PostgreSQL | localhost:5432 (medtrust_user/medtrust_secret) |
| Redis | localhost:6379 (password: redis_secret) |
| Video gRPC | localhost:50051 |
| Audio gRPC | localhost:50052 |
| Biometric gRPC | localhost:50053 |
