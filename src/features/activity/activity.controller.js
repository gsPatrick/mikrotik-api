// src/features/activity/activity.controller.js
const activityService = require('./activity.service');

const getRecentActivities = async (req, res) => {
  try {
    const activities = await activityService.findRecentActivities(req.query.limit);
    res.status(200).json({ success: true, data: activities });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar atividades recentes.', error: error.message });
  }
};

module.exports = { getRecentActivities };