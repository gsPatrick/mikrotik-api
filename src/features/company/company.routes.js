// src/features/company/company.routes.js
const express = require('express');
const { body, param } = require('express-validator');
const companyController = require('./company.controller'); // Corrigido
const { protect, authorize } = require('../../middleware/auth.middleware');

const router = express.Router();

const companyValidation = [
  body('name').notEmpty().withMessage('O nome da empresa é obrigatório.'),
  body('mikrotikIp').isIP().withMessage('O IP do MikroTik deve ser um IP válido.'),
  body('mikrotikApiUser').notEmpty().withMessage('O usuário da API é obrigatório.'),
  body('mikrotikApiPass').notEmpty().withMessage('A senha da API é obrigatória.'),
];

router.post('/', protect, authorize('admin'), companyValidation, companyController.createCompany);
router.get('/', protect, authorize('admin', 'manager'), companyController.getAllCompanies);
router.get('/:id', protect, authorize('admin', 'manager'), companyController.getCompanyById);
router.put('/:id', protect, authorize('admin'), companyValidation, companyController.updateCompany);
router.delete('/:id', protect, authorize('admin'), companyController.deleteCompany);

router.post(
  '/:id/test-connection',
  protect,
  authorize('admin', 'manager'),
  [param('id').isInt().withMessage('O ID da empresa deve ser um número inteiro.')],
  companyController.testConnection
);

router.patch(
  '/:id/set-active-turma',
  protect,
  authorize('admin'),
  [
    param('id').isInt().withMessage('O ID da empresa deve ser um número inteiro.'),
    body('activeTurma').isIn(['A', 'B', 'Nenhuma']).withMessage('Turma ativa inválida.')
  ],
  companyController.setCompanyActiveTurma
);

router.post(
    '/:id/sync-all', 
    protect, 
    authorize('admin', 'manager'),
    [param('id').isInt().withMessage('O ID da empresa deve ser um número inteiro.')],
    companyController.syncAllData
);



// --- INÍCIO DA NOVA ROTA ---
router.post(
  '/:id/bulk-add-credits',
  protect,
  authorize('admin'), // Apenas admins podem fazer isso
  [
    param('id').isInt().withMessage('O ID da empresa deve ser um número inteiro.'),
    body('creditAmountMB').isNumeric().withMessage('A quantidade de crédito (MB) deve ser um número.')
  ],
  companyController.bulkAddCreditsToCompanyUsers
);

module.exports = router;
