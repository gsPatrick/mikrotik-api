// src/features/company/company.service.js
const { Op } = require('sequelize');
const { Company, ConnectionLog } = require('../../models');
const { createMikrotikClient } = require('../../config/mikrotik');

const findAllCompanies = async (options) => {
  const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'DESC', ...filters } = options;

  const where = {};
  if (filters.name) {
    where.name = { [Op.iLike]: `%${filters.name}%` };
  }
  if (filters.status) {
    where.status = filters.status;
  }

  const offset = (page - 1) * limit;

  return await Company.findAndCountAll({
    where,
    limit,
    offset,
    order: [[sortBy, sortOrder]],
  });
};

const createCompany = async (companyData) => {
  return await Company.create(companyData);
};

const findCompanyById = async (id) => {
  return await Company.findByPk(id);
};

const updateCompany = async (id, companyData) => {
  const company = await findCompanyById(id);
  if (!company) {
    return null;
  }
  return await company.update(companyData);
};

const deleteCompany = async (id) => {
  const company = await findCompanyById(id);
  if (!company) {
    return null;
  }
  await company.destroy();
  return company;
};

const testCompanyConnection = async (id) => {
  const company = await findCompanyById(id);
  if (!company) {
    throw new Error('Empresa não encontrada.');
  }

  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();
  const action = 'testConnection';

  try {
    await mikrotikClient.get('/system/identity');
    
    await ConnectionLog.create({
      action, status: 'success', message: 'Teste de conexão bem-sucedido.',
      responseTime: Date.now() - startTime, companyId: id,
    });

    return { success: true, message: 'Conexão com o MikroTik bem-sucedida!' };
  } catch (error) {
    let friendlyMessage = 'Erro desconhecido.';
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      friendlyMessage = 'Não foi possível resolver o IP ou a porta está sendo recusada. Verifique o IP, a porta e se a API está ativa.';
    } else if (error.response?.status === 401) {
      friendlyMessage = 'Credenciais inválidas. Verifique o usuário e a senha da API.';
    } else {
      friendlyMessage = error.response?.data?.message || error.message;
    }
    
    await ConnectionLog.create({
      action, status: 'error', message: friendlyMessage,
      responseTime: Date.now() - startTime, companyId: id,
    });
    
    throw new Error(friendlyMessage);
  }
};

const updateCompanyStatus = async (companyId) => {
  const company = await findCompanyById(companyId);
  if (!company) {
    console.error(`Monitoramento: Empresa com ID ${companyId} não encontrada para atualização de status.`);
    return;
  }

  try {
    // Usamos a função de teste de conexão que já criamos.
    await testCompanyConnection(company.id);
    // Se não houver erro, a conexão está ok.
    if (company.status !== 'online') {
      await company.update({ status: 'online' });
    }
  } catch (error) {
    // Se a conexão falhar por qualquer motivo.
    if (company.status !== 'offline') {
      await company.update({ status: 'offline' });
    }
  }
};


module.exports = {
  findAllCompanies,
  createCompany,
  findCompanyById,
  updateCompany,
  deleteCompany,
  testCompanyConnection,
  updateCompanyStatus,
};