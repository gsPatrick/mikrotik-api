// src/models/HotspotUser.js - VERSÃO ATUALIZADA
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
  // ✅ NOVOS CAMPOS NECESSÁRIOS para acúmulo correto
  currentSessionBytes: {
    type: DataTypes.BIGINT, // Bytes da sessão atual
    defaultValue: 0,
    comment: 'Bytes usados na sessão ativa atual'
  },
  lastCollectionTime: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Última vez que os dados foram coletados'
  },
  lastLoginTime: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Último login do usuário'
  },
  lastLogoutTime: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Último logout do usuário'
  },
  lastResetDate: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Última data de reset dos créditos'
  },
  sessionId: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'ID da sessão ativa atual no MikroTik'
  },
  // CAMPOS EXISTENTES
  turma: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'expired'),
    defaultValue: 'active',
  },
});

module.exports = HotspotUser;