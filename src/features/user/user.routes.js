// src/features/user/user.routes.js
const express = require('express');
const { body } = require('express-validator');
const userController = require('./user.controller');
const { protect, authorize } = require('../../middleware/auth.middleware');
const { Company } = require('../../models');

const router = express.Router();

// Validações para criação e atualização
const userValidation = [
  body('name').notEmpty().withMessage('O nome é obrigatório.'),
  body('email').isEmail().withMessage('Forneça um email válido.'),
  body('role').isIn(['admin', 'manager', 'user']).withMessage('A role é inválida.'),
  body('password').isLength({ min: 6 }).withMessage('A senha deve ter no mínimo 6 caracteres.'),
  body('companyId').optional().isInt().withMessage('O ID da empresa deve ser um número.')
    .custom(async (value) => {
        if (value) {
            const company = await Company.findByPk(value);
            if (!company) return Promise.reject('A empresa especificada não existe.');
        }
    }),
];

// Aplicando middlewares de proteção e autorização
// Apenas admins podem gerenciar outros usuários
router.use(protect, authorize('admin'));

router.post('/', userValidation, userController.createUser);
router.get('/', userController.getAllUsers);
router.get('/:id', userController.getUserById);
router.put('/:id', userController.updateUser); // A validação pode ser um pouco diferente aqui
router.delete('/:id', userController.deleteUser);

module.exports = router;