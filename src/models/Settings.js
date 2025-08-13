// src/models/Settings.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Settings = sequelize.define('Settings', {
  id: {
    type: DataTypes.INTEGER,
    // autoIncrement: true, // SERIAL já faz isso, mas vamos manter para o Sequelize
    primaryKey: true,
    // REMOVEMOS o `defaultValue: 1` daqui para evitar o conflito
  },
  systemName: {
    type: DataTypes.STRING,
    defaultValue: 'Hotspot Manager',
  },
  systemLogoUrl: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  timezone: {
    type: DataTypes.STRING,
    defaultValue: 'America/Sao_Paulo',
  },
  defaultDailyCreditMB: {
    type: DataTypes.INTEGER,
    defaultValue: 500,
    comment: 'Crédito diário padrão em Megabytes a ser atribuído no reset.',
  },
  creditResetTimeUTC: {
    type: DataTypes.STRING,
    defaultValue: '03:00',
    comment: 'Horário (HH:MM) em UTC para o reset diário de créditos.',
  },
  resendApiKey: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Chave da API do Resend para envio de e-mails.'
  },
  notificationEmailFrom: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'E-mail remetente verificado no Resend (ex: onboarding@resend.dev).',
  },
  notificationEmailTo: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'E-mail do administrador que receberá as notificações.'
  },
});

// Adicionamos um "hook" que garante que a primeira linha seja criada com ID 1
// após a sincronização, se a tabela estiver vazia.
Settings.afterSync(async (options) => {
  const count = await Settings.count();
  if (count === 0) {
    await Settings.create({ id: 1 });
    console.log('✨ Registro de configurações iniciais criado com ID 1.');
  }
});

module.exports = Settings;