// src/models/ConnectionLog.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ConnectionLog = sequelize.define('ConnectionLog', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  action: {
    type: DataTypes.STRING, // Ex: 'createUser', 'collectUsage', 'deleteProfile'
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('success', 'error'),
    allowNull: false,
  },
  message: {
    type: DataTypes.TEXT, // Mensagem de sucesso ou detalhes do erro
  },
  responseTime: {
    type: DataTypes.INTEGER, // Tempo de resposta em milissegundos
    allowNull: true,
  },
  // Relacionamento com a empresa
  companyId: {
    type: DataTypes.INTEGER,
    references: {
      model: 'Companies', // O nome da tabela, geralmente o plural do model
      key: 'id'
    }
  }
});

module.exports = ConnectionLog;