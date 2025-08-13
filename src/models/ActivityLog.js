// src/models/ActivityLog.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ActivityLog = sequelize.define('ActivityLog', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  description: {
    type: DataTypes.STRING,
    allowNull: false, // Ex: "Usuário 'Admin' criou a empresa 'Nova Empresa'."
  },
  type: {
    type: DataTypes.STRING, // 'user', 'company', 'profile', 'system', etc.
    allowNull: false,
  },
  // Relacionamento com o usuário que realizou a ação
  userId: {
    type: DataTypes.INTEGER,
    references: {
      model: 'Users',
      key: 'id'
    }
  }
});

module.exports = ActivityLog;