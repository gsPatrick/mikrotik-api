// src/features/settings/settings.controller.js

const settingsService = require('./settings.service');
const { sendTestEmail } = require('../../services/email.service');
// ✅ CORREÇÃO: Importa o scheduler para poder chamá-lo
const scheduler = require('../../scheduler'); 

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
    const newSettingsData = req.body;
    const updatedSettings = await settingsService.updateSettings(newSettingsData);

    // ✅ CORREÇÃO PRINCIPAL:
    // Após salvar as novas configurações no banco de dados,
    // chamamos a função do scheduler para que ele pare as tarefas antigas
    // e inicie as novas com os horários que acabaram de ser salvos.
    await scheduler.rescheduleAllTasks();
    
    res.status(200).json({ 
      success: true, 
      message: 'Configurações atualizadas e tarefas reagendadas com sucesso!', 
      data: updatedSettings 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao atualizar configurações.', error: error.message });
  }
};

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

module.exports = {
  getCurrentSettings,
  updateCurrentSettings,
  testEmailSettings,
};