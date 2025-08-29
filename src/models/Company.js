// src/models/Company.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Company = sequelize.define('Company', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, },
  name: { type: DataTypes.STRING, allowNull: false, unique: true, },
  mikrotikIp: { type: DataTypes.STRING, allowNull: false, },
  mikrotikApiPort: { type: DataTypes.INTEGER, defaultValue: 443, },
  mikrotikApiUser: { type: DataTypes.STRING, allowNull: false, },
  mikrotikApiPass: { type: DataTypes.STRING, allowNull: false, },
  status: { type: DataTypes.ENUM('online', 'offline', 'error'), defaultValue: 'offline', },
  activeTurma: { type: DataTypes.ENUM('A', 'B', 'Nenhuma'), defaultValue: 'Nenhuma', // <-- NOVO CAMPO
    comment: 'Turma de usuários do hotspot ativa para esta empresa (A ou B).',
  },
});

module.exports = Company;