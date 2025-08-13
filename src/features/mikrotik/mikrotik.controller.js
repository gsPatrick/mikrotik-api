// src/features/mikrotik/mikrotik.controller.js
const mikrotikService = require('./mikrotik.service');

const getUsageData = async (req, res) => {
  try {
    const { companyId } = req.params;
    if (!companyId) {
        return res.status(400).json({ success: false, message: 'O ID da empresa é obrigatório.' });
    }
    const data = await mikrotikService.collectUsageData(companyId);
    res.status(200).json({
      success: true,
      message: `Dados de uso da empresa ID ${companyId} coletados com sucesso.`,
      data,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao coletar dados de uso.', error: error.message });
  }
};

// <-- Início dos Novos Controllers de Importação -->
const importProfiles = async (req, res) => {
    try {
        const { companyId } = req.params;
        const result = await mikrotikService.importProfilesFromMikrotik(companyId);
        res.status(200).json({ success: true, message: 'Importação de perfis concluída.', data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro ao importar perfis.', error: error.message });
    }
};

const importUsers = async (req, res) => {
    try {
        const { companyId } = req.params;
        const result = await mikrotikService.importUsersFromMikrotik(companyId);
        res.status(200).json({ success: true, message: 'Importação de usuários concluída.', data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro ao importar usuários.', error: error.message });
    }
};


// --- INÍCIO DO NOVO CONTROLLER ---
const getLogs = async (req, res) => {
  try {
    const { rows, count } = await mikrotikService.findAllLogs(req.query);
    const totalPages = Math.ceil(count / (req.query.limit || 10));
    res.status(200).json({
      success: true,
      data: rows,
      meta: { totalItems: count, totalPages, currentPage: parseInt(req.query.page, 10) || 1 },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar logs.', error: error.message });
  }
};


// --- INÍCIO DO NOVO CONTROLLER ---
const getNetworkNeighbors = async (req, res) => {
    try {
        const { companyId } = req.params;
        const neighbors = await mikrotikService.findNetworkNeighbors(companyId);
        res.status(200).json({ success: true, data: neighbors });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro ao buscar vizinhos de rede.', error: error.message });
    }
};
// --- FIM DO NOVO CONTROLLER ---
// <-- Fim dos Novos Controllers de Importação -->

module.exports = {
  getUsageData,
  importProfiles, // <-- Exportar
  importUsers, 
  getLogs,  // <-- Exportar
getNetworkNeighbors
};