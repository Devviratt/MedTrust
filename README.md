# MedTrust



<div align="center">

# MedTrust AI

### Zero-Trust, Deepfake-Resistant ICU Telemedicine Platform

[![Node.js](https://img.shields.io/badge/Node.js-20-green?logo=node.js)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-blue?logo=react)](https://reactjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-blue?logo=postgresql)](https://www.postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7-red?logo=redis)](https://redis.io)
[![Docker](https://img.shields.io/badge/Docker-Compose-blue?logo=docker)](https://www.docker.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

</div>

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Core Features](#2-core-features)
3. [System Architecture](#3-system-architecture)
4. [Trust Score Formula](#4-trust-score-formula)
5. [Security Model](#5-security-model)
6. [Database Schema](#6-database-schema)
7. [API Reference](#7-api-reference)
8. [WebRTC Video Call Architecture](#8-webrtc-video-call-architecture)
9. [Installation Guide](#9-installation-guide)
10. [Deployment Guide](#10-deployment-guide)
11. [Observability](#11-observability)
12. [Future Roadmap](#12-future-roadmap)
13. [License](#13-license)

---

## 1. Project Overview

### What is MedTrust AI?

MedTrust AI is an enterprise-grade, real-time telemedicine platform purpose-built for high-stakes clinical environments — ICUs, emergency wards, and remote specialist consultations. It wraps every session in a continuous, multi-signal identity verification pipeline that detects deepfakes, voice clones, replay attacks, and impersonation attempts in real time, without interrupting the clinical workflow.

### The Problem

Telemedicine adoption has accelerated dramatically. With it, a new attack surface has emerged: **AI-generated identity fraud in clinical sessions**. Synthetic face video (GAN/diffusion-model deepfakes), text-to-speech voice cloning, and replay attacks can now impersonate a licensed physician convincingly enough to deceive both patients and automated systems. In an ICU context, a compromised doctor identity is not a privacy incident — it is a direct patient safety threat.

Existing telemedicine platforms rely exclusively on credential-at-login authentication. Once a session starts, no continuous identity assurance exists. MedTrust AI closes this gap.

### The Solution

MedTrust AI implements a **zero-trust session model**: identity is not assumed at login and forgotten — it is re-verified continuously throughout every session. Six independent detection modules score the session in real time. A weighted trust engine fuses these signals into a live trust score. When the score falls below configurable thresholds, the platform escalates — from graduated warnings to full session termination — without requiring admin intervention.

### Zero-Trust Philosophy

- **Never trust, always verify** — every video frame and audio chunk is analysed independently.
- **Least-privilege RBAC** — doctors, patients, and admins operate in fully isolated permission domains.
- **Defence in depth** — deepfake detection, liveness challenges, rPPG biometrics, blockchain audit logging, and behavioural analytics operate as independent layers. No single layer is a single point of failure.
- **Immutable accountability** — every trust event is SHA-256 hash-chained into an append-only blockchain log.

---

## 2. Core Features

### Identity Verification

| Feature | Description |
|---|---|
| **Pre-Session Re-Verification** | Doctor must pass a live biometric challenge (face descriptors, voice energy, rPPG pulse, liveness prompts) before joining every session. Trust score must exceed configurable threshold. |
| **Continuous Mid-Session Verification** | Every video frame and audio chunk is analysed after the session starts. Trust score is recomputed on every frame event. |
| **Forced Re-Verification** | Admins can revoke a doctor's baseline at any time, requiring fresh enrollment before the next session. |

### Deepfake Detection Pipeline

| Module | Signals Analysed |
|---|---|
| **GAN Artifact Detection** | Shannon entropy of luminance histogram; real faces exhibit wide multi-modal distributions. GAN faces exhibit over-compressed narrow bands. |
| **Micro-Expression Continuity** | Frame-to-frame luminance std-dev delta; frozen or erratic inter-frame patterns indicate synthetic video. |
| **Head-Pose Asymmetry** | Quadrant-level luminance asymmetry; deepfake warping networks produce unnatural bilateral symmetry. |
| **Eye & Boundary Region Analysis** | Upper-third (eye) and lower-third (mouth/boundary) variance; GAN models systematically over-smooth both regions. |
| **Voice Anti-Spoofing** | Spectral flatness (geometric/arithmetic MFCC mean ratio); TTS systems produce unnaturally flat spectra. |
| **Phase Coherence Analysis** | Sign-change rate across MFCC vector; vocoder-synthesised audio produces abnormal alternation patterns. |
| **Synthetic Pitch Uniformity** | Sliding 5-frame std-dev of MFCC c0/c1 coefficients; cloned voices exhibit near-zero pitch variance. |
| **Replay Attack Detection** | High-order vs low-order MFCC energy ratio; room reverb tail from playback devices elevates high-frequency energy. |
| **Challenge-Response Voice Timing** | Per-session deterministic 3-word phrase via SHA-256; detects TTS onset latency from silence. |

### Liveness & Temporal Integrity

| Feature | Description |
|---|---|
| **Dynamic Lighting Challenge** | Tracks brightness std-dev over a 30-frame rolling window; screens emit constant backlight, real faces do not. Periodic pattern detection catches looped video. |
| **Motion Latency Analysis** | Frame-to-frame edge-variance deltas; blink detection via brightness dip + recovery pattern; absence of blinks for 15+ frames penalises liveness score. |
| **Temporal Consistency Validation** | Builds SHA-256 signature hash from 30-second histogram window; identity shift score recomputed every 10 seconds; delta > 40% triggers mid-session injection alert. |

### Biometric & Behavioural Signals

| Feature | Description |
|---|---|
| **rPPG Biometric Pulse Sync** | Green-channel ROI luminance variance from forehead region; pulse periodicity and zero-crossing rate confirm physiological liveness. |
| **Voice Profile Enrollment** | MFCC feature vector stored at enrollment; re-verified via Hamming similarity on every session. |
| **Face Descriptor Baseline** | 128-value luminance grid descriptor stored at enrollment; cosine similarity compared on every pre-session verify. |

### Platform Integrity

| Feature | Description |
|---|---|
| **Blockchain Audit Trail** | Every trust computation appends a SHA-256 hash-chained block to `blockchain_logs`. Hash mismatch triggers chain integrity alert. |
| **Deepfake Fusion Kill-Switch** | Activates only when deepfakeRiskScore < 30 AND ≥ 3 independent detection signals fail simultaneously. Session is hard-blocked; admin is notified. |
| **Safe Failure Mode** | Every detector runs inside a 3-second hard timeout. On timeout or error, original scores are returned unchanged (last-known-good principle). No crash, no 500. |
| **Admin Detection Lab** | Real-time per-stream threat event log, deepfake alert feed, trust score history, compliance reporting. |
| **Configurable AI Thresholds** | All detection thresholds (safe/suspicious/alert scores, weights, drop limits) stored in `ai_thresholds` table. Adjustable at runtime via admin API — no redeploy required. |
| **SMS Critical Alerts** | Trust-score alert events trigger SMS notification to on-call staff via SMS service integration. |

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                                 │
│                                                                     │
│   React 18 + TypeScript                                             │
│   ├── WebRTC (offer/answer/ICE, room-based signaling)              │
│   ├── WebSocket (Socket.IO — trust score stream, alerts)           │
│   ├── rPPG green-channel pulse extraction (500 ms cadence)         │
│   ├── MFCC voice feature extraction (Web Audio API)                │
│   └── Pre-session biometric capture (face descriptors, liveness)   │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTPS / WSS
┌──────────────────────────▼──────────────────────────────────────────┐
│                     API GATEWAY (Node.js / Express)                 │
│                          Port 4000                                  │
│                                                                     │
│   ├── RBAC Middleware (JWT, role guards, permission claims)        │
│   ├── Rate Limiters (auth / analysis / admin tiers)                │
│   ├── REST API (/api/v1/*)                                         │
│   ├── Socket.IO Signaling Server (WebRTC + trust broadcast)        │
│   └── gRPC Clients (video_service, audio_service, biometric)       │
└───────┬────────────────────────────┬────────────────────────────────┘
        │                            │
        ▼                            ▼
┌───────────────┐          ┌────────────────────┐
│  PostgreSQL   │          │   Redis (Cache)     │
│  Port 5432    │          │   Port 6379         │
│               │          │                     │
│  Core tables  │          │  Trust score cache  │
│  Audit logs   │          │  Biometric windows  │
│  Blockchain   │          │  Session state      │
│  Trust logs   │          │  Threshold cache    │
└───────────────┘          └────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    AI MICROSERVICES (gRPC)                          │
│                                                                     │
│   video_service    :50051  — frame integrity, edge variance, Sobel │
│   audio_service    :50052  — MFCC extraction, voice scoring        │
│   biometric_service:50053  — rPPG heart rate, pulse confidence     │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  DEEPFAKE DETECTION LAYER (Node.js)                 │
│                                                                     │
│   deepfakeAnalyzer.js  — GAN artifact, micro-expression, head-pose │
│   voiceAntiSpoof.js    — spectral flatness, phase coherence, replay│
│   livenessHardener.js  — lighting, motion latency, temporal window │
│   deepfakeFusion.js    — weighted fusion, kill-switch, safe failure │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     TRUST ENGINE (trustEngineV2.js)                 │
│                                                                     │
│   6-module weighted computation                                     │
│   Blockchain hash-chain append per frame                           │
│   Redis cache write + PostgreSQL trust_logs persist                │
│   Alert engine → audit_events + admin Socket.IO broadcast         │
│   SMS alert on critical threshold breach                           │
└─────────────────────────────────────────────────────────────────────┘
```

### Frontend Stack

| Component | Technology |
|---|---|
| Framework | React 18 + TypeScript + Vite |
| Video Calls | WebRTC (RTCPeerConnection, ICE, STUN) |
| Real-Time | Socket.IO client |
| Biometrics | Web Audio API (MFCC), Canvas API (rPPG, face descriptors) |
| State | Zustand (auth store, stream store) |
| Routing | React Router v6 |
| UI | Custom design system (CSS variables, glass-morphism) |

### Backend Stack

| Component | Technology |
|---|---|
| Runtime | Node.js 20 |
| Framework | Express.js |
| Auth | JWT (access + refresh tokens), bcrypt |
| WebSocket | Socket.IO |
| Database | PostgreSQL 15 (pg driver, connection pool) |
| Cache | Redis 7 (ioredis, LRU eviction) |
| AI Transport | gRPC (protobuf over HTTP/2) |
| Validation | express-validator, Joi schemas |
| Rate Limiting | express-rate-limit (per-role tiers) |
| Monitoring | Prometheus metrics endpoint |

### AI Microservices

| Service | Port | Responsibility |
|---|---|---|
| `video_service` | 50051 | Frame integrity scoring — brightness, Sobel edge variance, anomaly detection |
| `audio_service` | 50052 | MFCC feature extraction, spectral flatness, voice score |
| `biometric_service` | 50053 | rPPG heart-rate extraction, pulse confidence, biometric score |

### Deepfake Detection Services

| Service | Method |
|---|---|
| `deepfakeAnalyzer.js` | Pure Node.js; processes raw JPEG luma buffer; scores GAN artifacts, micro-expression drift, head-pose asymmetry, eye/boundary smoothing |
| `voiceAntiSpoof.js` | Processes MFCC feature array; spectral flatness, phase coherence, pitch uniformity, replay energy ratio, challenge-response timing |
| `livenessHardener.js` | Rolling 30-frame brightness + edge variance window; blink detection; SHA-256 histogram signature for temporal consistency |
| `deepfakeFusion.js` | Weighted fusion (face 35%, voice 30%, liveness 20%, temporal 15%); graduated penalty; kill-switch; 3s hard timeout |

### Blockchain Layer

Every trust computation inserts a new row in `blockchain_logs` with:

```
block_hash = SHA-256( prev_hash : timestamp : trust_score )
```

Each block references its predecessor's hash. Any tampering with historical logs produces a hash mismatch on the next computation cycle, which triggers a `CHAIN_TAMPER` audit event and degrades the `blockchain_score` component of the trust formula.

---

## 4. Trust Score Formula

### Pre-Session Verification (verifyPreSession)

Used at session gate — doctor must pass before joining:

```
final_trust = 0.30 × face_score
            + 0.20 × voice_score
            + 0.20 × biometric_score
            + 0.15 × liveness_score
            + 0.15 × motion_score
```

`face_score` and `voice_score` are first adjusted by the deepfake fusion pipeline before entering this formula.

### Continuous Session Trust (trustEngineV2)

Recomputed on every analysed frame. Weights are loaded from the `ai_thresholds` table at runtime (cached 60 seconds in Redis):

```
trust_score = W_video      × video_score
            + W_voice      × voice_score
            + W_biometric  × biometric_score
            + W_blockchain × blockchain_score
            + W_behavioral × behavioral_score
            + W_env        × env_score
```

**Default weights** (overridable by admin without redeploy):

| Signal | Default Weight |
|---|---|
| Video Integrity | 0.40 |
| Voice Authenticity | 0.30 |
| Biometric Sync | 0.20 |
| Blockchain Integrity | 0.10 |
| Behavioral Dynamics | computed from remainder |
| Environmental Context | computed from remainder |

### Status Thresholds

| Range | Status | Action |
|---|---|---|
| ≥ 75 | `safe` | Session continues normally |
| 50 – 74 | `suspicious` | Warning broadcast to doctor + admin |
| < 50 | `alert` | DEEPFAKE_ALERT inserted; admin notified; SMS triggered |

### Alert Trigger Conditions

An alert fires when **any** of the following are true:

- `trust_score < alert_score` (default: 50)
- `video_score` drops > 30 points in a single cycle (`video_drop_threshold`)
- `biometric_score < 40` (`biometric_variance_limit`)
- `voice_score < 40` (`voice_flatness_limit`)

All thresholds are configurable via `PUT /api/v1/admin/thresholds`.

### Deepfake Fusion Risk Score (Internal)

Computed before pre-session trust formula, never exposed externally:

```
deepfakeRiskScore = 0.35 × deepfakeFaceScore
                  + 0.30 × deepfakeVoiceScore
                  + 0.20 × livenessScore
                  + 0.15 × temporalConsistencyScore
```

| deepfakeRiskScore | Risk Level | Effect |
|---|---|---|
| ≥ 65 | LOW | No penalty applied |
| 50 – 64 | MEDIUM | Light penalty (≤ 10 pts) on face/voice |
| 30 – 49 | HIGH | Graduated penalty (up to 40 pts face, 35 pts voice); admin alert |
| < 30 + ≥ 3 failed signals | CRITICAL | Kill-switch; session blocked |

---

## 5. Security Model

### RBAC Permission System

Three roles with isolated permission scopes:

| Role | Permissions |
|---|---|
| `admin` | Full platform access; user management; threshold configuration; compliance reports; force re-verification |
| `doctor` | `stream:read`, `stream:write`, `analysis:read`, `trust:read`, `blockchain:read`; own session management |
| `patient` | Session request; own session history; trust score view; assigned doctor info |

### Authentication

- **JWT access tokens** (24h expiry, HS256) + **refresh tokens** (7d) stored server-side
- `authenticate` middleware validates token signature and expiry on every protected route
- `requireRole(...)` enforces role checks at the route level
- `authorize(permission)` enforces fine-grained permission claims
- All auth attempts rate-limited (`authLimiter`) — default 200 req / 15 min window

### Doctor Biometric Enrollment

Enrollment is a multi-step, admin-gated process:

1. Doctor submits face embedding (128-value descriptor from 20 frames), voice embedding (MFCC features), baseline BPM, liveness pass flag, and quality score
2. SHA-256 hashes of both embeddings stored in `doctor_biometrics` and `impersonation_baselines`
3. Enrollment status set to `pending_admin_approval` — doctor cannot start sessions until approved
4. Admin approves; `verified_status` set to `verified` in `doctor_profiles`

### Pre-Session Re-Verification Gate

Before every session, the doctor undergoes a live scan:

1. Live camera + microphone capture
2. Liveness challenge (blink detection, head-turn motion prompts)
3. Face descriptor cosine similarity vs enrolled baseline
4. Voice energy + rPPG pulse measurement
5. All scores submitted to `POST /api/v1/sessions/:streamId/verify`
6. **Deepfake fusion pipeline runs** on submitted frame data (3s timeout, safe fallback)
7. Adjusted scores feed the pre-session trust formula
8. `final_trust < 70` → session blocked; `VERIFICATION_FAILED` audit event; doctor risk score updated

### Deepfake Risk Fusion

The fusion pipeline (`deepfakeFusion.js`) runs entirely server-side:

- Three detectors execute in `Promise.all` (parallel, non-blocking) — each with 2s individual timeout
- Entire pipeline wrapped in 3s outer timeout via `Promise.race`
- On any failure: original scores returned unchanged — **no session crash, no false block**
- Kill-switch requires `deepfakeRiskScore < 30` AND `failedSignals ≥ 3` simultaneously — prevents false positives from single detector failure

### Blockchain Integrity Validation

- On every `computeTrust` call, `blockchain_score` is set to 100 if the stored previous hash matches the computed one, or 50 if a mismatch is detected
- Hash mismatch emits `BLOCKCHAIN` thread-log event and degrades the overall trust score
- Full audit chain queryable via `GET /api/v1/blockchain/audit/:streamId`

---

## 6. Database Schema

All tables reside in the `medtrust` PostgreSQL database. Schema is auto-applied via `schema.sql` on first container start.

### Core Tables

| Table | Purpose |
|---|---|
| `users` | Unified user registry for doctors, patients, and admins. Stores role, RBAC flags, enrollment status, biometric_enrolled, suspicious_session_count, risk_score |
| `doctor_profiles` | Extended doctor attributes: license_number, hospital_name, specialization, years_experience, verified_status |
| `patient_profiles` | Patient attributes: health_id, condition_notes, assigned_doctor_id |
| `doctor_biometrics` | Enrolled face_embedding (JSON float array), voice_embedding, SHA-256 hashes, baseline_bpm, enrollment_location, quality_score |
| `impersonation_baselines` | Lightweight face_hash / voice_hash for real-time Hamming similarity comparison during re-verification |

### Session & Trust Tables

| Table | Purpose |
|---|---|
| `streams` | Active and historical sessions: doctor_id, patient_id, status (pending / doctor_verifying / active / blocked / ended), icu_room, started_at, ended_at |
| `trust_logs` | Append-only trust score history per stream: video_score, voice_score, biometric_score, blockchain_score, status, raw_data (JSONB) |
| `audit_events` | Immutable security event log: event_type (DEEPFAKE_ALERT, VERIFICATION_FAILED, DEEPFAKE_DETECTED, CHAIN_TAMPER, BIOMETRIC_ENROLLED, etc.), severity, details (JSONB) |
| `blockchain_logs` | Hash-chained audit blocks: chunk_hash, prev_hash, block_number, tx_id, sync_status |
| `admin_logs` | Admin action log: admin_id, target_user_id, action, metadata |

### Configuration Tables

| Table | Purpose |
|---|---|
| `ai_thresholds` | Runtime-configurable AI detection thresholds and trust formula weights. Cached 60s in Redis. |
| `admin_configurations` | Platform-wide settings: trust weights, alert recipients, feature flags |
| `roles` | RBAC role definitions |
| `permissions` | Permission claim definitions |
| `role_permissions` | Role-to-permission mapping |
| `user_roles` | User-to-role assignment |

---

## 7. API Reference

All routes are prefixed with `/api/v1`. All protected routes require `Authorization: Bearer <token>`.

### Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/login` | Public | Login with email + password; returns JWT access + refresh tokens |
| `POST` | `/auth/logout` | Required | Invalidate current token |
| `POST` | `/auth/register-self` | Public | Patient self-registration |
| `POST` | `/auth/register` | Admin | Admin-creates a user (any role) |
| `GET` | `/auth/me` | Required | Fetch current user profile and permissions |

### Doctor Management

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/doctor/login` | Public | Legacy doctor login |
| `POST` | `/doctor/register` | Admin | Admin-registers a new doctor |
| `GET` | `/doctor/profile/:id` | Doctor/Admin | Fetch doctor profile |
| `POST` | `/doctor/enroll-biometric` | Doctor | Submit face + voice enrollment data |
| `GET` | `/doctor/enrollment-status` | Doctor | Check own biometric enrollment state |
| `POST` | `/doctor/enroll/:doctorId` | Admin | Admin-triggers biometric enrollment |
| `POST` | `/doctor/verify/:doctorId` | Doctor/Admin | Run biometric identity verification |
| `GET` | `/doctor/biometric-status/:doctorId` | Doctor/Admin | Fetch biometric enrollment status |
| `POST` | `/doctor/train-voice` | Doctor | Upload audio samples for voice profile training |

### Sessions

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/streams/active` | Required | Fetch currently active session for the caller |
| `POST` | `/streams/start` | Doctor | Start a new session stream |
| `POST` | `/streams/end/:streamId` | Doctor | End a stream |
| `GET` | `/streams/history` | Doctor | Paginated session history |
| `GET` | `/streams/:streamId` | Required | Fetch session detail |
| `POST` | `/sessions/request/:doctorId` | Patient | Patient requests session with a doctor |
| `PUT` | `/sessions/:streamId/respond` | Doctor | Doctor accepts or rejects session request |
| `POST` | `/sessions/:streamId/verify` | Doctor | Pre-session identity re-verification gate |
| `GET` | `/sessions/pending-requests` | Doctor | List pending session requests |
| `GET` | `/sessions/active` | Doctor | Get own active session |
| `GET` | `/sessions/my` | Patient | Get own current session |
| `GET` | `/sessions/verified-doctors` | Patient | List verified doctors available |
| `GET` | `/sessions/:streamId/trust` | Required | Fetch latest trust score for a session |
| `GET` | `/sessions/:streamId/detail` | Doctor | Full session detail including patient info |
| `DELETE` | `/sessions/:streamId` | Doctor | Cancel / end session |

### Trust & Analysis

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/trustscore/live/:streamId` | Doctor/Admin | Live trust score for a stream (Redis-cached) |
| `GET` | `/trustscore/history/:streamId` | Doctor/Admin | Full trust score history |
| `POST` | `/analyze/video` | Doctor | Submit video chunk for analysis |
| `POST` | `/analyze/audio` | Doctor | Submit audio chunk for analysis |
| `POST` | `/analyze/frame/:streamId` | Doctor | Submit raw JPEG frame for frame-level analysis |

### Blockchain

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/blockchain/log` | Doctor | Append a chunk to the blockchain log |
| `POST` | `/blockchain/validate` | Doctor | Validate a chunk hash against the chain |
| `GET` | `/blockchain/audit/:streamId` | Doctor/Admin | Retrieve full audit chain for a stream |
| `GET` | `/blockchain/audit` | Admin | All audit events across all streams |

### Admin

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/admin/dashboard` | Admin | Platform summary statistics |
| `GET` | `/admin/stats` | Admin | Real-time platform metrics (doctors, sessions, threats, deepfakes) |
| `GET` | `/admin/threat-activity` | Admin | Hourly threat event breakdown (last 24 hours) |
| `GET` | `/admin/recent-verifications` | Admin | Last 10 identity verification events |
| `GET` | `/admin/config` | Admin | Fetch platform configuration |
| `PUT` | `/admin/config` | Admin | Update platform configuration |
| `GET` | `/admin/thresholds` | Admin | Fetch all AI detection thresholds |
| `PUT` | `/admin/thresholds` | Admin | Update AI detection thresholds at runtime |
| `GET` | `/admin/compliance/report` | Admin | Generate compliance audit report |
| `GET` | `/admin/users/grouped` | Admin | All users grouped by role with full profile data |
| `PATCH` | `/admin/users/:userId/status` | Admin | Activate, deactivate, or suspend a user |
| `POST` | `/admin/users/:userId/block` | Admin | Block or unblock a user |
| `POST` | `/admin/users/:userId/force-reverify` | Admin | Revoke baseline, require fresh enrollment |
| `PUT` | `/admin/users/:userId/approve-enrollment` | Admin | Approve a pending biometric enrollment |

### Patient

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/patient/profile` | Patient | Fetch own patient profile |
| `GET` | `/patient/doctor` | Patient | Fetch assigned doctor details and trust status |
| `GET` | `/patient/sessions` | Patient | Paginated session history |
| `GET` | `/patient/alerts` | Patient | Security alerts for own sessions |
| `GET` | `/patient/session/:sessionId/trust` | Patient | Trust score for a specific session |
| `GET` | `/patient/session/:sessionId/report` | Patient | Full session security report |

### Health

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | Public | Service health check — returns status, timestamp |

---

## 8. WebRTC Video Call Architecture

### Signaling Flow

MedTrust uses a **room-based Socket.IO signaling server** co-located with the API gateway (port 4000). The `roomId` equals the session's `streamId`.

```
Doctor Browser                 Signaling Server               Patient Browser
      │                               │                               │
      │── join-stream {streamId} ────▶│                               │
      │◀── room-members {members} ────│                               │
      │                               │◀── join-stream {streamId} ───│
      │                               │─── peer-joined {socketId} ──▶│
      │◀── peer-joined {socketId} ────│                               │
      │                               │                               │
      │ [Doctor creates offer]        │                               │
      │── webrtc-offer {targetId} ───▶│──── webrtc-offer ───────────▶│
      │                               │                               │ [Patient creates answer]
      │◀── webrtc-answer ─────────────│◀─── webrtc-answer ───────────│
      │                               │                               │
      │── ice-candidate {targetId} ──▶│──── ice-candidate ──────────▶│
      │◀── ice-candidate ─────────────│◀─── ice-candidate ───────────│
      │                               │                               │
      │◄══════════════ P2P WebRTC Connection Established ════════════▶│
```

### Key Design Decisions

**Offer initiation:** The peer who joins a room that already has members sends the offer. The `room-members` event (emitted only to the joiner) contains all existing member socket IDs. The joiner calls `createOffer` immediately for each. The `peer-joined` event (emitted to existing members) signals a new peer has arrived — existing members note the socket ID for ICE candidate routing.

**ICE candidate routing:** All `ice-candidate` events include `targetSocketId`. The server routes them via `socket.to(targetSocketId)`, ensuring candidates never fan out to unintended peers.

**Connection state monitoring:**
- `connected` → clears retry timer
- `failed` → logs error, re-emits `join-stream` after 2s (retry signaling once)
- `disconnected` → 10s grace period before PC teardown (handles transient network interruptions)

**Peer disconnect:** `peer-left` event resets the remote video element, closes the PC, and shows "Peer disconnected" — no blank screen.

### ICE / STUN Configuration

```javascript
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
});
```

> **Production note:** For environments behind symmetric NAT (corporate networks, hospital infrastructure), a TURN server is required. Add TURN credentials to the `iceServers` array. HTTPS is mandatory for `getUserMedia` access in all browsers.

### Video Element Configuration

Local (self-preview): `autoplay`, `muted`, `playsInline`, mirrored via `scaleX(-1)`  
Remote (peer stream): `autoplay`, `playsInline`, full-panel display

### Trust Engine Independence

The WebRTC peer connection operates independently of the trust scoring pipeline. Trust analysis consumes the media stream via separate Canvas/AudioContext extraction — it does not intercept or modify the WebRTC data path. A trust alert never drops the WebRTC connection directly; it updates the trust score, which triggers session state changes through the backend.

---

## 9. Installation Guide

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 20.x |
| PostgreSQL | 15.x |
| Redis | 7.x |
| Docker + Docker Compose | Latest stable |

### Quick Start (Docker — Recommended)

```bash
git clone https://github.com/your-org/medtrust-ai.git
cd medtrust-ai

# Copy and configure environment
cp .env.example .env
# Edit .env — set JWT_SECRET, POSTGRES_PASSWORD, REDIS_PASSWORD

# Start all services (PostgreSQL, Redis, Backend, AI microservices, Frontend)
docker-compose up -d

# View logs
docker-compose logs -f backend
```

The schema is automatically applied from `backend/src/utils/schema.sql` on first PostgreSQL container start.

### Manual Backend Setup

```bash
cd backend
npm install

# Configure environment
cp .env.example .env
# Edit .env with your local database and Redis credentials

# Start development server
npm run dev
```

### Manual Frontend Setup

```bash
cd frontend
npm install

# Configure API URL
cp .env.example .env
# VITE_API_URL=http://localhost:4000/api/v1
# VITE_SOCKET_URL=http://localhost:4000

npm run dev
# Vite dev server starts on http://localhost:5173
```

### Environment Variables

#### Backend (`.env`)

```env
# Server
NODE_ENV=development
PORT=4000

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=medtrust
DB_USER=medtrust_user
DB_PASSWORD=your_postgres_password
DB_SSL=false

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
REDIS_DB=0
REDIS_TTL=3600

# JWT
JWT_SECRET=your_minimum_32_character_jwt_secret_here
JWT_REFRESH_SECRET=your_minimum_32_character_refresh_secret
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d

# AI Microservices (gRPC)
AI_VIDEO_SERVICE_URL=localhost:50051
AI_AUDIO_SERVICE_URL=localhost:50052
AI_BIOMETRIC_SERVICE_URL=localhost:50053

# CORS
CORS_ORIGIN=http://localhost:5173

# Security
BCRYPT_ROUNDS=12
MAX_FILE_SIZE=52428800
```

#### Frontend (`.env`)

```env
VITE_API_URL=http://localhost:4000/api/v1
VITE_SOCKET_URL=http://localhost:4000
```

---

## 10. Deployment Guide

### Docker Compose (Full Stack)

```bash
# Production build
docker-compose -f docker-compose.yml up -d --build

# Services started:
#   medtrust_postgres       :5432
#   medtrust_redis          :6379
#   medtrust_backend        :4000
#   medtrust_video_service  :50051
#   medtrust_audio_service  :50052
#   medtrust_biometric_service :50053
#   medtrust_frontend       :3000
#   medtrust_prometheus     :9090
#   medtrust_grafana        :3001
```

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Set strong `JWT_SECRET` (≥ 32 characters, cryptographically random)
- [ ] Set strong `POSTGRES_PASSWORD` and `REDIS_PASSWORD`
- [ ] Configure HTTPS — `getUserMedia` requires a secure origin in all production browsers
- [ ] Add TURN server credentials to `iceServers` config for NAT traversal in hospital networks
- [ ] Set `CORS_ORIGIN` to your actual frontend domain
- [ ] Configure SMS service credentials for critical alert delivery
- [ ] Set `DB_SSL=true` for production PostgreSQL connections
- [ ] Review and tighten `RATE_LIMIT_MAX` for your expected traffic

### Reverse Proxy (Nginx)

Nginx configuration is scaffolded in `nginx/`. Key requirements:

```nginx
# WebSocket upgrade required for Socket.IO
location /socket.io/ {
    proxy_pass http://backend:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

# API proxy
location /api/ {
    proxy_pass http://backend:4000;
}
```

### TURN Server

For production deployments on restricted networks (hospital VPNs, corporate NAT):

```javascript
// Add to RTCPeerConnection iceServers
{ urls: 'turn:your-turn-server.example.com:3478',
  username: 'user',
  credential: 'password' }
```

Self-hosted TURN servers: [coturn](https://github.com/coturn/coturn).

---

## 11. Observability

MedTrust ships with a full Prometheus + Grafana monitoring stack.

| Service | URL | Default Credentials |
|---|---|---|
| Backend health | `http://localhost:4000/api/v1/health` | — |
| Prometheus | `http://localhost:9090` | — |
| Grafana | `http://localhost:3001` | admin / (set via `GRAFANA_PASSWORD`) |

Prometheus scrape config is at `devops/monitoring/prometheus.yml`. Retention: 30 days.

Key metrics exposed by the backend:
- HTTP request duration and status code distribution
- Active WebSocket connections
- Trust score computation latency
- Alert event counts by type and severity

---

## 12. Future Roadmap

| Milestone | Description |
|---|---|
| **Adversarial Robustness** | Train deepfake detectors against adversarial examples and GAN-specific augmentation pipelines. Add gradient-masked face patch detection. |
| **GPU-Accelerated Inference** | Port deepfake and rPPG detection to ONNX Runtime with CUDA/TensorRT backend for sub-100ms per-frame inference. |
| **Multi-Factor Biometric Fusion** | Add keystroke dynamics, mouse movement entropy, and scroll pattern analysis as additional behavioral signals in the trust formula. |
| **Explainable AI Insights** | Per-signal confidence intervals and natural-language trust explanations surfaced in the admin dashboard (e.g., "Voice flatness spike at 14:32:11 suggests TTS injection attempt"). |
| **Global Threat Heatmap** | Aggregate anonymised deepfake attempt geodata into a real-time world heatmap for platform-level threat intelligence. |
| **FHIR / HL7 Integration** | Emit verified session events as FHIR AuditEvent resources for integration with hospital EHR systems. |
| **Mobile SDKs** | React Native client with native camera/microphone capture for iOS and Android telemedicine apps. |
| **Federated Learning** | Train voice and face models on anonymised inter-hospital data without centralising raw patient data. |
| **Hardware Security Keys** | FIDO2 / WebAuthn as a second factor for biometric enrollment and admin actions. |
| **Kubernetes Helm Chart** | Production-grade Helm chart with horizontal pod autoscaling for AI microservices. |

---

## 13. License

```
MIT License

Copyright (c) 2026 MedTrust AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

<div align="center">

**MedTrust AI** — Built for clinical environments where identity is not optional.

</div>
