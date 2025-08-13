// src/features/settings/settings.routes.js
const express = require('express');
const settingsController = require('./settings.controller');
const { protect, authorize } = require('../../middleware/auth.middleware');

const router = express.Router();

// Apenas administradores podem ver e modificar as configurações do sistema
router.use(protect, authorize('admin'));

router.get('/', settingsController.getCurrentSettings);
router.put('/', settingsController.updateCurrentSettings);
router.post('/test-email', settingsController.testEmailSettings); // <-- Nova Rota

module.exports = router;