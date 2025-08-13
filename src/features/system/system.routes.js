// src/features/system/system.routes.js
const express = require('express');
const systemController = require('./system.controller');
const { protect, authorize } = require('../../middleware/auth.middleware');
const multer = require('multer');
const path = require('path');

const router = express.Router();

// Configuração do Multer para salvar o upload do backup em um diretório temporário
const upload = multer({ dest: path.join(__dirname, '../../../uploads/') });

// Protegendo as rotas de backup e restauração - SOMENTE ADMIN
router.use(protect, authorize('admin'));

router.get('/backup/download', systemController.downloadBackup);
router.post('/backup/restore', upload.single('backupFile'), systemController.restoreFromBackup);

module.exports = router;