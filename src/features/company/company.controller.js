// src/features/company/company.controller.js
const { validationResult } = require('express-validator');
const companyService = require('./company.service');
// A importação do activity.service pode ser necessária para outras funções
const { createActivityLog } = require('../activity/activity.service');

const getAllCompanies = async (req, res) => {
  try {
    const { rows, count } = await companyService.findAllCompanies(req.query);
    const totalPages = Math.ceil(count / (req.query.limit || 10));
    res.status(200).json({
      success: true,
      data: rows,
      meta: { totalItems: count, totalPages, currentPage: parseInt(req.query.page, 10) || 1, },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar empresas.', error: error.message });
  }
};

const createCompany = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  try {
    const company = await companyService.createCompany(req.body, req.user.id); 
    res.status(201).json({ success: true, message: 'Empresa criada com sucesso!', data: company });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao criar empresa.', error: error.message });
  }
};

const getCompanyById = async (req, res) => {
  try {
    const company = await companyService.findCompanyById(req.params.id);
    if (!company) return res.status(404).json({ success: false, message: 'Empresa não encontrada.' });
    res.status(200).json({ success: true, data: company });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar empresa.', error: error.message });
  }
};

const updateCompany = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  try {
    const company = await companyService.updateCompany(req.params.id, req.body, req.user.id); 
    if (!company) return res.status(404).json({ success: false, message: 'Empresa não encontrada.' });
    res.status(200).json({ success: true, message: 'Empresa atualizada com sucesso!', data: company });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao atualizar empresa.', error: error.message });
  }
};

const deleteCompany = async (req, res) => {
  try {
    const company = await companyService.deleteCompany(req.params.id, req.user.id); 
    if (!company) return res.status(404).json({ success: false, message: 'Empresa não encontrada.' });
    res.status(200).json({ success: true, message: 'Empresa deletada com sucesso!' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao deletar empresa.', error: error.message });
  }
};

const testConnection = async (req, res) => {
    try {
        const result = await companyService.testCompanyConnection(req.params.id);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const setCompanyActiveTurma = async (req, res) => {
    try {
        const { id } = req.params;
        const { activeTurma } = req.body;
        const updatedCompany = await companyService.setCompanyActiveTurma(id, activeTurma, req.user.id);
        res.status(200).json({ success: true, message: `Turma ativa da empresa ${updatedCompany.name} atualizada para ${activeTurma}.`, data: updatedCompany });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro ao alterar turma ativa da empresa.', error: error.message });
    }
};

const syncAllData = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await companyService.syncAllDataForCompany(id); 
        res.status(200).json({
            success: true,
            message: 'Sincronização completa!',
            data: result
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro ao sincronizar dados do MikroTik.', error: error.message });
    }
};

// --- INÍCIO DO NOVO CONTROLADOR ---
const bulkAddCreditsToCompanyUsers = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { id } = req.params;
    const { creditAmountMB } = req.body;
    const performingUserId = req.user.id;

    if (!creditAmountMB || typeof creditAmountMB !== 'number' || creditAmountMB <= 0) {
      return res.status(400).json({ success: false, message: 'O campo "creditAmountMB" é obrigatório e deve ser um número positivo.' });
    }

    const result = await companyService.bulkAddCredits(id, creditAmountMB, performingUserId);

    res.status(200).json(result);

  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao adicionar crédito em massa para os usuários.', error: error.message });
  }
};

module.exports = {
  getAllCompanies, bulkAddCreditsToCompanyUsers, createCompany, getCompanyById, updateCompany, deleteCompany, testConnection, setCompanyActiveTurma, syncAllData,
};
