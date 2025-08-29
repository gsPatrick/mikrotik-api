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

// Para o arquivo src/services/email.service.js
const sendCreditExhaustedEmail = async (hotspotUser, company) => {
  try {
    console.log(`[EMAIL] Preparando email de crédito esgotado para ${hotspotUser.username}`);
    
    // Verificar se os dados necessários estão presentes
    if (!hotspotUser || !company) {
      throw new Error('Dados insuficientes para envio do email');
    }

    // Calcular valores em MB para o email
    const creditTotalMB = (hotspotUser.creditsTotal / (1024 * 1024)).toFixed(2);
    const creditUsedMB = (hotspotUser.creditsUsed / (1024 * 1024)).toFixed(2);
    
    // Configurar os dados do email
    const emailData = {
      to: company.email || 'admin@empresa.com', // Email da empresa ou padrão
      subject: `🚨 Crédito Esgotado - Usuário ${hotspotUser.username}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #d32f2f;">⚠️ Crédito de Usuário Esgotado</h2>
          
          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3>Informações do Usuário:</h3>
            <p><strong>Nome:</strong> ${hotspotUser.username}</p>
            <p><strong>Turma:</strong> ${hotspotUser.turma || 'Não definida'}</p>
            <p><strong>Status:</strong> Desativado automaticamente</p>
          </div>
          
          <div style="background: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107;">
            <h3>Uso de Créditos:</h3>
            <p><strong>Crédito Total:</strong> ${creditTotalMB} MB</p>
            <p><strong>Crédito Usado:</strong> ${creditUsedMB} MB</p>
            <p><strong>Excesso:</strong> ${(parseFloat(creditUsedMB) - parseFloat(creditTotalMB)).toFixed(2)} MB</p>
          </div>
          
          <div style="background: #e8f5e8; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3>Empresa:</h3>
            <p><strong>Nome:</strong> ${company.name}</p>
            <p><strong>MikroTik:</strong> ${company.mikrotikIp}:${company.mikrotikApiPort}</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Data/Hora:</strong> ${new Date().toLocaleString('pt-BR')}</p>
            <p><em>Este email foi enviado automaticamente pelo sistema de monitoramento.</em></p>
          </div>
        </div>
      `,
      text: `
        CRÉDITO ESGOTADO - ${hotspotUser.username}
        
        Usuário: ${hotspotUser.username}
        Empresa: ${company.name}
        Crédito Total: ${creditTotalMB} MB
        Crédito Usado: ${creditUsedMB} MB
        
        O usuário foi desativado automaticamente.
        Data: ${new Date().toLocaleString('pt-BR')}
      `
    };

    // Aqui você deve usar seu provedor de email (Nodemailer, SendGrid, etc.)
    // Exemplo genérico:
    let emailResult;
    
    try {
      // Substitua por sua implementação real de envio de email
      // emailResult = await yourEmailProvider.send(emailData);
      
      // SIMULAÇÃO para teste (remover em produção):
      console.log(`[EMAIL] Simulando envio de email para: ${emailData.to}`);
      console.log(`[EMAIL] Assunto: ${emailData.subject}`);
      
      // Simular sucesso (remover em produção)
      emailResult = { success: true, messageId: 'simulated-' + Date.now() };
      
      // Para implementação real, descomente e configure seu provedor:
      /*
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransporter({
        // Sua configuração SMTP aqui
      });
      
      emailResult = await transporter.sendMail(emailData);
      */
      
    } catch (emailSendError) {
      console.error(`[EMAIL] Erro no provedor de email:`, emailSendError);
      throw new Error(`Falha no envio: ${emailSendError.message}`);
    }

    // Verificar resultado do envio
    if (emailResult && (emailResult.success || emailResult.messageId)) {
      console.log(`[EMAIL] ✅ Email enviado com sucesso para ${hotspotUser.username}`);
      return { 
        success: true, 
        messageId: emailResult.messageId,
        message: `Email enviado para ${emailData.to}` 
      };
    } else {
      throw new Error('Provedor de email retornou resultado inválido');
    }

  } catch (error) {
    console.error(`[EMAIL] ❌ Erro ao enviar email de crédito esgotado:`, error.message);
    
    // Retornar erro estruturado (importante para evitar o erro original)
    return { 
      success: false, 
      error: error.message || 'Erro desconhecido no envio de email'
    };
  }
};

const sendTestEmail = async () => { /* ... código existente ... */ };

module.exports = {
  sendCreditExhaustedEmail,
  sendTestEmail,
};