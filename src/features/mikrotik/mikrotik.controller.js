// src/features/mikrotik/mikrotik.controller.js
const mikrotikService = require('./mikrotik.service'); // Importa o serviço REAL do MikroTik
const { validationResult } = require('express-validator');

// Controlador para obter os logs de conexão do MikroTik
const getMikrotikLogs = async (req, res) => {
  try {
    const { rows, count } = await mikrotikService.findAllLogs(req.query);
    const totalPages = Math.ceil(count / (req.query.limit || 10));

    res.status(200).json({
      success: true,
      data: rows,
      meta: { totalItems: count, totalPages, currentPage: parseInt(req.query.page, 10) || 1 },
    });
  } catch (error) {
    console.error('Erro ao buscar logs do MikroTik:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar logs do MikroTik.', error: error.message });
  }
};

// Controlador para importar perfis do MikroTik (disparado manualmente ou via scheduler)
const importProfilesFromMikrotik = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  try {
    const { id: companyId } = req.params;
    const result = await mikrotikService.importProfilesFromMikrotik(companyId);
    res.status(200).json({ success: true, message: 'Perfis importados/atualizados com sucesso!', data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao importar perfis do MikroTik.', error: error.message });
  }
};

// Controlador para importar usuários do MikroTik (disparado manualmente ou via scheduler)
const importUsersFromMikrotik = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  try {
    const { id: companyId } = req.params;
    const result = await mikrotikService.importUsersFromMikrotik(companyId);
    res.status(200).json({ success: true, message: 'Usuários importados/atualizados com sucesso!', data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao importar usuários do MikroTik.', error: error.message });
  }
};

// Controlador para coletar dados de uso para uma empresa específica
const collectUsageDataForCompany = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  try {
    const { id: companyId } = req.params;
    const result = await mikrotikService.collectUsageData(companyId);
    res.status(200).json({ success: true, message: 'Coleta de uso de dados iniciada para a empresa.', data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao coletar dados de uso do MikroTik.', error: error.message });
  }
};

// Controlador para buscar vizinhos de rede
const findNetworkNeighborsForCompany = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
    try {
        const { id: companyId } = req.params;
        const neighbors = await mikrotikService.findNetworkNeighbors(companyId);
        res.status(200).json({ success: true, data: neighbors });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro ao buscar vizinhos de rede do MikroTik.', error: error.message });
    }
};

// NOTA: A função `syncAllDataForCompany` deve estar no company.service.js
// porque ela orquestra ações em torno da Company (importando Perfis e Usuários),
// mas ela deve chamar os serviços de `mikrotikService` para as operações reais no MikroTik.
// Mantenha essa lógica em `company.service.js` e `company.controller.js` como está.

module.exports = {
  getMikrotikLogs,
  importProfilesFromMikrotik,
  importUsersFromMikrotik,
  collectUsageDataForCompany,
  findNetworkNeighborsForCompany,
};