// src/features/activity/activity.routes.js
const express = require('express');
const activityController = require('./activity.controller');
const { protect } = require('../../middleware/auth.middleware');

const router = express.Router();
router.use(protect);

router.get('/recent', activityController.getRecentActivities);

module.exports = router;