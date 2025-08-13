
// src/models/HotspotUser.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const HotspotUser = sequelize.define('HotspotUser', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  // O ID do usuário como ele existe no MikroTik (ex: "*1A")
  mikrotikId: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: true, // Pode ser nulo até a primeira sincronização
  },
  creditsTotal: {
    type: DataTypes.BIGINT, // Em bytes
    defaultValue: 0,
  },
  creditsUsed: {
    type: DataTypes.BIGINT, // Em bytes
    defaultValue: 0,
  },
  turma: { // "Turma" parece ser um agrupador/identificador
    type: DataTypes.STRING,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'expired'),
    defaultValue: 'active',
  },
});

module.exports = HotspotUser;