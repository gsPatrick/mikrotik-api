// src/features/company/company.routes.js
const express = require('express');
const { body, param } = require('express-validator');
const companyController = require('./company.controller');
const { protect, authorize } = require('../../middleware/auth.middleware');

const router = express.Router();

// Validações para criação e atualização
const companyValidation = [
  body('name').notEmpty().withMessage('O nome da empresa é obrigatório.'),
  body('mikrotikIp').isIP().withMessage('O IP do MikroTik deve ser um IP válido.'),
  body('mikrotikApiUser').notEmpty().withMessage('O usuário da API é obrigatório.'),
  body('mikrotikApiPass').notEmpty().withMessage('A senha da API é obrigatória.'),
];

// Protegendo as rotas que modificam dados
router.post('/', protect, authorize('admin'), companyValidation, companyController.createCompany);
router.put('/:id', protect, authorize('admin'), companyValidation, companyController.updateCompany);
router.delete('/:id', protect, authorize('admin'), companyController.deleteCompany);

// Rota de teste de conexão (admin e manager podem testar)
router.post(
  '/:id/test-connection', // <-- Nova Rota
  protect,
  authorize('admin', 'manager'),
  [param('id').isInt().withMessage('O ID da empresa deve ser um número inteiro.')],
  companyController.testConnection
);

// Rotas de leitura (admin e manager podem ler)
router.get('/', protect, authorize('admin', 'manager'), companyController.getAllCompanies);
router.get('/:id', protect, authorize('admin', 'manager'), companyController.getCompanyById);


module.exports = router;