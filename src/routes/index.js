// src/routes/index.js
const express = require('express');
const router = express.Router();

// Importação de todas as rotas
const healthRoutes = require('../features/health/health.routes');
const authRoutes = require('../features/auth/auth.routes');
const settingsRoutes = require('../features/settings/settings.routes');
const reportRoutes = require('../features/reports/reports.routes');
const companyRoutes = require('../features/company/company.routes');
const profileRoutes = require('../features/profile/profile.routes');
const userRoutes = require('../features/user/user.routes');
const hotspotUserRoutes = require('../features/hotspotUser/hotspotUser.routes');
const mikrotikRoutes = require('../features/mikrotik/mikrotik.routes');
const systemRoutes = require('../features/system/system.routes');   // <-- Adicionado
const publicRoutes = require('../features/public/public.routes'); // <-- Adicionado
const activityRoutes = require('../features/activity/activity.routes');   // <-- Adicionar
const notificationRoutes = require('../features/notification/notification.routes'); // <-- Adicionar
// Definição das rotas
router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/public', publicRoutes); // <-- Adicionado
router.use('/system', systemRoutes); // <-- Adicionado
router.use('/settings', settingsRoutes);
router.use('/reports', reportRoutes);
router.use('/companies', companyRoutes);
router.use('/profiles', profileRoutes);
router.use('/users', userRoutes);
router.use('/hotspot-users', hotspotUserRoutes);
router.use('/mikrotik', mikrotikRoutes);
router.use('/activities', activityRoutes); // <-- Adicionar
router.use('/notifications', notificationRoutes); // <-- Adicionar
module.exports = router;