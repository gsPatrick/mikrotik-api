const express = require('express');
const notificationController = require('./notification.controller');
const { protect } = require('../../middleware/auth.middleware');

const router = express.Router();
router.use(protect); // Todas as rotas de notificação são protegidas

router.get('/', notificationController.getUserNotifications);
router.post('/mark-as-read', notificationController.markAsRead);

module.exports = router;