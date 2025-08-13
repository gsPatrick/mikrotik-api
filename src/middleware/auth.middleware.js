// src/middleware/auth.middleware.js
const jwt = require('jsonwebtoken');
const { User } = require('../models');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Pega o token do cabeçalho (formato "Bearer TOKEN")
      token = req.headers.authorization.split(' ')[1];

      // Verifica e decodifica o token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Encontra o usuário pelo ID contido no token e anexa ao objeto da requisição
      // Excluímos a senha do objeto do usuário por segurança
      req.user = await User.findByPk(decoded.id, {
        attributes: { exclude: ['password'] },
      });

      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Usuário não encontrado, falha na autorização.' });
      }

      next(); // Tudo certo, pode prosseguir para a rota
    } catch (error) {
      console.error(error);
      res.status(401).json({ success: false, message: 'Token inválido, falha na autorização.' });
    }
  }

  if (!token) {
    res.status(401).json({ success: false, message: 'Nenhum token fornecido, acesso negado.' });
  }
};

const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: `Acesso negado. Role '${req.user.role}' não autorizada para este recurso.` });
        }
        next();
    };
};

module.exports = { protect, authorize };