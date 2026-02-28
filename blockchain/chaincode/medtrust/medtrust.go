// MedTrust AI - Hyperledger Fabric Chaincode
// Smart Contract for ICU stream integrity logging and replay attack detection

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// MedTrustContract implements the chaincode smart contract
type MedTrustContract struct {
	contractapi.Contract
}

// ChunkRecord represents a logged media chunk on the ledger
type ChunkRecord struct {
	StreamID   string `json:"stream_id"`
	ChunkHash  string `json:"chunk_hash"`
	ChunkType  string `json:"chunk_type"`
	Timestamp  int64  `json:"timestamp"`
	DoctorID   string `json:"doctor_id"`
	TxID       string `json:"tx_id"`
	RecordedAt string `json:"recorded_at"`
	Sequence   int64  `json:"sequence"`
}

// StreamState tracks per-stream metadata for replay detection
type StreamState struct {
	StreamID        string   `json:"stream_id"`
	DoctorID        string   `json:"doctor_id"`
	StartedAt       string   `json:"started_at"`
	LastTimestamp   int64    `json:"last_timestamp"`
	ChunkCount      int64    `json:"chunk_count"`
	VideoChunkCount int64    `json:"video_chunk_count"`
	AudioChunkCount int64    `json:"audio_chunk_count"`
	SeenHashes      []string `json:"seen_hashes"`
	ReplayAlerts    int      `json:"replay_alerts"`
	Active          bool     `json:"active"`
}

// AuditRecord represents a security event on the ledger
type AuditRecord struct {
	RecordID   string `json:"record_id"`
	StreamID   string `json:"stream_id"`
	EventType  string `json:"event_type"`
	Severity   string `json:"severity"`
	Details    string `json:"details"`
	RecordedAt string `json:"recorded_at"`
}

// ValidationResult returned by ValidateChunk
type ValidationResult struct {
	Valid       bool   `json:"valid"`
	Hash        string `json:"hash"`
	Timestamp   int64  `json:"timestamp"`
	BlockNumber string `json:"block_number"`
	RecordedAt  string `json:"recorded_at"`
}

// ReplayResult returned by DetectReplay
type ReplayResult struct {
	ReplayDetected bool   `json:"replay_detected"`
	StreamID       string `json:"stream_id"`
	DuplicateHash  string `json:"duplicate_hash"`
	OriginalTime   int64  `json:"original_time"`
	ReplayTime     int64  `json:"replay_time"`
	Details        string `json:"details"`
}

// InitLedger initialises the ledger with a genesis record
func (c *MedTrustContract) InitLedger(ctx contractapi.TransactionContextInterface) error {
	genesis := AuditRecord{
		RecordID:   "genesis",
		StreamID:   "system",
		EventType:  "LEDGER_INIT",
		Severity:   "info",
		Details:    "MedTrust AI blockchain initialized",
		RecordedAt: time.Now().UTC().Format(time.RFC3339),
	}
	genesisJSON, err := json.Marshal(genesis)
	if err != nil {
		return fmt.Errorf("failed to marshal genesis: %v", err)
	}
	return ctx.GetStub().PutState("audit:genesis", genesisJSON)
}

// LogVideoChunk records the SHA-256 hash of a 2-second video chunk
func (c *MedTrustContract) LogVideoChunk(
	ctx contractapi.TransactionContextInterface,
	streamID string,
	chunkHash string,
	timestampStr string,
	doctorID string,
) error {
	return c.logChunk(ctx, streamID, chunkHash, "video", timestampStr, doctorID)
}

// LogAudioChunk records the SHA-256 hash of an audio chunk
func (c *MedTrustContract) LogAudioChunk(
	ctx contractapi.TransactionContextInterface,
	streamID string,
	chunkHash string,
	timestampStr string,
	doctorID string,
) error {
	return c.logChunk(ctx, streamID, chunkHash, "audio", timestampStr, doctorID)
}

