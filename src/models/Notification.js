// src/models/Notification.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Notification = sequelize.define('Notification', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  description: { type: DataTypes.STRING, allowNull: false },
  type: { type: DataTypes.ENUM('sucesso', 'erro', 'aviso', 'info'), defaultValue: 'info' },
  details: { type: DataTypes.TEXT, allowNull: true },
  isRead: { type: DataTypes.BOOLEAN, defaultValue: false },
  // Relacionamento com o usuário que receberá a notificação
  userId: { type: DataTypes.INTEGER, references: { model: 'Users', key: 'id' }}
});
module.exports = Notification;