// src/features/public/public.routes.js
const express = require('express');
const publicController = require('./public.controller');

const router = express.Router();

// Esta rota é pública e não usa o middleware de proteção
router.get('/check-usage', publicController.getUsageByUsername);

module.exports = router;