// logChunk is the internal handler for both video and audio chunk logging
func (c *MedTrustContract) logChunk(
	ctx contractapi.TransactionContextInterface,
	streamID, chunkHash, chunkType, timestampStr, doctorID string,
) error {
	if streamID == "" || chunkHash == "" || chunkType == "" {
		return fmt.Errorf("streamID, chunkHash, and chunkType are required")
	}

	timestamp, err := strconv.ParseInt(timestampStr, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid timestamp: %v", err)
	}

	// Validate hash format (64 hex chars = SHA-256)
	if len(chunkHash) != 64 {
		return fmt.Errorf("invalid chunk hash length: expected 64, got %d", len(chunkHash))
	}

	// Load or create stream state
	state, err := c.getOrCreateStreamState(ctx, streamID, doctorID)
	if err != nil {
		return fmt.Errorf("failed to get stream state: %v", err)
	}

	// Replay detection: check if this hash has been seen before
	if c.isReplay(state.SeenHashes, chunkHash) {
		state.ReplayAlerts++
		// Log replay alert
		_ = c.logAuditEvent(ctx, streamID, "REPLAY_ATTACK_DETECTED", "critical",
			fmt.Sprintf("Duplicate chunk hash detected: %s at timestamp %d (previous recording)", chunkHash, timestamp))
		// Still log the chunk but mark it
		chunkHash = "REPLAY:" + chunkHash
	}

	// Timestamp monotonicity check
	if timestamp < state.LastTimestamp {
		_ = c.logAuditEvent(ctx, streamID, "TIMESTAMP_VIOLATION", "warning",
			fmt.Sprintf("Non-monotonic timestamp: current=%d previous=%d", timestamp, state.LastTimestamp))
	}

	// Build chunk record
	txID := ctx.GetStub().GetTxID()
	sequence := state.ChunkCount + 1
	record := ChunkRecord{
		StreamID:   streamID,
		ChunkHash:  chunkHash,
		ChunkType:  chunkType,
		Timestamp:  timestamp,
		DoctorID:   doctorID,
		TxID:       txID,
		RecordedAt: time.Now().UTC().Format(time.RFC3339),
		Sequence:   sequence,
	}

	recordJSON, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("failed to marshal chunk record: %v", err)
	}

	// Store chunk: key = "chunk:{streamID}:{sequence}"
	chunkKey := fmt.Sprintf("chunk:%s:%d", streamID, sequence)
	if err := ctx.GetStub().PutState(chunkKey, recordJSON); err != nil {
		return fmt.Errorf("failed to store chunk record: %v", err)
	}

	// Also store by hash for O(1) validation lookup
	hashKey := fmt.Sprintf("hash:%s:%s", streamID, chunkHash)
	if err := ctx.GetStub().PutState(hashKey, recordJSON); err != nil {
		return fmt.Errorf("failed to store hash index: %v", err)
	}

	// Update stream state
	state.ChunkCount = sequence
	state.LastTimestamp = timestamp
	if chunkType == "video" {
		state.VideoChunkCount++
	} else {
		state.AudioChunkCount++
	}
	// Keep last 200 hashes for replay window
	cleanHash := strings.TrimPrefix(chunkHash, "REPLAY:")
	state.SeenHashes = append(state.SeenHashes, cleanHash)
	if len(state.SeenHashes) > 200 {
		state.SeenHashes = state.SeenHashes[len(state.SeenHashes)-200:]
	}

	if err := c.saveStreamState(ctx, state); err != nil {
		return fmt.Errorf("failed to update stream state: %v", err)
	}

	// Emit event for off-chain indexers
	eventPayload, _ := json.Marshal(map[string]interface{}{
		"stream_id":   streamID,
		"chunk_hash":  chunkHash,
		"chunk_type":  chunkType,
		"timestamp":   timestamp,
		"sequence":    sequence,
	})
	_ = ctx.GetStub().SetEvent("ChunkLogged", eventPayload)

	return nil
}

