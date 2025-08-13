// src/features/activity/activity.service.js
const { ActivityLog, User } = require('../../models');

const findRecentActivities = async (limit = 10) => {
  return await ActivityLog.findAll({
    limit: parseInt(limit, 10),
    order: [['createdAt', 'DESC']],
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }]
  });
};

const createActivityLog = async ({ userId, type, description }) => {
    return await ActivityLog.create({ userId, type, description });
};

module.exports = { findRecentActivities, createActivityLog };