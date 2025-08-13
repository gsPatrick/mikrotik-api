// src/features/reports/reports.routes.js
const express = require('express');
const reportController = require('./reports.controller');
const { protect, authorize } = require('../../middleware/auth.middleware');

const router = express.Router();

// Protege todas as rotas de relatórios
router.use(protect, authorize('admin', 'manager'));

router.get('/dashboard-stats', reportController.mainStats);
router.get('/usage', reportController.usageReport);

module.exports = router;