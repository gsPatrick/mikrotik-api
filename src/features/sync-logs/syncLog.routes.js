// src/features/sync-logs/syncLog.routes.js
const express = require('express');
const syncLogController = require('./syncLog.controller');
const { protect, authorize } = require('../../middleware/auth.middleware');

const router = express.Router();

router.get('/report.txt', syncLogController.getSyncLog); // Endpoint para baixar/visualizar o TXT

module.exports = router;