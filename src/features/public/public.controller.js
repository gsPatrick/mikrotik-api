// src/features/public/public.controller.js
const publicService = require('./public.service');

const getUsageByUsername = async (req, res) => {
  try {
    const { username } = req.query; // Busca o username a partir de um query parameter

    const usageData = await publicService.checkUsageByUsername(username);

    if (!usageData) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
    }

    res.status(200).json({ success: true, data: usageData });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getUsageByUsername,
};