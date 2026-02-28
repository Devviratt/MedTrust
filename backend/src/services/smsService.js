'use strict';

/**
 * smsService.js — Twilio SMS async queue
 *
 * Sends critical alerts to doctor + hospital admin phones.
 * Non-blocking — all sends are fire-and-forget via a tiny in-memory queue
 * processed on the next event-loop tick so the HTTP request is never delayed.
 *
 * Environment variables required:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER   — E.164 format e.g. +14155552671
 *   ADMIN_PHONE_NUMBER   — hospital admin number
 *
 * Doctor phone is loaded from the streams / doctors table at send time.
 */

const { query } = require('../config/database');
const { logger } = require('../middleware/errorHandler');

// ── Lazy-load Twilio to avoid crash if not installed ─────────────────────────
let twilioClient = null;

const getTwilioClient = () => {
  if (twilioClient) return twilioClient;
  try {
    const twilio = require('twilio');
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token || sid.startsWith('AC_PLACEHOLDER')) {
      logger.warn('[smsService] Twilio credentials not configured — SMS disabled');
      return null;
    }
    twilioClient = twilio(sid, token);
    return twilioClient;
  } catch {
    logger.warn('[smsService] Twilio package not installed — SMS disabled');
    return null;
  }
};

// ── In-memory queue (max 200 pending messages) ────────────────────────────────
const queue = [];
let processing = false;

const processQueue = async () => {
  if (processing || queue.length === 0) return;
  processing = true;
  while (queue.length > 0) {
    const job = queue.shift();
    await sendSmsNow(job).catch((err) =>
      logger.warn('[smsService] SMS send failed', { to: job.to, error: err.message })
    );
  }
  processing = false;
};

const sendSmsNow = async ({ to, body }) => {
  const client = getTwilioClient();
  if (!client) return;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from) return;
  await client.messages.create({ to, from, body });
  logger.info('[smsService] SMS sent', { to });
};

// ── Enqueue (non-blocking) ────────────────────────────────────────────────────
const enqueueSms = (to, body) => {
  if (!to || !body) return;
  if (queue.length >= 200) return; // drop if queue full
  queue.push({ to, body });
  setImmediate(processQueue);
};

// ── Main: send critical alert to doctor + admin ───────────────────────────────

/**
 * sendCriticalAlert({ streamId, trustScore, doctorId, timestamp })
 *
 * Looks up doctor phone from DB, then enqueues SMS to doctor + admin.
 * Fully async, does NOT block the caller.
 */
const sendCriticalAlert = async ({ streamId, trustScore, doctorId, timestamp }) => {
  const client = getTwilioClient();
  if (!client) return; // SMS not configured — silent skip

  const ts = timestamp || new Date().toISOString();
  const body =
    `⚠️ MedTrust Alert:\n` +
    `Deepfake suspicion detected.\n` +
    `Trust Score: ${trustScore}\n` +
    `Stream ID: ${streamId.slice(0, 8)}...\n` +
    `Time: ${ts}`;

  // Load doctor phone from DB
  try {
    if (doctorId) {
      const res = await query(
        `SELECT phone_number FROM doctors WHERE id = $1`,
        [doctorId]
      );
      const doctorPhone = res.rows[0]?.phone_number;
      if (doctorPhone) enqueueSms(doctorPhone, body);
    }
  } catch (err) {
    logger.warn('[smsService] could not load doctor phone', { error: err.message });
  }

  // Always notify admin
  const adminPhone = process.env.ADMIN_PHONE_NUMBER;
  if (adminPhone) enqueueSms(adminPhone, body);
};

module.exports = { sendCriticalAlert, enqueueSms };
