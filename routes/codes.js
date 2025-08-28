// routes/code.js
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, requireRoles } from '../middlewares/auth.js';

const prisma = new PrismaClient();
const router = express.Router();

// GET /code/list - Liste tous les codes avec pagination
router.get('/list', authenticateToken, requireRoles('ADMIN'), async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '', status = 'all' } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Construction du filtre WHERE
        let whereClause = {};

        // Filtre de recherche
        if (search) {
            whereClause.OR = [
                { code: { contains: search, mode: 'insensitive' } },
                {
                    generatedByUser: {
                        OR: [
                            { nom: { contains: search, mode: 'insensitive' } },
                            { prenom: { contains: search, mode: 'insensitive' } },
                            { email: { contains: search, mode: 'insensitive' } }
                        ]
                    }
                },
                {
                    usedByUser: {
                        OR: [
                            { nom: { contains: search, mode: 'insensitive' } },
                            { prenom: { contains: search, mode: 'insensitive' } },
                            { email: { contains: search, mode: 'insensitive' } }
                        ]
                    }
                }
            ];
        }

        // Filtre d'état
        if (status === 'used') {
            whereClause.used = true;
        } else if (status === 'unused') {
            whereClause.used = false;
        }

        const [codes, total] = await Promise.all([
            prisma.registrationCode.findMany({
                where: whereClause,
                skip,
                take: parseInt(limit),
                orderBy: { createdAt: 'desc' },
                include: {
                    generatedByUser: {
                        select: {
                            id: true,
                            nom: true,
                            prenom: true,
                            email: true
                        }
                    },
                    usedByUser: {
                        select: {
                            id: true,
                            nom: true,
                            prenom: true,
                            email: true
                        }
                    }
                }
            }),
            prisma.registrationCode.count({ where: whereClause })
        ]);

        res.json({
            success: true,
            data: {
                codes: codes.map(code => ({
                    id: code.id,
                    code: code.code,
                    createdAt: code.createdAt,
                    expiresAt: code.expiresAt,
                    used: code.used,
                    usedAt: code.usedAt,
                    generatedBy: code.generatedByUser ?
                        `${code.generatedByUser.prenom} ${code.generatedByUser.nom} (${code.generatedByUser.email})` :
                        'Système',
                    usedBy: code.usedByUser ?
                        `${code.usedByUser.prenom} ${code.usedByUser.nom} (${code.usedByUser.email})` :
                        null
                })),
                pagination: {
                    current: parseInt(page),
                    total: Math.ceil(total / limit),
                    count: codes.length,
                    totalItems: total
                }
            }
        });

    } catch (err) {
        console.error("Erreur liste codes:", err);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des codes"
        });
    }
});

// POST /code/generate - Générer de nouveaux codes
router.post('/generate', authenticateToken, requireRoles('ADMIN'), async (req, res) => {
    try {
        const { quantity = 1, expiresInHours = 24 } = req.body;
        const userId = req.user.id;

        if (quantity < 1 || quantity > 100) {
            return res.status(400).json({
                success: false,
                message: 'La quantité doit être entre 1 et 100'
            });
        }

        const codes = [];
        for (let i = 0; i < quantity; i++) {
            const code = generateRandomCode();
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + parseInt(expiresInHours));

            const newCode = await prisma.registrationCode.create({
                data: {
                    code,
                    expiresAt,
                    generatedBy: userId
                }
            });

            codes.push(newCode.code);
        }

        res.status(201).json({
            success: true,
            message: quantity > 1 ? `${quantity} codes générés avec succès` : 'Code généré avec succès',
            data: { codes }
        });

    } catch (err) {
        console.error("Erreur génération code:", err);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la génération du code"
        });
    }
});

// Fonction pour générer un code aléatoire
function generateRandomCode() {
    return 'UCAO-' +
        Math.random().toString(36).substring(2, 6).toUpperCase() + '-' +
        Math.random().toString(36).substring(2, 6).toUpperCase();
}


export default router;

