// src/features/auth/auth.routes.js
const express = require('express');
const authController = require('./auth.controller');

const router = express.Router();

router.post('/login', authController.login);

module.exports = router;