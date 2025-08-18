// src/models/Settings.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Settings = sequelize.define('Settings', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
  },
  systemName: {
    type: DataTypes.STRING,
    defaultValue: 'Hotspot Manager',
  },
  creditMode: {
    type: DataTypes.ENUM('reset', 'accumulate'),
    defaultValue: 'reset',
    comment: 'Define se o crédito diário reseta para o valor padrão ou se acumula ao saldo existente.',
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
  
  // --- INÍCIO DAS NOVAS CONFIGURAÇÕES DE CRON JOBS ---
  usageCollectionCron: {
    type: DataTypes.STRING,
    defaultValue: '*/1 * * * *', // Padrão: A cada 1 minuto
    comment: 'Expressão Cron para a coleta de uso de dados do MikroTik.'
  },
  companyStatusMonitorCron: {
    type: DataTypes.STRING,
    defaultValue: '*/5 * * * *', // Padrão: A cada 5 minutos
    comment: 'Expressão Cron para o monitoramento de status das empresas.'
  },
  mikrotikDataSyncCron: {
    type: DataTypes.STRING,
    defaultValue: '0 4 * * *', // Padrão: Todo dia às 04:00 UTC
    comment: 'Expressão Cron para a sincronização de perfis e usuários do MikroTik.'
  },
  // --- FIM DAS NOVAS CONFIGURAÇÕES DE CRON JOBS ---
});

// Hook que garante que a primeira linha seja criada com ID 1
Settings.afterSync(async (options) => {
  const count = await Settings.count();
  if (count === 0) {
    await Settings.create({ id: 1 });
    console.log('✨ Registro de configurações iniciais criado com ID 1.');
  }
});

module.exports = Settings;