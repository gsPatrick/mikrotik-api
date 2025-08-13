// src/features/mikrotik/mikrotik.routes.js
const express = require('express');
const mikrotikController = require('./mikrotik.controller');
const { protect, authorize } = require('../../middleware/auth.middleware');

const router = express.Router();

// Protegendo todas as rotas
router.use(protect, authorize('admin', 'manager'));

// Rota para disparar a coleta de dados de uma empresa específica
router.post('/:companyId/collect-usage', mikrotikController.getUsageData);

// Novas rotas para importação
router.post('/:companyId/import-profiles', mikrotikController.importProfiles);
router.post('/:companyId/import-users', mikrotikController.importUsers);
router.get('/logs', mikrotikController.getLogs); // <-- ROTA ADICIONADA
router.get('/:companyId/neighbors', mikrotikController.getNetworkNeighbors); // <-- Nova Rota


module.exports = router;