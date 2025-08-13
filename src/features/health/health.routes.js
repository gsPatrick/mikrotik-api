const express = require('express');
const router = express.Router();
const healthController = require('./health.controller');

// Rota para testar a conexão com o MikroTik
router.get('/mikrotik-connection', healthController.testMikrotikConnection);

module.exports = router;