// src/services/email.service.js
const { Resend } = require('resend');
const { Settings } = require('../models');

/**
 * Envia um e-mail usando as configurações armazenadas no banco de dados.
 * @param {string} subject - O assunto do e-mail.
 * @param {string} html - O conteúdo HTML do e-mail.
 */
const sendEmail = async (subject, html) => {
  const settings = await Settings.findByPk(1);
  if (!settings || !settings.resendApiKey || !settings.notificationEmailTo || !settings.notificationEmailFrom) {
    console.error('Email não enviado: Configurações de e-mail (Resend) incompletas no banco de dados.');
    return { error: 'Configurações de e-mail incompletas.' };
  }

  try {
    const resend = new Resend(settings.resendApiKey);

    const { data, error } = await resend.emails.send({
      from: `${settings.systemName} <${settings.notificationEmailFrom}>`,
      to: [settings.notificationEmailTo],
      subject: subject,
      html: html,
    });

    if (error) {
      console.error('Erro ao enviar e-mail via Resend:', error);
      return { error };
    }

    console.log(`E-mail enviado com sucesso para ${settings.notificationEmailTo}. ID: ${data.id}`);
    return { data };
  } catch (error) {
    console.error('Exceção ao tentar enviar e-mail:', error);
    return { error };
  }
};

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
  return await sendEmail(subject, html);
};

const sendTestEmail = async () => {
    const subject = 'E-mail de Teste - Hotspot Manager';
    const html = `
        <h1>Olá!</h1>
        <p>Este é um e-mail de teste gerado a partir do seu painel Hotspot Manager.</p>
        <p>Se você recebeu este e-mail, suas configurações do Resend estão funcionando corretamente.</p>
        <p><strong>Data/Hora:</strong> ${new Date().toLocaleString('pt-BR')}</p>
    `;
    return await sendEmail(subject, html);
}

module.exports = {
  sendCreditExhaustedEmail,
  sendTestEmail, // <-- Exportar a nova função de teste
};