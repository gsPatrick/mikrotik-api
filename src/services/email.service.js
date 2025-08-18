// src/services/email.service.js
const { Resend } = require('resend');
const { Settings } = require('../models');
const { createNotification } = require('../features/notification/notification.service'); // Importar!

/**
 * Envia um e-mail usando as configurações armazenadas no banco de dados.
 * @param {string} subject - O assunto do e-mail.
 * @param {string} html - O conteúdo HTML do e-mail.
 */
const sendEmail = async (subject, html) => { /* ... código existente ... */ };

const sendCreditExhaustedEmail = async (hotspotUser, company) => {
  const subject = `Alerta: Crédito Esgotado para ${hotspotUser.username}`;
  const html = `
    <h1>Alerta de Crédito Esgotado</h1>
    <p>O usuário <strong>${hotspotUser.username}</strong> da empresa <strong>${company.name}</strong> utilizou todo o seu crédito de dados e foi desativado.</p>
    <ul>
      <li><strong>Usuário:</strong> ${hotspotUser.username}</li>
      <li><strong>Empresa:</strong> ${company.name}</li>
      <li><strong>Crédito Total:</strong> ${(hotspotUser.creditsTotal / (1024 * 1024)).toFixed(2)} MB</li>
      <li><strong>Crédito Usado:</strong> ${(hotspotUser.creditsUsed / (1024 * 1024)).toFixed(2)} MB</li>
      <li><strong>Data/Hora:</strong> ${new Date().toLocaleString('pt-BR')}</li>
    </ul>
    <p>O usuário permanecerá desativado até o próximo reset diário de créditos.</p>
    <p>Este é um alerta automático do Hotspot Manager.</p>
  `;
  const emailResult = await sendEmail(subject, html);

  // NOVO: Cria uma notificação para o admin quando o crédito é esgotado
  await createNotification({
    description: `Crédito esgotado para o usuário ${hotspotUser.username} da empresa ${company.name}.`,
    type: 'aviso', // 'aviso' ou 'erro' dependendo da criticidade
    details: `Usuário: ${hotspotUser.username}\nEmpresa: ${company.name}\nCrédito Total: ${(hotspotUser.creditsTotal / (1024 * 1024)).toFixed(2)} MB\nCrédito Usado: ${(hotspotUser.creditsUsed / (1024 * 1024)).toFixed(2)} MB\nEmail enviado: ${!emailResult.error ? 'Sim' : 'Não, erro: ' + emailResult.error.message}`,
    userId: null // Isso fará com que a notificação seja atribuída ao admin padrão
  });
  return emailResult;
};

const sendTestEmail = async () => { /* ... código existente ... */ };

module.exports = {
  sendCreditExhaustedEmail,
  sendTestEmail,
};