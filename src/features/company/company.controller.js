// src/features/company/company.controller.js
const { validationResult } = require('express-validator');
const companyService = require('./company.service');
const { createActivityLog } = require('../activity/activity.service'); // <-- Importado para logar atividades

const getAllCompanies = async (req, res) => {
  try {
    const { rows, count } = await companyService.findAllCompanies(req.query);
    const totalPages = Math.ceil(count / (req.query.limit || 10));

    res.status(200).json({
      success: true,
      data: rows,
      meta: {
        totalItems: count,
        totalPages,
        currentPage: parseInt(req.query.page, 10) || 1,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar empresas.', error: error.message });
  }
};

const createCompany = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const company = await companyService.createCompany(req.body);
    
    // LOG DA ATIVIDADE
    await createActivityLog({
      userId: req.user.id, // ID do usuário logado, vindo do middleware 'protect'
      type: 'company',
      description: `A empresa '${company.name}' foi criada.`,
    });

    res.status(201).json({ success: true, message: 'Empresa criada com sucesso!', data: company });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao criar empresa.', error: error.message });
  }
};

const getCompanyById = async (req, res) => {
  try {
    const company = await companyService.findCompanyById(req.params.id);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Empresa não encontrada.' });
    }
    res.status(200).json({ success: true, data: company });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar empresa.', error: error.message });
  }
};

const updateCompany = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

  try {
    const company = await companyService.updateCompany(req.params.id, req.body);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Empresa não encontrada.' });
    }

    // LOG DA ATIVIDADE
    await createActivityLog({
      userId: req.user.id,
      type: 'company',
      description: `A empresa '${company.name}' foi atualizada.`,
    });

    res.status(200).json({ success: true, message: 'Empresa atualizada com sucesso!', data: company });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao atualizar empresa.', error: error.message });
  }
};

const deleteCompany = async (req, res) => {
  try {
    const company = await companyService.deleteCompany(req.params.id);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Empresa não encontrada.' });
    }

    // LOG DA ATIVIDADE
    await createActivityLog({
      userId: req.user.id,
      type: 'company',
      description: `A empresa '${company.name}' foi excluída.`,
    });

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
        // O serviço já lança um erro com uma mensagem amigável
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
  getAllCompanies,
  createCompany,
  getCompanyById,
  updateCompany,
  deleteCompany,
  testConnection,
};