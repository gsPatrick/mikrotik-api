// src/models/Company.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Company = sequelize.define('Company', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  mikrotikIp: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  mikrotikApiPort: {
    type: DataTypes.INTEGER,
    defaultValue: 443,
  },
  mikrotikApiUser: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  mikrotikApiPass: {
    type: DataTypes.STRING, // Em produção, isso deve ser criptografado
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('online', 'offline', 'error'),
    defaultValue: 'offline',
  },
});

module.exports = Company;