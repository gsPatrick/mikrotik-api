// src/features/mikrotik/mikrotik.routes.js
const express = require('express');
const { param } = require('express-validator');
const mikrotikController = require('./mikrotik.controller'); // Importa o controlador REAL do MikroTik
const { protect, authorize } = require('../../middleware/auth.middleware');

const router = express.Router();

// Aplica middlewares de proteção e autorização a todas as rotas do MikroTik
router.use(protect); // Todos os usuários logados podem ver

// Rotas específicas do MikroTik (ex: logs, importação manual)
router.get('/logs', authorize('admin', 'manager'), mikrotikController.getMikrotikLogs); // Logs podem ser vistos por admin e manager

// Rotas para importação/sincronização de dados (geralmente apenas admin)
router.post(
  '/:id/import-profiles', 
  authorize('admin'), 
  [param('id').isInt().withMessage('O ID da empresa deve ser um número inteiro.')],
  mikrotikController.importProfilesFromMikrotik
);
router.post(
  '/:id/import-users', 
  authorize('admin'), 
  [param('id').isInt().withMessage('O ID da empresa deve ser um número inteiro.')],
  mikrotikController.importUsersFromMikrotik
);

// Rota para disparar coleta de uso de dados manualmente para uma empresa
router.post(
  '/:id/collect-usage',
  authorize('admin'), 
  [param('id').isInt().withMessage('O ID da empresa deve ser um número inteiro.')],
  mikrotikController.collectUsageDataForCompany
);

// Rota para buscar vizinhos de rede
router.get(
  '/:id/neighbors',
  authorize('admin'), 
  [param('id').isInt().withMessage('O ID da empresa deve ser um número inteiro.')],
  mikrotikController.findNetworkNeighborsForCompany
);


module.exports = router;