const { validationResult } = require('express-validator');
const Joi = require('joi');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

const validateBody = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) {
    return res.status(400).json({
      error: 'Validation failed',
      details: error.details.map((d) => ({ field: d.path.join('.'), message: d.message })),
    });
  }
  req.body = value;
  next();
};

// Joi schemas
const schemas = {
  registerDoctor: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8).max(128).required(),
    full_name: Joi.string().min(2).max(100).required(),
    department: Joi.string().max(100).required(),
    specialization: Joi.string().max(100).optional(),
    license_number: Joi.string().max(50).required(),
    role: Joi.string().valid('admin', 'doctor', 'nurse', 'viewer').default('doctor'),
  }),

  loginDoctor: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
  }),

  trainVoice: Joi.object({
    doctor_id: Joi.string().uuid().required(),
    sample_count: Joi.number().integer().min(3).max(10).default(5),
  }),

  analyzeVideo: Joi.object({
    stream_id: Joi.string().uuid().required(),
    chunk_data: Joi.string().base64().required(),
    timestamp: Joi.number().required(),
    frame_rate: Joi.number().min(1).max(60).default(30),
  }),

  analyzeAudio: Joi.object({
    stream_id: Joi.string().uuid().required(),
    audio_data: Joi.string().base64().required(),
    timestamp: Joi.number().required(),
    sample_rate: Joi.number().valid(8000, 16000, 22050, 44100, 48000).default(16000),
  }),

  adminConfig: Joi.object({
    video_threshold: Joi.number().min(0).max(1).optional(),
    voice_threshold: Joi.number().min(0).max(1).optional(),
    biometric_threshold: Joi.number().min(0).max(1).optional(),
    alert_threshold: Joi.number().min(0).max(100).optional(),
    suspicious_threshold: Joi.number().min(0).max(100).optional(),
    video_weight: Joi.number().min(0).max(1).optional(),
    voice_weight: Joi.number().min(0).max(1).optional(),
    biometric_weight: Joi.number().min(0).max(1).optional(),
    blockchain_weight: Joi.number().min(0).max(1).optional(),
  }),
};

module.exports = { validate, validateBody, schemas };