// ValidateChunk verifies that a chunk hash exists on the ledger for a given stream
func (c *MedTrustContract) ValidateChunk(
	ctx contractapi.TransactionContextInterface,
	streamID string,
	chunkHash string,
	chunkType string,
) (*ValidationResult, error) {
	hashKey := fmt.Sprintf("hash:%s:%s", streamID, chunkHash)
	data, err := ctx.GetStub().GetState(hashKey)
	if err != nil {
		return nil, fmt.Errorf("ledger read error: %v", err)
	}

	if data == nil {
		return &ValidationResult{Valid: false, Hash: chunkHash}, nil
	}

	var record ChunkRecord
	if err := json.Unmarshal(data, &record); err != nil {
		return nil, fmt.Errorf("failed to parse chunk record: %v", err)
	}

	// Verify type matches
	if chunkType != "" && record.ChunkType != chunkType {
		return &ValidationResult{
			Valid: false,
			Hash:  chunkHash,
		}, nil
	}

	return &ValidationResult{
		Valid:       true,
		Hash:        chunkHash,
		Timestamp:   record.Timestamp,
		BlockNumber: record.TxID,
		RecordedAt:  record.RecordedAt,
	}, nil
}

// DetectReplay checks the stream's chunk history for replay attack patterns
func (c *MedTrustContract) DetectReplay(
	ctx contractapi.TransactionContextInterface,
	streamID string,
) (*ReplayResult, error) {
	stateKey := fmt.Sprintf("stream:%s", streamID)
	data, err := ctx.GetStub().GetState(stateKey)
	if err != nil {
		return nil, fmt.Errorf("ledger read error: %v", err)
	}
	if data == nil {
		return &ReplayResult{ReplayDetected: false, StreamID: streamID, Details: "Stream not found"}, nil
	}

	var state StreamState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("failed to parse stream state: %v", err)
	}

	if state.ReplayAlerts > 0 {
		return &ReplayResult{
			ReplayDetected: true,
			StreamID:       streamID,
			Details:        fmt.Sprintf("Detected %d replay attempt(s) in this stream", state.ReplayAlerts),
		}, nil
	}

	// Additional check: look for duplicate hashes in recent window
	seen := make(map[string]bool)
	for _, h := range state.SeenHashes {
		if seen[h] {
			return &ReplayResult{
				ReplayDetected: true,
				StreamID:       streamID,
				DuplicateHash:  h,
				Details:        "Duplicate chunk hash detected in recent window",
			}, nil
		}
		seen[h] = true
	}

	return &ReplayResult{
		ReplayDetected: false,
		StreamID:       streamID,
		Details:        fmt.Sprintf("No replay detected. Total chunks: %d", state.ChunkCount),
	}, nil
}

// ValidateTimestamp checks that a given timestamp is consistent with stream history
func (c *MedTrustContract) ValidateTimestamp(
	ctx contractapi.TransactionContextInterface,
	streamID string,
	timestampStr string,
) (bool, error) {
	timestamp, err := strconv.ParseInt(timestampStr, 10, 64)
	if err != nil {
		return false, fmt.Errorf("invalid timestamp: %v", err)
	}

	stateKey := fmt.Sprintf("stream:%s", streamID)
	data, err := ctx.GetStub().GetState(stateKey)
	if err != nil {
		return false, fmt.Errorf("ledger read error: %v", err)
	}
	if data == nil {
		return true, nil // First chunk, accept any timestamp
	}

	var state StreamState
	if err := json.Unmarshal(data, &state); err != nil {
		return false, err
	}

	// Timestamp must be >= last seen timestamp and within 60 seconds of current time
	now := time.Now().UnixMilli()
	if timestamp < state.LastTimestamp {
		return false, nil
	}
	if timestamp > now+5000 { // Allow 5 second clock skew
		return false, nil
	}

	return true, nil
}

// GetAuditHistory returns the complete audit trail for a stream
func (c *MedTrustContract) GetAuditHistory(
	ctx contractapi.TransactionContextInterface,
	streamID string,
	limitStr string,
) ([]*ChunkRecord, error) {
	limit := 100
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}

	startKey := fmt.Sprintf("chunk:%s:0", streamID)
	endKey := fmt.Sprintf("chunk:%s:~", streamID)

	iterator, err := ctx.GetStub().GetStateByRange(startKey, endKey)
	if err != nil {
		return nil, fmt.Errorf("failed to get state range: %v", err)
	}
	defer iterator.Close()

	var records []*ChunkRecord
	for iterator.HasNext() && len(records) < limit {
		result, err := iterator.Next()
		if err != nil {
			return nil, err
		}
		var record ChunkRecord
		if err := json.Unmarshal(result.Value, &record); err != nil {
			continue
		}
		records = append(records, &record)
	}

	// Sort by sequence
	sort.Slice(records, func(i, j int) bool {
		return records[i].Sequence < records[j].Sequence
	})

	return records, nil
}

