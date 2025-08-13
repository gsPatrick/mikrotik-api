// src/models/Profile.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Profile = sequelize.define('Profile', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  rateLimit: {
    type: DataTypes.STRING, // Ex: "512k/2M" (upload/download)
    allowNull: true,
  },
  sessionTimeout: {
    type: DataTypes.STRING, // Ex: "01:00:00" para 1 hora
    allowNull: true,
  },
  // O nome do perfil como ele existe no MikroTik
  mikrotikName: {
    type: DataTypes.STRING,
    allowNull: false,
  },
});

module.exports = Profile;