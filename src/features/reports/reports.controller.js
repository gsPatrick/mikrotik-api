// src/features/reports/reports.controller.js
const reportService = require('./reports.service');

const mainStats = async (req, res) => {
  try {
    const stats = await reportService.getMainDashboardStats();
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao gerar estatísticas do dashboard.', error: error.message });
  }
};

const usageReport = async (req, res) => {
  try {
    const report = await reportService.getUsageReport(req.query);
    res.status(200).json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao gerar relatório de uso.', error: error.message });
  }
};

module.exports = {
  mainStats,
  usageReport,
};