// GetStreamSummary returns aggregated stream statistics
func (c *MedTrustContract) GetStreamSummary(
	ctx contractapi.TransactionContextInterface,
	streamID string,
) (*StreamState, error) {
	stateKey := fmt.Sprintf("stream:%s", streamID)
	data, err := ctx.GetStub().GetState(stateKey)
	if err != nil {
		return nil, fmt.Errorf("ledger read error: %v", err)
	}
	if data == nil {
		return nil, fmt.Errorf("stream %s not found", streamID)
	}

	var state StreamState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	// Don't expose full hash list in summary
	state.SeenHashes = nil
	return &state, nil
}

// ComputeHash is a utility function to compute SHA-256 of data on-chain
func (c *MedTrustContract) ComputeHash(
	ctx contractapi.TransactionContextInterface,
	data string,
) (string, error) {
	h := sha256.New()
	h.Write([]byte(data))
	return hex.EncodeToString(h.Sum(nil)), nil
}

// CloseStream marks a stream as inactive
func (c *MedTrustContract) CloseStream(
	ctx contractapi.TransactionContextInterface,
	streamID string,
) error {
	stateKey := fmt.Sprintf("stream:%s", streamID)
	data, err := ctx.GetStub().GetState(stateKey)
	if err != nil || data == nil {
		return fmt.Errorf("stream %s not found", streamID)
	}

	var state StreamState
	if err := json.Unmarshal(data, &state); err != nil {
		return err
	}
	state.Active = false

	_ = c.logAuditEvent(ctx, streamID, "STREAM_CLOSED", "info",
		fmt.Sprintf("Stream closed. Total chunks: %d, Replay alerts: %d", state.ChunkCount, state.ReplayAlerts))

	return c.saveStreamState(ctx, &state)
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

func (c *MedTrustContract) getOrCreateStreamState(
	ctx contractapi.TransactionContextInterface,
	streamID, doctorID string,
) (*StreamState, error) {
	stateKey := fmt.Sprintf("stream:%s", streamID)
	data, err := ctx.GetStub().GetState(stateKey)
	if err != nil {
		return nil, err
	}
	if data != nil {
		var state StreamState
		if err := json.Unmarshal(data, &state); err != nil {
			return nil, err
		}
		return &state, nil
	}
	return &StreamState{
		StreamID:   streamID,
		DoctorID:   doctorID,
		StartedAt:  time.Now().UTC().Format(time.RFC3339),
		SeenHashes: []string{},
		Active:     true,
	}, nil
}

func (c *MedTrustContract) saveStreamState(
	ctx contractapi.TransactionContextInterface,
	state *StreamState,
) error {
	stateKey := fmt.Sprintf("stream:%s", state.StreamID)
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return ctx.GetStub().PutState(stateKey, data)
}

func (c *MedTrustContract) isReplay(seenHashes []string, hash string) bool {
	for _, h := range seenHashes {
		if h == hash {
			return true
		}
	}
	return false
}

func (c *MedTrustContract) logAuditEvent(
	ctx contractapi.TransactionContextInterface,
	streamID, eventType, severity, details string,
) error {
	txID := ctx.GetStub().GetTxID()
	record := AuditRecord{
		RecordID:   fmt.Sprintf("audit:%s:%s", streamID, txID),
		StreamID:   streamID,
		EventType:  eventType,
		Severity:   severity,
		Details:    details,
		RecordedAt: time.Now().UTC().Format(time.RFC3339),
	}
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	key := fmt.Sprintf("audit:%s:%s", streamID, txID)
	return ctx.GetStub().PutState(key, data)
}

func main() {
	chaincode, err := contractapi.NewChaincode(&MedTrustContract{})
	if err != nil {
		panic(fmt.Sprintf("Error creating MedTrust chaincode: %v", err))
	}
	if err := chaincode.Start(); err != nil {
		panic(fmt.Sprintf("Error starting MedTrust chaincode: %v", err))
	}
}
