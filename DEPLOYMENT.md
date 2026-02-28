# MedTrust AI — Deployment & API Documentation

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Local Development Setup](#local-development-setup)
4. [Docker Compose Deployment](#docker-compose-deployment)
5. [Environment Variables Reference](#environment-variables-reference)
6. [Running Tests](#running-tests)
7. [API Reference](#api-reference)
8. [WebRTC Signaling Setup](#webrtc-signaling-setup)
9. [Blockchain Setup](#blockchain-setup)
10. [Monitoring & Observability](#monitoring--observability)
11. [Security Hardening Checklist](#security-hardening-checklist)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Nginx (TLS)                          │
│                   Port 80/443 → Reverse Proxy               │
└───────────┬────────────────────────────┬────────────────────┘
            │                            │
    ┌───────▼──────────┐      ┌──────────▼──────────┐
    │  React Frontend  │      │  Node.js API Gateway │
    │  (Vite + Tailwind│      │  Port 4000           │
    │  + shadcn/ui)    │      │  REST + Socket.IO    │
    └──────────────────┘      │  JWT + RBAC          │
                              └────────┬─────────────┘
                                       │ gRPC
              ┌────────────────────────┼──────────────────┐
              │                        │                  │
    ┌─────────▼────────┐  ┌────────────▼──────┐  ┌───────▼────────┐
    │  Video Service   │  │  Audio Service    │  │ Biometric Svc  │
    │  Port 50051      │  │  Port 50052       │  │ Port 50053     │
    │  EfficientNet-B4 │  │  MFCC + Wav2Vec2  │  │ rPPG sync      │
    │  BiLSTM + GAN    │  │  Spoof Detector   │  │ ECG validation │
    └──────────────────┘  └───────────────────┘  └────────────────┘
              │
    ┌─────────▼────────────────────────────────────────────────┐
    │               Data Layer                                  │
    │  PostgreSQL (Port 5432) │ Redis (Port 6379)               │
    └──────────────────────────────────────────────────────────┘
              │
    ┌─────────▼────────────────────────────────────────────────┐
    │       Hyperledger Fabric Blockchain                       │
    │       SHA-256 chunk logging + replay detection            │
    └──────────────────────────────────────────────────────────┘
```

**Trust Score Formula:**
```
T = 0.40 × V + 0.30 × A + 0.20 × B + 0.10 × C
  where V=Video, A=Audio, B=Biometric, C=Blockchain (0–100 each)

Status: T ≥ 75 → SAFE | 50 ≤ T < 75 → SUSPICIOUS | T < 50 → ALERT
```

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Docker | ≥ 24.x | Container runtime |
| Docker Compose | ≥ 2.x | Orchestration |
| Node.js | ≥ 20.x | Backend / Frontend build |
| Python | ≥ 3.11 | AI microservices |
| Go | ≥ 1.20 | Blockchain chaincode |
| PostgreSQL client | ≥ 15 | Schema migrations |

---

## Local Development Setup

### 1. Clone and configure environment

```bash
git clone https://github.com/your-org/medtrust-ai.git
cd medtrust-ai

# Copy environment files
cp backend/.env.example backend/.env
# Edit backend/.env with your secrets (DB, Redis, JWT, gRPC URLs)
```

### 2. Start infrastructure services

```bash
# Start PostgreSQL and Redis only
docker compose up -d postgres redis

# Verify they are healthy
docker compose ps
```

### 3. Run database schema migration

```bash
PGPASSWORD=medtrust_secret psql \
  -h localhost -U medtrust_user -d medtrust \
  -f backend/src/utils/schema.sql
```

### 4. Install and start backend

```bash
cd backend
npm install
npm run dev       # starts with nodemon on port 4000
```

### 5. Generate gRPC stubs for AI services

```bash
cd ai-services
pip install grpcio-tools
mkdir -p proto_gen

python -m grpc_tools.protoc -I./proto \
  --python_out=./proto_gen \
  --grpc_python_out=./proto_gen \
  proto/video_detection.proto \
  proto/audio_detection.proto \
  proto/biometric_engine.proto

touch proto_gen/__init__.py
```

### 6. Install AI service dependencies and start services

```bash
cd ai-services
pip install -r requirements.txt

# In separate terminals:
python video_detection/video_service.py    # port 50051
python audio_detection/audio_service.py   # port 50052
python biometric_engine/biometric_service.py  # port 50053
```

### 7. Start frontend

```bash
cd frontend
npm install
npm run dev       # starts Vite dev server on port 3000
```

Open http://localhost:3000 — login with:
- **Email:** `admin@medtrust.ai`
- **Password:** `Admin@MedTrust2024!`

---

## Docker Compose Deployment

### Full stack (production)

```bash
# Build and start all services
docker compose up --build -d

# View logs
docker compose logs -f backend
docker compose logs -f video_service

# Scale AI services (optional)
docker compose up --scale video_service=2 -d

# Stop all
docker compose down
```

### Services and ports

| Service | Port | Description |
|---------|------|-------------|
| nginx | 80, 443 | Reverse proxy (TLS termination) |
| backend | 4000 | Node.js API Gateway |
| frontend | 3000 | React dashboard |
| postgres | 5432 | Database |
| redis | 6379 | Cache / pub-sub |
| video_service | 50051 | gRPC video AI |
| audio_service | 50052 | gRPC audio AI |
| biometric_service | 50053 | gRPC biometric engine |
| prometheus | 9090 | Metrics collection |
| grafana | 3001 | Metrics dashboard |

### TLS setup (self-signed for dev)

```bash
mkdir -p devops/nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout devops/nginx/ssl/medtrust.key \
  -out devops/nginx/ssl/medtrust.crt \
  -subj "/CN=medtrust.local/O=MedTrust AI/C=US"
```

---

## Environment Variables Reference

### Backend (`backend/.env`)

```env
# Server
NODE_ENV=production
PORT=4000

# JWT
JWT_SECRET=<min-32-char-random-string>
JWT_REFRESH_SECRET=<min-32-char-random-string>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=medtrust
DB_USER=medtrust_user
DB_PASSWORD=<strong-password>
DB_SSL=false

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=<strong-password>

# AI gRPC services
VIDEO_SERVICE_URL=localhost:50051
AUDIO_SERVICE_URL=localhost:50052
BIOMETRIC_SERVICE_URL=localhost:50053

# Blockchain
BLOCKCHAIN_API_URL=http://localhost:3003
BLOCKCHAIN_CHANNEL=medtrust-channel
BLOCKCHAIN_CHAINCODE=medtrust

# Security
BCRYPT_ROUNDS=12
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100

# Monitoring
PROMETHEUS_ENABLED=true
```

### Frontend (`frontend/.env`)

```env
VITE_API_URL=http://localhost:4000/api/v1
VITE_SOCKET_URL=http://localhost:4000
```

---

## Running Tests

### Backend (Jest)

```bash
cd backend
npm test                    # all tests
npm test -- --coverage      # with coverage report
npm test -- auth.test.js    # single test file
```

### AI Services (PyTest)

```bash
cd ai-services

# All tests
pytest tests/ -v

# Specific module
pytest tests/ai_services/test_mfcc_analyzer.py -v

# With coverage
pytest tests/ --cov=. --cov-report=html -v

# Fast (skip slow model-loading tests)
pytest tests/ -m "not slow" -v
```

### Blockchain simulation tests

```bash
cd tests/blockchain
pytest test_replay_simulation.py -v
# Expected: 20+ tests passing, all replay/timestamp scenarios covered
```

### Run all test suites

```bash
# From project root
cd backend && npm test && cd ..
cd ai-services && pytest tests/ -v && cd ..
cd tests/blockchain && pytest -v && cd ..
```

---

## API Reference

### Authentication

#### `POST /api/v1/doctor/login`
```json
Request:  { "email": "doctor@hospital.com", "password": "Password@1" }
Response: { "access_token": "eyJ...", "refresh_token": "eyJ...", "doctor": { "id": "uuid", "full_name": "Dr. Smith", "role": "doctor" } }
```

#### `POST /api/v1/doctor/register` *(admin only)*
```json
Request:  { "email", "password", "full_name", "department", "license_number", "role" }
Response: { "message": "Doctor registered", "doctor_id": "uuid" }
```

#### `POST /api/v1/doctor/logout`
```
Headers: Authorization: Bearer <token>
Response: { "message": "Logged out successfully" }
```

### Analysis

#### `POST /api/v1/analyze/video`
```json
Headers: Authorization: Bearer <token>
Request: {
  "stream_id": "stream-uuid",
  "chunk_data": "<base64-encoded-video-chunk>",
  "timestamp": 1700000000000,
  "frame_rate": 30
}
Response: {
  "trust_score": 87,
  "status": "safe",
  "video_score": 92,
  "voice_score": 85,
  "biometric_score": 88,
  "blockchain_score": 100,
  "detail": { "spatial_score": 0.94, "temporal_score": 0.91, "gan_score": 0.90 }
}
```

#### `POST /api/v1/analyze/audio`
```json
Request: {
  "stream_id": "stream-uuid",
  "audio_data": "<base64-encoded-audio>",
  "timestamp": 1700000000000,
  "doctor_id": "doctor-uuid",
  "sample_rate": 16000
}
Response: { "voice_score": 88, "mfcc_score": 0.90, "spoof_score": 0.87, "speaker_verified": true }
```

#### `GET /api/v1/trustscore/live/:streamId`
```json
Response: { "trust_score": 85, "status": "safe", "video_score": 90, "voice_score": 82, ... }
```

#### `GET /api/v1/trustscore/history/:streamId?limit=60`
```json
Response: { "history": [ { "trust_score": 85, "timestamp": "...", ... }, ... ] }
```

### Doctor Management

#### `GET /api/v1/doctor/list`
```
Query: ?page=1&department=ICU&role=doctor
Response: { "doctors": [...], "total": 42, "page": 1 }
```

#### `POST /api/v1/doctor/train-voice`
```
Content-Type: multipart/form-data
Fields: doctor_id (string), audio_samples[] (files, ≥3 WAV files recommended)
Response: { "message": "Voice profile trained", "embedding_dimensions": 768 }
```

### Blockchain

#### `POST /api/v1/blockchain/validate`
```json
Request: { "stream_id": "...", "chunk_data": "<raw-data>", "chunk_type": "video" }
Response: { "valid": true, "hash": "abc123...", "recorded_at": "2024-01-01T00:00:00Z" }
```

#### `GET /api/v1/blockchain/audit/:streamId?limit=50`
```json
Response: { "logs": { "logs": [ { "chunk_hash": "...", "chunk_type": "video", "sequence": 1, ... } ] } }
```

### Admin *(admin role required)*

#### `GET /api/v1/admin/dashboard`
```json
Response: {
  "doctors": { "total": 12, "active": 10 },
  "streams": { "active": 3, "total": 45 },
  "alerts_24h": 2,
  "trust_score_24h": { "avg": 84.2, "min": 31, "max": 99 }
}
```

#### `GET /api/v1/admin/config`
#### `PUT /api/v1/admin/config`
```json
Request: {
  "video_weight": 0.40, "voice_weight": 0.30,
  "biometric_weight": 0.20, "blockchain_weight": 0.10,
  "safe_threshold": 75, "suspicious_threshold": 50
}
```

#### `GET /api/v1/admin/compliance/report?from=2024-01-01&to=2024-12-31&format=json`

---

## WebRTC Signaling Setup

The signaling server is integrated into the Node.js backend via Socket.IO.

### Client connection

```javascript
import { io } from 'socket.io-client';

const socket = io('https://medtrust.local', {
  auth: { token: '<jwt-access-token>' },
  transports: ['websocket'],
});

// Join a stream room
socket.emit('join-stream', { streamId: 'stream-uuid', role: 'viewer' });

// Subscribe to trust score updates
socket.emit('subscribe-trust', { streamId: 'stream-uuid' });

// Listen for real-time events
socket.on('trust-score-update', (data) => console.log(data));
socket.on('deepfake-alert', (alert) => console.warn('ALERT:', alert));
```

### WebRTC peer exchange events

| Event | Direction | Payload |
|-------|-----------|---------|
| `webrtc-offer` | Client → Server → Peer | `{ targetSocketId, offer, streamId }` |
| `webrtc-answer` | Client → Server → Peer | `{ targetSocketId, answer, streamId }` |
| `ice-candidate` | Client → Server → Peer | `{ targetSocketId, candidate, streamId }` |
| `peer-joined` | Server → Client | `{ socketId, role }` |
| `trust-score-update` | Server → Client | `TrustScore object` |
| `deepfake-alert` | Server → Client | `{ event_type, message, stream_id }` |

---

## Blockchain Setup

### Hyperledger Fabric network (development)

```bash
cd blockchain

# Install Fabric binaries (first time)
curl -sSL https://bit.ly/2ysbOFE | bash -s -- 2.5.0 1.5.7

# Start test network
./network.sh up createChannel -c medtrust-channel -ca

# Deploy chaincode
./network.sh deployCC \
  -ccn medtrust \
  -ccp ./chaincode/medtrust \
  -ccl go \
  -ccv 1.0 \
  -ccs 1
```

### Chaincode functions

| Function | Parameters | Description |
|----------|-----------|-------------|
| `InitLedger` | — | Initialize with genesis record |
| `LogVideoChunk` | streamId, hash, timestamp, doctorId | Record SHA-256 video hash |
| `LogAudioChunk` | streamId, hash, timestamp, doctorId | Record SHA-256 audio hash |
| `ValidateChunk` | streamId, hash, chunkType | Verify chunk integrity |
| `DetectReplay` | streamId | Scan for replay attacks |
| `ValidateTimestamp` | streamId, timestamp | Check monotonicity |
| `GetAuditHistory` | streamId, limit | Full audit trail |
| `GetStreamSummary` | streamId | Stream statistics |
| `CloseStream` | streamId | Mark stream inactive |

---

## Monitoring & Observability

### Prometheus metrics (exposed at `/metrics`)

| Metric | Type | Description |
|--------|------|-------------|
| `medtrust_http_requests_total` | Counter | Total HTTP requests by route/status |
| `medtrust_http_request_duration_seconds` | Histogram | Request latency |
| `medtrust_trust_score` | Gauge | Current trust score per stream |
| `medtrust_deepfake_alerts_total` | Counter | Total deepfake alerts fired |
| `medtrust_active_streams` | Gauge | Currently active WebRTC streams |
| `medtrust_grpc_errors_total` | Counter | gRPC call failures by service |

### Grafana

- URL: http://localhost:3001
- Default credentials: `admin` / `admin`
- Import dashboard from `devops/monitoring/grafana/`

---

## Security Hardening Checklist

- [ ] Change all default passwords in `.env` before production
- [ ] Generate strong JWT secrets (≥ 64 random bytes): `openssl rand -hex 64`
- [ ] Enable PostgreSQL SSL: set `DB_SSL=true` and provide `sslrootcert`
- [ ] Enable Redis AUTH and TLS in `redis.conf`
- [ ] Replace self-signed TLS cert with CA-signed certificate (Let's Encrypt)
- [ ] Set `BCRYPT_ROUNDS=14` in production (slower but stronger)
- [ ] Enable `HSTS` header in Nginx (already configured)
- [ ] Restrict CORS origins: update `CORS_ORIGIN` in backend `.env`
- [ ] Enable mutual TLS for gRPC services between backend and AI microservices
- [ ] Rotate JWT secrets every 90 days; invalidate all existing sessions
- [ ] Enable audit logging retention policy (HIPAA: minimum 6 years)
- [ ] Set `NODE_ENV=production` — disables stack traces in error responses
- [ ] Use Kubernetes secrets or HashiCorp Vault instead of plain `.env` files
- [ ] Enable container image scanning in CI (Trivy configured in `ci.yml`)
- [ ] Restrict `admin` role assignment to initial system administrator only

---

*MedTrust AI v1.0 — Zero-Trust Healthcare Cybersecurity Platform*
