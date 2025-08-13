// src/features/settings/settings.controller.js
const settingsService = require('./settings.service');
const { sendTestEmail } = require('../../services/email.service');

const getCurrentSettings = async (req, res) => {
  try {
    const settings = await settingsService.getSettings();
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar configurações.', error: error.message });
  }
};

const updateCurrentSettings = async (req, res) => {
  try {
    const updatedSettings = await settingsService.updateSettings(req.body);
    res.status(200).json({ success: true, message: 'Configurações atualizadas com sucesso!', data: updatedSettings });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao atualizar configurações.', error: error.message });
  }
};

// <-- Início do Novo Controller -->
const testEmailSettings = async (req, res) => {
    try {
        const result = await sendTestEmail();
        if (result.error) {
            return res.status(400).json({ success: false, message: 'Falha ao enviar e-mail de teste.', error: result.error });
        }
        res.status(200).json({ success: true, message: 'E-mail de teste enviado com sucesso!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro inesperado no servidor ao tentar enviar e-mail.', error: error.message });
    }
};
// <-- Fim do Novo Controller -->

module.exports = {
  getCurrentSettings,
  updateCurrentSettings,
  testEmailSettings, // <-- Exportar
};